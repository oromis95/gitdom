// User-facing git actions: run operations, ask for confirmation where needed, report the outcome.
import type {
  MergeMode,
  OpArgs,
  OpName,
  OpOutcome,
  OpResult,
  PullMode,
  RebaseStep,
  ResetMode,
  Result,
  StashMode
} from '../../shared/api'
import type { FileChange, Ref, RepoSnapshot, Stash, Submodule } from '../../shared/types'
import { extensionOf, folderOf, ignorePattern, type IgnoreKind } from '../../shared/ignore'
import { NO_GRAPH_FILTER, WIP_HASH, useApp } from './store'
import { useSettings } from './settings'
import { confirm, notify, openMenuAt, prompt, showForm, useUi, type MenuItem } from './ui'

function call<K extends OpName>(
  repo: string,
  name: K,
  ...args: OpArgs<K>
): Promise<Result<OpResult<K>>> {
  return window.api.op(repo, name, ...args)
}

function fail(result: { error: string; details?: string }): void {
  notify('error', result.error, result.details)
}

/**
 * Runs an operation, reports failures and refreshes the repository afterwards.
 * Resolves with the value, or undefined when the operation failed: only for operations returning
 * a value, since void operations resolve undefined either way.
 */
export async function runValue<K extends OpName>(
  repo: string,
  name: K,
  ...args: OpArgs<K>
): Promise<OpResult<K> | undefined> {
  const result = await call(repo, name, ...args)
  void useApp.getState().refreshPath(repo)
  if (!result.ok) {
    fail(result)
    return undefined
  }
  return result.value
}

/** Like runValue, resolving whether the operation succeeded. */
export async function run<K extends OpName>(
  repo: string,
  name: K,
  ...args: OpArgs<K>
): Promise<boolean> {
  const result = await call(repo, name, ...args)
  void useApp.getState().refreshPath(repo)
  if (!result.ok) fail(result)
  return result.ok
}

/** Like run, with a busy indicator for slow network operations. */
async function runBusy<K extends OpName>(
  repo: string,
  label: string,
  name: K,
  ...args: OpArgs<K>
): Promise<Result<OpResult<K>>> {
  const { setBusy, refreshPath } = useApp.getState()
  setBusy(repo, label)
  try {
    return await call(repo, name, ...args)
  } finally {
    setBusy(repo, undefined)
    void refreshPath(repo)
  }
}

/** The loaded snapshot of an open repository. */
const snapshotOf = (repo: string): RepoSnapshot | undefined =>
  useApp.getState().tabs.find((t) => t.path === repo)?.snapshot

const copy = (text: string): void => {
  void navigator.clipboard.writeText(text)
  notify('info', `Copied "${text.length > 40 ? text.slice(0, 40) + '…' : text}"`)
}

// --- Checkout -------------------------------------------------------------------------------

const WOULD_OVERWRITE = /would be overwritten by checkout|Please commit your changes or stash them/
const UNTRACKED_IN_WAY = /untracked working tree files would be (overwritten|removed)/

/** Runs a checkout; when local changes are in the way, offers to stash them across it. */
async function checkoutWith(
  repo: string,
  target: string,
  attempt: (stash: StashMode) => Promise<Result<void>>
): Promise<boolean> {
  let result = await attempt('none')
  const output = result.ok ? '' : (result.details ?? result.error)
  if (!result.ok && WOULD_OVERWRITE.test(output)) {
    const untracked = UNTRACKED_IN_WAY.test(output)
    // STASH-06: the preference skips the question
    const stash =
      useSettings.getState().autoStash ||
      (await confirm(
        'Local changes',
        untracked
          ? `Untracked files would be overwritten by checking out ${target}. Stash all changes, including untracked files, check out, and reapply them?`
          : `Your changes would be overwritten by checking out ${target}. Stash them, check out, and reapply them?`,
        'Stash and checkout'
      ))
    if (!stash) return false
    result = await attempt(untracked ? 'all' : 'tracked')
  }
  void useApp.getState().refreshPath(repo)
  if (!result.ok) {
    fail(result)
    return false
  }
  notify('success', `Checked out ${target}`)
  return true
}

export const checkoutBranch = (repo: string, branch: string): Promise<boolean> =>
  checkoutWith(repo, branch, (stash) => call(repo, 'checkout', branch, stash))

export const checkoutCommit = (repo: string, hash: string): Promise<boolean> =>
  checkoutWith(repo, hash.slice(0, 7), (stash) => call(repo, 'checkoutCommit', hash, stash))

