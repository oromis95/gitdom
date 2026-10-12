// Merge, rebase, cherry-pick, move, revert, reset, undo and redo.
import type { MergeMode, RebaseStep, ResetMode } from '../../../shared/api'
import type { Ref, RepoSnapshot } from '../../../shared/types'
import { WIP_HASH, useApp } from '../store'
import { confirm, notify, openMenuAt, showForm, useUi, type MenuItem } from '../ui'
import { call, fail, run, runOutcome, runValue } from './core'
import { checkoutBranch } from './refs'

// --- Merge, rebase and history rewriting ----------------------------------------------------

const MERGE_MODES: { value: MergeMode; label: string }[] = [
  { value: 'ff', label: 'Fast-forward if possible, otherwise merge commit' },
  { value: 'no-ff', label: 'Always create a merge commit' },
  { value: 'ff-only', label: 'Fast-forward only' },
  { value: 'squash', label: 'Squash into a single commit (not committed yet)' }
]

/** What merging `theirs` into `ours` would leave in conflict, as a line for a confirmation. */
async function conflictNote(repo: string, ours: string, theirs: string): Promise<string> {
  const preview = await call(repo, 'mergePreview', ours, theirs)
  if (!preview.ok || !preview.value) return ''
  const { conflicts } = preview.value
  if (!conflicts.length) return 'No conflicts expected.'
  const shown = conflicts.slice(0, 5).join(', ')
  const more = conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : ''
  return `Expect conflicts in ${conflicts.length === 1 ? '1 file' : `${conflicts.length} files`}: ${shown}${more}.`
}

/**
 * The branch the current one goes back into: main or master, on the remote of its upstream when
 * there is one. Null on that branch itself, or when there is none.
 */
export function mainBranchOf(snapshot: RepoSnapshot): Ref | null {
  const name = snapshot.head.branch
  if (!name) return null
  const current = snapshot.refs.find((r) => r.type === 'local' && r.name === name)
  const remote = current?.upstream?.split('/')[0] ?? 'origin'
  for (const candidate of [`${remote}/main`, `${remote}/master`, 'main', 'master']) {
    const ref = snapshot.refs.find(
      (r) => (r.type === 'remote' || r.type === 'local') && r.name === candidate
    )
    if (!ref) continue
    return ref.name === name || ref.name === current?.upstream ? null : ref
  }
  return null
}

/** The files the current branch and the main one both changed in ways that would conflict. */
export function mainConflictsMenu(
  snapshot: RepoSnapshot,
  main: Ref,
  conflicts: string[]
): MenuItem[] {
  const repo = snapshot.path
  const branch = snapshot.head.branch
  return [
    ...conflicts.slice(0, 12).map((path) => ({ label: path, onClick: () => {}, disabled: true })),
    ...(conflicts.length > 12
      ? [{ label: `…and ${conflicts.length - 12} more`, onClick: () => {}, disabled: true }]
      : []),
    'separator' as const,
    {
      label: `Merge ${main.name} into ${branch}…`,
      onClick: () => void merge(repo, snapshot, main.name)
    },
    {
      label: `Rebase ${branch} onto ${main.name}…`,
      onClick: () => void rebase(repo, snapshot, main.name)
    }
  ]
}

export async function merge(repo: string, snapshot: RepoSnapshot, ref: string): Promise<void> {
  const into = snapshot.head.branch ?? 'the detached HEAD'
  const note = await conflictNote(repo, 'HEAD', ref)
  const values = await showForm({
    title: 'Merge',
    message: [`Merge ${ref} into ${into}.`, note].filter(Boolean).join('\n'),
    fields: [{ key: 'mode', label: 'Mode', options: MERGE_MODES, initial: 'ff' }],
    confirmLabel: 'Merge'
  })
  if (!values) return
  const mode = values.mode as MergeMode
  const outcome = await runOutcome(repo, 'Merge', `Merged ${ref} into ${into}`, 'merge', ref, mode)
  if (outcome && mode === 'squash') {
    // The squashed changes are staged: commit them from the working tree panel
    useApp.getState().setDraft(repo, { summary: `Squash merge ${ref}`, amend: false })
    useApp.getState().select(WIP_HASH)
  }
}