/** Checks out a remote branch through a local tracking branch, reusing one that already tracks it. */
export async function checkoutRemoteBranch(
  repo: string,
  snapshot: RepoSnapshot,
  ref: Ref
): Promise<boolean> {
  const tracking = snapshot.refs.find((r) => r.type === 'local' && r.upstream === ref.name)
  if (tracking) return checkoutBranch(repo, tracking.name)

  let localName = ref.name.slice(ref.remote!.length + 1)
  if (snapshot.refs.some((r) => r.type === 'local' && r.name === localName)) {
    const chosen = await prompt(
      'Checkout remote branch',
      `A local branch named "${localName}" already exists. Name for the new tracking branch:`,
      `${ref.remote}-${localName}`,
      'Checkout'
    )
    if (!chosen) return false
    localName = chosen.trim()
  }
  return checkoutWith(repo, localName, (stash) =>
    call(repo, 'checkoutRemote', ref.name, localName, stash)
  )
}

// --- Branches -------------------------------------------------------------------------------

export async function createBranch(
  repo: string,
  startPoint: string | null,
  label?: string
): Promise<void> {
  const values = await showForm({
    title: 'Create branch',
    message: label ? `Starting from ${label}` : undefined,
    fields: [{ key: 'name', label: 'Branch name', placeholder: 'feature/my-change' }],
    checks: [{ key: 'checkout', label: 'Check out the new branch', initial: true }],
    confirmLabel: 'Create branch'
  })
  if (!values) return
  const name = String(values.name).trim()
  if (await run(repo, 'createBranch', name, startPoint, !!values.checkout)) {
    notify('success', `Created branch ${name}`)
  }
}

async function renameBranch(repo: string, branch: string): Promise<void> {
  const name = await prompt('Rename branch', 'New name', branch, 'Rename')
  if (name && name.trim() !== branch) await run(repo, 'renameBranch', branch, name.trim())
}

async function deleteBranch(repo: string, branch: string): Promise<void> {
  if (!(await confirm('Delete branch', `Delete the local branch "${branch}"?`, 'Delete', true)))
    return
  let result = await call(repo, 'deleteBranch', branch, false)
  if (!result.ok && /not fully merged/.test(result.details ?? result.error)) {
    const force = await confirm(
      'Branch not merged',
      `"${branch}" has commits that are not merged anywhere else. Deleting it may lose them. Delete anyway?`,
      'Delete anyway',
      true
    )
    if (!force) return
    result = await call(repo, 'deleteBranch', branch, true)
  }
  void useApp.getState().refreshPath(repo)
  if (result.ok) notify('success', `Deleted branch ${branch}`)
  else fail(result)
}

async function deleteRemoteBranch(repo: string, ref: Ref): Promise<void> {
  const branch = ref.name.slice(ref.remote!.length + 1)
  const ok = await confirm(
    'Delete remote branch',
    `Delete "${branch}" from the remote "${ref.remote}"? This affects everyone using the remote.`,
    'Delete from remote',
    true
  )
  if (!ok) return
  const result = await runBusy(repo, 'Deleting', 'deleteRemoteBranch', ref.remote!, branch)
  if (result.ok) notify('success', `Deleted ${ref.name}`)
  else fail(result)
}

async function setUpstream(repo: string, snapshot: RepoSnapshot, ref: Ref): Promise<void> {
  const guess = ref.upstream ?? `${snapshot.remotes[0]?.name ?? 'origin'}/${ref.name}`
  const upstream = await prompt(
    'Set upstream',
    'Remote branch to track (empty to unset)',
    guess,
    'Save'
  )
  if (upstream === null) return
  await run(repo, 'setUpstream', ref.name, upstream.trim() || null)
}

// --- Sync -----------------------------------------------------------------------------------

export async function fetchAll(repo: string, silent = false): Promise<void> {
  const result = await runBusy(repo, 'Fetching', 'fetch')
  if (silent) return
  if (result.ok) notify('success', 'Fetched all remotes')
  else fail(result)
}

export async function pull(repo: string, mode: PullMode): Promise<void> {
  const result = await runBusy(repo, 'Pulling', 'pull', mode)
  if (result.ok) {
    const { output } = result.value
    reportOutcome(
      result.value,
      'Pull',
      /Already up to date/i.test(output) ? 'Already up to date' : 'Pulled'
    )
  } else if (
    mode === 'ff-only' &&
    /Not possible to fast-forward|diverg/i.test(result.details ?? result.error)
  ) {
    notify(
      'error',
      'Cannot fast-forward: the branch has diverged. Pull with merge or rebase.',
      result.details
    )
  } else {
    fail(result)
  }
}

const PUSH_REJECTED = /\[rejected\]|non-fast-forward|fetch first|stale info/

export async function push(repo: string): Promise<void> {
  let result = await runBusy(repo, 'Pushing', 'push', false)
  if (!result.ok && PUSH_REJECTED.test(result.details ?? '')) {
    const force = await confirm(
      'Push rejected',
      'The remote branch has commits you do not have. Pull first, or force push to overwrite them ' +
        '(with lease: it fails if someone pushed after your last fetch).',
      'Force push',
      true
    )
    if (!force) return
    result = await runBusy(repo, 'Pushing', 'push', true)
  }
  if (result.ok) notify('success', 'Pushed', result.value)
  else fail(result)
}

// --- Stash ----------------------------------------------------------------------------------

export async function stash(repo: string): Promise<void> {
  const staged = snapshotOf(repo)?.status.staged.length ?? 0
  const values = await showForm({
    title: 'Stash changes',
    fields: [{ key: 'message', label: 'Message', placeholder: 'WIP', optional: true }],
    checks: [
      { key: 'untracked', label: 'Include untracked files', initial: true },
      ...(staged > 0
        ? [{ key: 'staged', label: 'Only the staged changes, keeping the others here' }]
        : [])
    ],
    confirmLabel: 'Stash'
  })
  if (!values) return
  const options = { staged: !!values.staged }
  if (await run(repo, 'stashPush', String(values.message), !!values.untracked, options)) {
    notify('success', options.staged ? 'Staged changes stashed' : 'Changes stashed')
  }
}

/** Stashes the changes to some files only (STASH-05), untracked ones included. */
export async function stashFiles(repo: string, files: FileChange[]): Promise<void> {
  const what = files.length === 1 ? files[0].path : `${files.length} files`
  const values = await showForm({
    title: 'Stash changes',
    message: `Stash the changes to ${what}, staged or not; the other changes stay here.`,
    fields: [{ key: 'message', label: 'Message', placeholder: 'WIP', optional: true }],
    confirmLabel: 'Stash'
  })
  if (!values) return
  const paths = files.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]))
  const untracked = files.some((f) => f.status === '?')
  if (await run(repo, 'stashPush', String(values.message), untracked, { paths })) {
    notify('success', `Stashed ${what}`)
  }
}

export async function stashPop(repo: string, entry: Stash): Promise<void> {
  if (await run(repo, 'stashPop', entry.selector)) notify('success', 'Stash applied and removed')
}

async function stashDrop(repo: string, entry: Stash): Promise<void> {
  const ok = await confirm(
    'Delete stash',
    `Delete "${entry.message}"? It cannot be recovered.`,
    'Delete',
    true
  )
  if (ok) await run(repo, 'stashDrop', entry.selector)
}

// --- Tags -----------------------------------------------------------------------------------

export async function createTag(repo: string, target: string, label: string): Promise<void> {
  const values = await showForm({
    title: 'Create tag',
    message: `On ${label}`,
    fields: [
      { key: 'name', label: 'Tag name', placeholder: 'v1.0.0' },
      { key: 'message', label: 'Message (makes an annotated tag)', multiline: true, optional: true }
    ],
    checks: [
      {
        key: 'sign',
        label: 'Sign the tag (annotated)',
        initial: snapshotOf(repo)?.signing.tags ?? false
      }
    ],
    confirmLabel: 'Create tag'
  })
  if (!values) return
  const name = String(values.name).trim()
  const message = String(values.message).trim() || null
  if (await run(repo, 'createTag', name, target, message, !!values.sign)) {
    notify('success', `Created ${values.sign ? 'signed ' : ''}tag ${name}`)
  }
}

async function deleteTag(repo: string, name: string): Promise<void> {
  if (await confirm('Delete tag', `Delete the local tag "${name}"?`, 'Delete', true)) {
    await run(repo, 'deleteTag', name)
  }
}

async function pushTag(repo: string, remote: string, name: string): Promise<void> {
  const result = await runBusy(repo, 'Pushing', 'pushTag', remote, name)
  if (result.ok) notify('success', `Pushed tag ${name} to ${remote}`)
  else fail(result)
}

async function deleteRemoteTag(repo: string, remote: string, name: string): Promise<void> {
  if (
    !(await confirm('Delete remote tag', `Delete tag "${name}" from "${remote}"?`, 'Delete', true))
  )
    return
  const result = await runBusy(repo, 'Deleting', 'deleteRemoteTag', remote, name)
  if (result.ok) notify('success', `Deleted tag ${name} from ${remote}`)
  else fail(result)
}

// --- Ignore ---------------------------------------------------------------------------------