export async function rebase(repo: string, snapshot: RepoSnapshot, onto: string): Promise<void> {
  const branch = snapshot.head.branch
  const note = await conflictNote(repo, onto, 'HEAD')
  const ok = await confirm(
    'Rebase',
    [
      `Rebase ${branch} onto ${onto}? The commits of ${branch} that are not in ${onto} are rewritten on top of it.`,
      note
    ]
      .filter(Boolean)
      .join('\n'),
    'Rebase'
  )
  if (ok) await runOutcome(repo, 'Rebase', `Rebased ${branch} onto ${onto}`, 'rebase', onto)
}

/** Opens the interactive rebase editor on the commits after `base`. */
export async function interactiveRebase(repo: string, base: string | null): Promise<void> {
  const result = await call(repo, 'rebaseCommits', base)
  if (!result.ok) return fail(result)
  const { commits, merges } = result.value
  if (commits.length === 0) {
    notify('info', 'No commits to rebase: pick a commit that is an ancestor of HEAD')
    return
  }
  useUi.setState({ rebase: { repo, base, commits, merges } })
}

export async function runInteractiveRebase(
  repo: string,
  base: string | null,
  todo: RebaseStep[]
): Promise<void> {
  await runOutcome(repo, 'Rebase', 'Interactive rebase done', 'rebaseInteractive', base, todo)
}

export async function cherryPick(repo: string, hashes: string[]): Promise<void> {
  const what = hashes.length === 1 ? hashes[0].slice(0, 7) : `${hashes.length} commits`
  await runOutcome(repo, 'Cherry-pick', `Cherry-picked ${what}`, 'cherryPick', hashes)
}

/** Most commits listed when moving them */
const MOVE_LIST_LIMIT = 8

/**
 * Moves a commit and the ones after it on the current branch to a new or an existing
 * branch, for commits made on the wrong branch.
 */
export async function moveCommits(
  snapshot: RepoSnapshot,
  from: string,
  create: boolean
): Promise<void> {
  const repo = snapshot.path
  const result = await call(repo, 'commitsToMove', from)
  if (!result.ok) return fail(result)
  const { branch, base, commits, merges } = result.value
  const others = snapshot.refs.filter((r) => r.type === 'local' && r.name !== branch)
  if (!create && merges) return notify('error', 'Merge commits can only be moved to a new branch')
  if (!create && !others.length)
    return notify('info', 'There is no other branch: move the commits to a new one')

  const local = snapshot.refs.find((r) => r.type === 'local' && r.name === branch)
  const upstream = local?.upstream && snapshot.refs.find((r) => r.name === local.upstream)
  const pushed = upstream && (await call(repo, 'isAncestor', from, upstream.fullName))
  const newest = [...commits].reverse()
  const list = newest.slice(0, MOVE_LIST_LIMIT).map((c) => `${c.hash.slice(0, 7)}  ${c.subject}`)
  if (newest.length > MOVE_LIST_LIMIT) list.push(`…and ${newest.length - MOVE_LIST_LIMIT} more`)
  const one = commits.length === 1
  const message = [
    `${one ? 'This commit leaves' : `These ${commits.length} commits leave`} ${branch}, which goes back to ${base.slice(0, 7)}:`,
    ...list,
    ...(create
      ? []
      : ['', `GitDom checks out the branch you pick and applies ${one ? 'it' : 'them'} on top.`]),
    ...(pushed && pushed.ok && pushed.value
      ? [
          '',
          `${one ? 'It is' : 'They are'} already on ${upstream.name}: you will have to force push ${branch}.`
        ]
      : [])
  ].join('\n')
  const values = await showForm({
    title: create ? 'Move to a new branch' : 'Move to another branch',
    message,
    fields: create
      ? [{ key: 'target', label: 'New branch name', placeholder: 'feature/my-change' }]
      : [
          {
            key: 'target',
            label: 'Branch',
            options: others.map((r) => ({ value: r.name, label: r.name })),
            initial: others[0].name
          }
        ],
    checks: create ? [{ key: 'checkout', label: 'Check out the new branch', initial: true }] : [],
    confirmLabel: one ? 'Move commit' : `Move ${commits.length} commits`
  })
  if (!values) return
  const target = String(values.target).trim()
  await runOutcome(
    repo,
    'Move',
    `Moved ${one ? '1 commit' : `${commits.length} commits`} to ${target}`,
    'moveCommits',
    from,
    target,
    create,
    !!values.checkout
  )
}

export async function revert(repo: string, hash: string): Promise<void> {
  await runOutcome(repo, 'Revert', `Reverted ${hash.slice(0, 7)}`, 'revert', hash)
}

export const RESET_HELP: Record<ResetMode, string> = {
  soft: 'keep all changes staged',
  mixed: 'keep all changes, unstaged',
  hard: 'discard all changes'
}

export async function reset(
  repo: string,
  snapshot: RepoSnapshot,
  hash: string,
  mode: ResetMode
): Promise<void> {
  const what = snapshot.head.branch ?? 'HEAD'
  if (mode === 'hard') {
    const ok = await confirm(
      'Hard reset',
      `Reset ${what} to ${hash.slice(0, 7)} and discard all uncommitted changes? They are saved in a stash first: Undo restores them. Untracked files are not touched.`,
      'Hard reset',
      true
    )
    if (!ok) return
  }
  const result = await call(repo, 'reset', hash, mode)
  void useApp.getState().refreshPath(repo)
  if (!result.ok) return fail(result)
  notify(
    'success',
    `Reset ${what} to ${hash.slice(0, 7)} (${mode})${
      result.value ? ': your uncommitted changes are saved in a stash, and Undo restores them' : ''
    }`
  )
}

export async function undo(repo: string): Promise<void> {
  const label = await runValue(repo, 'undo')
  if (label !== undefined) notify('success', `Undone: ${label}`)
}

export async function redo(repo: string): Promise<void> {
  const label = await runValue(repo, 'redo')
  if (label !== undefined) notify('success', `Redone: ${label}`)
}

/**
 * Menu shown when a branch is dropped on another: fast-forward, merge or rebase,
 * checking out the branch that has to move first when it isn't the current one.
 */
export async function dropBranch(
  x: number,
  y: number,
  snapshot: RepoSnapshot,
  source: Ref,
  target: Ref
): Promise<void> {
  if (source.fullName === target.fullName) return
  const repo = snapshot.path
  const current = snapshot.head.branch
  const asCurrent = (branch: string): RepoSnapshot => ({
    ...snapshot,
    head: { ...snapshot.head, branch }
  })
  const items: MenuItem[] = []

  if (target.type === 'local') {
    const behind =
      source.hash !== target.hash
        ? await call(repo, 'isAncestor', target.fullName, source.fullName)
        : null
    if (behind?.ok && behind.value) {
      items.push({
        label: `Fast-forward ${target.name} to ${source.name}`,
        onClick: () => void run(repo, 'fastForwardBranch', target.name, source.name)
      })
    }
    items.push(
      target.name === current
        ? {
            label: `Merge ${source.name} into ${target.name}…`,
            onClick: () => void merge(repo, snapshot, source.name)
          }
        : {
            label: `Checkout ${target.name} and merge ${source.name} into it…`,
            onClick: () =>
              void checkoutBranch(repo, target.name).then(async (ok) => {
                if (ok) await merge(repo, asCurrent(target.name), source.name)
              })
          }
    )
  }
  if (source.type === 'local') {
    items.push(
      source.name === current
        ? {
            label: `Rebase ${source.name} onto ${target.name}`,
            onClick: () => void rebase(repo, snapshot, target.name)
          }
        : {
            label: `Checkout ${source.name} and rebase it onto ${target.name}`,
            onClick: () =>
              void checkoutBranch(repo, source.name).then(async (ok) => {
                if (ok) await rebase(repo, asCurrent(source.name), target.name)
              })
          }
    )
  }
  if (items.length) openMenuAt(x, y, items)
}