/** Adds a file, its extension or its folder to the root .gitignore (COMMIT-11). */
export async function ignoreFile(repo: string, file: FileChange): Promise<void> {
  const tracked = file.status !== '?'
  const extension = extensionOf(file.path)
  const folder = folderOf(file.path)
  const kinds: { value: IgnoreKind; label: string }[] = [
    { value: 'file', label: `This file: ${ignorePattern(file.path, 'file')}` },
    ...(extension
      ? [{ value: 'extension' as const, label: `Every .${extension} file: *.${extension}` }]
      : []),
    ...(folder
      ? [{ value: 'folder' as const, label: `Its folder: ${ignorePattern(file.path, 'folder')}` }]
      : [])
  ]
  const values = await showForm({
    title: 'Add to .gitignore',
    message: tracked
      ? `${file.path} is tracked: .gitignore only affects untracked files, so it must also stop being tracked. It stays on disk, and the next commit removes it from the repository.`
      : undefined,
    fields: [
      { key: 'kind', label: 'Ignore', options: kinds, initial: 'file' },
      {
        key: 'custom',
        label: 'Or a pattern of your own',
        placeholder: 'e.g. *.log',
        optional: true
      }
    ],
    confirmLabel: tracked ? 'Stop tracking and ignore' : 'Ignore',
    danger: tracked
  })
  if (!values) return
  const custom = String(values.custom).trim()
  const kind = values.kind as IgnoreKind
  const pattern = custom || ignorePattern(file.path, kind)
  // A tracked folder stops being tracked as a whole, anything else only this file
  const untrack = !tracked ? [] : !custom && kind === 'folder' ? [folder!] : [file.path]
  if (await run(repo, 'ignore', pattern, untrack))
    notify('success', `Added ${pattern} to .gitignore`)
}

// --- Remotes --------------------------------------------------------------------------------

export async function addRemote(repo: string): Promise<void> {
  const values = await showForm({
    title: 'Add remote',
    fields: [
      { key: 'name', label: 'Name', initial: 'origin' },
      { key: 'url', label: 'URL', placeholder: 'https://github.com/user/repo.git' }
    ],
    confirmLabel: 'Add remote'
  })
  if (!values) return
  const name = String(values.name).trim()
  if (await run(repo, 'addRemote', name, String(values.url).trim())) {
    // New remotes have no branches yet: fetch them right away
    await fetchAll(repo, true)
  }
}

async function editRemote(repo: string, snapshot: RepoSnapshot, name: string): Promise<void> {
  const current = snapshot.remotes.find((r) => r.name === name)
  const values = await showForm({
    title: `Edit remote ${name}`,
    fields: [
      { key: 'name', label: 'Name', initial: name },
      { key: 'url', label: 'URL', initial: current?.fetchUrl ?? '' }
    ],
    confirmLabel: 'Save'
  })
  if (!values) return
  const newName = String(values.name).trim()
  const url = String(values.url).trim()
  if (url !== current?.fetchUrl && !(await run(repo, 'setRemoteUrl', name, url))) return
  if (newName !== name) await run(repo, 'renameRemote', name, newName)
}

async function removeRemote(repo: string, name: string): Promise<void> {
  const ok = await confirm(
    'Remove remote',
    `Remove the remote "${name}"? Its remote-tracking branches are removed too; nothing changes on the server.`,
    'Remove',
    true
  )
  if (ok) await run(repo, 'removeRemote', name)
}

// --- Working tree ---------------------------------------------------------------------------

export async function discardFiles(repo: string, files: FileChange[]): Promise<void> {
  const what = files.length === 1 ? `"${files[0].path}"` : `${files.length} files`
  const ok = await confirm(
    'Discard changes',
    `Discard all changes to ${what}? New files are deleted. This cannot be undone.`,
    'Discard',
    true
  )
  if (ok) await run(repo, 'discard', files)
}

// --- Conflicts and operations in progress ---------------------------------------------------

/** Stages conflicted files as resolved, asking first when they still contain conflict markers. */
export async function markResolved(repo: string, paths: string[]): Promise<boolean> {
  const markers = await call(repo, 'conflictMarkers', paths)
  if (markers.ok && markers.value.length > 0) {
    const what =
      markers.value.length === 1
        ? `"${markers.value[0]}" still contains`
        : `${markers.value.length} files still contain`
    const ok = await confirm(
      'Conflict markers left',
      `${what} conflict markers (<<<<<<< / >>>>>>>). Mark as resolved anyway?`,
      'Mark resolved'
    )
    if (!ok) return false
  }
  return await run(repo, 'stage', paths)
}

export async function resolveWith(
  repo: string,
  paths: string[],
  side: 'ours' | 'theirs'
): Promise<boolean> {
  const what = paths.length === 1 ? `"${paths[0]}"` : `${paths.length} files`
  const version = side === 'ours' ? 'the HEAD version' : 'the incoming version'
  const ok = await confirm(
    'Resolve conflicts',
    `Replace ${what} with ${version}? Edits made while resolving are lost.`,
    side === 'ours' ? 'Keep HEAD' : 'Take incoming'
  )
  return ok && (await run(repo, 'resolveConflict', paths, side))
}

export async function openMergeTool(repo: string, path: string): Promise<void> {
  const { setBusy, openDiff } = useApp.getState()
  setBusy(repo, 'Waiting for the merge tool')
  const result = await call(repo, 'openMergeTool', path)
  setBusy(repo, undefined)
  void useApp.getState().refreshPath(repo)
  if (!result.ok) return fail(result)
  // The tool stages the file when it exits after a successful merge
  const status = await call(repo, 'status')
  if (status.ok && !status.value.unstaged.some((f) => f.path === path && f.status === 'U')) {
    notify('success', `Resolved ${path}`)
    openDiff({ source: { kind: 'staged' }, path })
  }
}

export function conflictMenu(repo: string, paths: string[]): MenuItem[] {
  const single = paths.length === 1
  return [
    ...(single
      ? [
          {
            label: 'Open in merge tool',
            onClick: () =>
              useApp
                .getState()
                .openDiff({ source: { kind: 'unstaged' }, path: paths[0], merge: true })
          },
          {
            label: 'Open in external merge tool',
            onClick: () => void openMergeTool(repo, paths[0])
          },
          'separator' as const
        ]
      : []),
    { label: 'Mark resolved', onClick: () => void markResolved(repo, paths) },
    'separator',
    { label: 'Keep HEAD version (ours)', onClick: () => void resolveWith(repo, paths, 'ours') },
    {
      label: 'Take incoming version (theirs)',
      onClick: () => void resolveWith(repo, paths, 'theirs')
    }
  ]
}

export async function continueOperation(repo: string, operation: string): Promise<void> {
  const { setBusy, refreshPath } = useApp.getState()
  setBusy(repo, `Continuing ${operation}…`)
  const result = await call(repo, 'continueOperation')
  setBusy(repo, undefined)
  void refreshPath(repo)
  if (!result.ok) return fail(result)
  reportOutcome(result.value, capitalize(operation), `${capitalize(operation)} done`)
  // The diff of a file resolved along the way is committed now
  if (!result.value.conflicts) useApp.getState().openDiff(null)
}

export async function skipOperation(repo: string, operation: string): Promise<void> {
  const ok = await confirm(
    `Skip commit`,
    `Skip the commit that stopped the ${operation}? Its changes are left out.`,
    'Skip commit',
    true
  )
  if (!ok) return
  const result = await call(repo, 'skipOperation')
  void useApp.getState().refreshPath(repo)
  if (result.ok) reportOutcome(result.value, capitalize(operation), 'Commit skipped')
  else fail(result)
}

export async function abortOperation(repo: string, operation: string): Promise<void> {
  const ok = await confirm(
    `Abort ${operation}`,
    `Abort the ${operation} and go back to the state before it started? Conflict resolutions done so far are lost.`,
    `Abort ${operation}`,
    true
  )
  if (ok && (await run(repo, 'abortOperation'))) {
    notify('success', `${capitalize(operation)} aborted`)
  }
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** Reports an operation that may have stopped on conflicts. */
function reportOutcome(outcome: OpOutcome, what: string, done: string): void {
  if (!outcome.conflicts) notify('success', done, outcome.output)
  else if (/autostash resulted in conflicts/i.test(outcome.output)) {
    notify(
      'warning',
      `${what} done, but your local changes conflict with it: resolve the conflicted files (your changes are also kept in a stash)`,
      outcome.output
    )
  } else {
    notify(
      'warning',
      `${what} stopped on conflicts: resolve the conflicted files, then continue`,
      outcome.output
    )
  }
}

/** Runs an operation that may stop on conflicts, reporting its outcome. */
async function runOutcome<K extends OpName>(
  repo: string,
  what: string,
  done: string,
  name: K,
  ...args: OpArgs<K>
): Promise<OpOutcome | undefined> {
  const result = await runBusy(repo, `${what}…`, name, ...args)
  if (!result.ok) {
    fail(result)
    return undefined
  }
  const outcome = result.value as OpOutcome
  reportOutcome(outcome, what, done)
  return outcome
}

// --- Commit messages ------------------------------------------------------------------------

/** Changes the message of a commit of the current branch (DETAIL-04); resolves whether it did. */
export async function reword(
  repo: string,
  snapshot: RepoSnapshot,
  hash: string,
  message: string
): Promise<boolean> {
  const branch = snapshot.refs.find((r) => r.type === 'local' && r.name === snapshot.head.branch)
  const upstream = branch?.upstream && snapshot.refs.find((r) => r.name === branch.upstream)
  const pushed = upstream && (await call(repo, 'isAncestor', hash, upstream.fullName))
  const isHead = hash === snapshot.head.hash
  if (pushed && pushed.ok && pushed.value) {
    const ok = await confirm(
      'Reword a pushed commit',
      `${hash.slice(0, 7)} is already on ${upstream.name}. Rewording it rewrites ${
        isHead ? 'it' : 'it and the commits after it'
      }: you will have to force push, and anyone who pulled it must fix their copy.`,
      'Reword',
      true
    )
    if (!ok) return false
  }
  const outcome = await runOutcome(
    repo,
    'Reword',
    'Commit message changed',
    'reword',
    hash,
    message
  )
  return outcome !== undefined && !outcome.conflicts
}

// --- Merge, rebase and history rewriting ----------------------------------------------------

const MERGE_MODES: { value: MergeMode; label: string }[] = [
  { value: 'ff', label: 'Fast-forward if possible, otherwise merge commit' },
  { value: 'no-ff', label: 'Always create a merge commit' },
  { value: 'ff-only', label: 'Fast-forward only' },
  { value: 'squash', label: 'Squash into a single commit (not committed yet)' }
]

export async function merge(repo: string, snapshot: RepoSnapshot, ref: string): Promise<void> {
  const into = snapshot.head.branch ?? 'the detached HEAD'
  const values = await showForm({
    title: 'Merge',
    message: `Merge ${ref} into ${into}.`,
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
  const ok = await confirm(
    'Rebase',
    `Rebase ${branch} onto ${onto}? The commits of ${branch} that are not in ${onto} are rewritten on top of it.`,
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

export async function revert(repo: string, hash: string): Promise<void> {
  await runOutcome(repo, 'Revert', `Reverted ${hash.slice(0, 7)}`, 'revert', hash)
}

const RESET_HELP: Record<ResetMode, string> = {
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

// --- Context menus --------------------------------------------------------------------------

/** Merge and rebase items for a branch other than the current one. */
function integrationItems(snapshot: RepoSnapshot, name: string): MenuItem[] {
  const repo = snapshot.path
  const current = snapshot.head.branch
  return [
    {
      label: `Merge ${name} into ${current ?? 'HEAD'}…`,
      disabled: !snapshot.head.hash,
      onClick: () => void merge(repo, snapshot, name)
    },
    {
      label: `Rebase ${current ?? 'HEAD'} onto ${name}`,
      disabled: !current,
      onClick: () => void rebase(repo, snapshot, name)
    }
  ]
}

/** Shows the files changed between two revisions in the detail panel (DIFF-08). */
function compareItem(label: string, from: string, to: string, disabled = false): MenuItem {
  return { label, disabled, onClick: () => useApp.getState().compare({ from, to }) }
}

/** Compares the current branch with a branch or tag: what `ref` has that HEAD doesn't. */
function compareWithHead(snapshot: RepoSnapshot, ref: string): MenuItem {
  const current = snapshot.head.branch ?? 'HEAD'
  return compareItem(`Compare with ${current}`, current, ref, ref === snapshot.head.branch)
}

/** Hides a branch from the graph, or shows it alone (GRAPH-14). */
function graphItems(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const { graphFilters, setGraphFilter } = useApp.getState()
  const repo = snapshot.path
  const filter = graphFilters[repo] ?? NO_GRAPH_FILTER
  const hidden = filter.hidden.includes(ref.fullName)
  // The graph always includes HEAD, so the current branch can't be hidden
  const isCurrent = ref.type === 'local' && ref.name === snapshot.head.branch
  return [
    hidden
      ? {
          label: 'Show in graph',
          onClick: () =>
            setGraphFilter(repo, {
              ...filter,
              hidden: filter.hidden.filter((name) => name !== ref.fullName)
            })
        }
      : {
          label: 'Hide in graph',
          disabled: isCurrent || filter.solo !== null,
          onClick: () =>
            setGraphFilter(repo, { ...filter, hidden: [...filter.hidden, ref.fullName] })
        },
    filter.solo === ref.fullName
      ? {
          label: 'Show all branches',
          onClick: () => setGraphFilter(repo, { ...filter, solo: null })
        }
      : {
          label: 'Show only this branch',
          onClick: () => setGraphFilter(repo, { ...filter, solo: ref.fullName })
        }
  ]
}

export function localBranchMenu(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const repo = snapshot.path
  const isCurrent = ref.name === snapshot.head.branch
  return [
    {
      label: `Checkout ${ref.name}`,
      disabled: isCurrent,
      onClick: () => void checkoutBranch(repo, ref.name)
    },
    ...(isCurrent
      ? [
          { label: 'Pull', onClick: () => void pull(repo, savedPullMode()) },
          { label: 'Push', onClick: () => void push(repo) }
        ]
      : integrationItems(snapshot, ref.name)),
    'separator',
    { label: `Create branch here`, onClick: () => void createBranch(repo, ref.name, ref.name) },
    { label: 'Create tag here', onClick: () => void createTag(repo, ref.hash, ref.name) },
    { label: 'Set upstream…', onClick: () => void setUpstream(repo, snapshot, ref) },
    compareWithHead(snapshot, ref.name),
    'separator',
    { label: 'Rename…', onClick: () => void renameBranch(repo, ref.name) },
    {
      label: `Delete ${ref.name}`,
      danger: true,
      disabled: isCurrent,
      onClick: () => void deleteBranch(repo, ref.name)
    },
    'separator',
    ...graphItems(snapshot, ref),
    'separator',
    { label: 'Copy branch name', onClick: () => copy(ref.name) }
  ]
}

export function remoteBranchMenu(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const repo = snapshot.path
  return [
    {
      label: `Checkout ${ref.name}`,
      onClick: () => void checkoutRemoteBranch(repo, snapshot, ref)
    },
    ...integrationItems(snapshot, ref.name),
    { label: 'Create branch here', onClick: () => void createBranch(repo, ref.name, ref.name) },
    compareWithHead(snapshot, ref.name),
    'separator',
    {
      label: `Delete from ${ref.remote}`,
      danger: true,
      onClick: () => void deleteRemoteBranch(repo, ref)
    },
    'separator',
    ...graphItems(snapshot, ref),
    'separator',
    { label: 'Copy branch name', onClick: () => copy(ref.name) }
  ]
}

export function tagMenu(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const repo = snapshot.path
  return [
    compareWithHead(snapshot, ref.name),
    'separator',
    ...snapshot.remotes.map((r): MenuItem => ({
      label: `Push to ${r.name}`,
      onClick: () => void pushTag(repo, r.name, ref.name)
    })),
    'separator',
    { label: `Delete ${ref.name}`, danger: true, onClick: () => void deleteTag(repo, ref.name) },
    ...snapshot.remotes.map((r): MenuItem => ({
      label: `Delete from ${r.name}`,
      danger: true,
      onClick: () => void deleteRemoteTag(repo, r.name, ref.name)
    })),
    'separator',
    { label: 'Copy tag name', onClick: () => copy(ref.name) }
  ]
}

export function refMenu(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  if (ref.type === 'local') return localBranchMenu(snapshot, ref)
  if (ref.type === 'remote') return remoteBranchMenu(snapshot, ref)
  return tagMenu(snapshot, ref)
}

export function stashMenu(snapshot: RepoSnapshot, entry: Stash): MenuItem[] {
  const repo = snapshot.path
  return [
    { label: 'Apply stash', onClick: () => void run(repo, 'stashApply', entry.selector) },
    { label: 'Pop stash', onClick: () => void stashPop(repo, entry) },
    'separator',
    { label: 'Delete stash', danger: true, onClick: () => void stashDrop(repo, entry) }
  ]
}

export function remoteMenu(snapshot: RepoSnapshot, name: string): MenuItem[] {
  const repo = snapshot.path
  const remote = snapshot.remotes.find((r) => r.name === name)
  return [
    { label: 'Fetch', onClick: () => void fetchAll(repo) },
    { label: 'Edit remote…', onClick: () => void editRemote(repo, snapshot, name) },
    ...(remote ? [{ label: 'Copy URL', onClick: () => copy(remote.fetchUrl) }] : []),
    'separator',
    { label: `Remove ${name}`, danger: true, onClick: () => void removeRemote(repo, name) }
  ]
}

export function commitMenu(snapshot: RepoSnapshot, hash: string, subject: string): MenuItem[] {
  const repo = snapshot.path
  const short = hash.slice(0, 7)
  const isHead = hash === snapshot.head.hash
  const branch = snapshot.head.branch ?? 'HEAD'
  return [
    { label: 'Checkout this commit (detached)', onClick: () => void checkoutCommit(repo, hash) },
    { label: 'Create branch here', onClick: () => void createBranch(repo, hash, short) },
    { label: 'Create tag here', onClick: () => void createTag(repo, hash, short) },
    'separator',
    { label: 'Cherry-pick commit', disabled: isHead, onClick: () => void cherryPick(repo, [hash]) },
    { label: 'Revert commit', onClick: () => void revert(repo, hash) },
    {
      label: `Interactive rebase ${branch} from here…`,
      disabled: isHead || !snapshot.head.branch,
      onClick: () => void interactiveRebase(repo, hash)
    },
    compareItem(`Compare with ${branch}`, hash, branch, isHead),
    'separator',
    ...(['soft', 'mixed', 'hard'] as const).map((mode): MenuItem => ({
      label: `Reset ${branch} here: ${mode} (${RESET_HELP[mode]})`,
      danger: mode === 'hard',
      disabled: isHead && mode !== 'hard',
      onClick: () => void reset(repo, snapshot, hash, mode)
    })),
    'separator',
    { label: 'Copy commit hash', onClick: () => copy(hash) },
    { label: 'Copy commit message', onClick: () => copy(subject) }
  ]
}

/** Menu for several commits selected with Ctrl+click. */
export function commitsMenu(
  snapshot: RepoSnapshot,
  hashes: string[],
  clear: () => void
): MenuItem[] {
  return [
    ...(hashes.length === 2
      ? [
          compareItem(
            `Compare ${hashes[0].slice(0, 7)} with ${hashes[1].slice(0, 7)}`,
            hashes[0],
            hashes[1]
          )
        ]
      : []),
    {
      label: `Cherry-pick ${hashes.length} commits`,
      onClick: () => {
        clear()
        void cherryPick(snapshot.path, hashes)
      }
    },
    'separator',
    { label: 'Clear selection', onClick: clear }
  ]
}

// --- Submodules and LFS ---------------------------------------------------------------------

/** Clones and checks out submodules at their recorded commits; all of them when none is given. */
export async function updateSubmodules(repo: string, paths: string[] = []): Promise<void> {
  const result = await runBusy(repo, 'Updating submodules', 'submoduleUpdate', paths)
  if (result.ok)
    notify('success', paths.length === 1 ? `Updated ${paths[0]}` : 'Updated submodules')
  else fail(result)
}

export const submodulePath = (repo: string, sub: Submodule): string => `${repo}/${sub.path}`

export function submoduleMenu(snapshot: RepoSnapshot, sub: Submodule): MenuItem[] {
  const repo = snapshot.path
  const initialized = sub.state !== 'uninitialized'
  return [
    {
      label: 'Open submodule',
      disabled: !initialized,
      onClick: () => void useApp.getState().openRepo(submodulePath(repo, sub))
    },
    {
      label: initialized ? 'Update to the recorded commit' : 'Initialize',
      disabled: sub.state === 'clean',
      onClick: () => void updateSubmodules(repo, [sub.path])
    },
    'separator',
    { label: 'Copy path', onClick: () => copy(sub.path) },
    ...(sub.url ? [{ label: 'Copy URL', onClick: () => copy(sub.url) }] : [])
  ]
}

/** The LFS pattern suggested for a file: its extension, or the file itself. */
export function lfsPatternFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `*${name.slice(dot)}` : path
}

export async function lfsTrack(repo: string, pattern?: string): Promise<void> {
  const value =
    pattern ?? (await prompt('Track with Git LFS', 'Pattern, e.g. *.psd or assets/**', '', 'Track'))
  if (!value?.trim()) return
  if (await run(repo, 'lfsTrack', value.trim())) {
    notify('success', `Files matching ${value.trim()} are stored with LFS: commit .gitattributes`)
  }
}

export async function lfsUntrack(repo: string, pattern: string): Promise<void> {
  if (await run(repo, 'lfsUntrack', pattern)) {
    notify('info', `${pattern} is no longer tracked with LFS: commit .gitattributes`)
  }
}

// --- Preferences ----------------------------------------------------------------------------

const PULL_MODE_KEY = 'gitdom.pullMode'

export function savedPullMode(): PullMode {
  const saved = localStorage.getItem(PULL_MODE_KEY)
  return saved === 'ff-only' || saved === 'rebase' ? saved : 'ff'
}

export function savePullMode(mode: PullMode): void {
  localStorage.setItem(PULL_MODE_KEY, mode)
}

/** Opens a file of the repository, or the repository itself (null), in the external editor. */
export async function openInEditor(repo: string, path: string | null): Promise<void> {
  const result = await window.api.tools.openInEditor(repo, path)
  if (!result.ok) notify('error', `Couldn't open the editor: ${result.error}`, result.details)
}

export function showInFolder(repo: string, path: string | null): void {
  window.api.tools.showInFolder(repo, path)
}
