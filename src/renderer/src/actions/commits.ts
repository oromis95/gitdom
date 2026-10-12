// Commit messages: reword, fixup, split and reorder.
import type { Commit, RepoSnapshot } from '../../../shared/types'
import { useApp } from '../store'
import { confirm, notify, useUi } from '../ui'
import { call, fail, runBusy, runOutcome } from './core'

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

/** Adds the staged changes to a commit of the current branch. */
export async function fixup(snapshot: RepoSnapshot, hash: string): Promise<void> {
  const repo = snapshot.path
  const staged = snapshot.status.staged.length
  if (!staged) return notify('info', 'Stage the changes to add to the commit first')
  const isHead = hash === snapshot.head.hash
  const branch = snapshot.refs.find((r) => r.type === 'local' && r.name === snapshot.head.branch)
  const upstream = branch?.upstream && snapshot.refs.find((r) => r.name === branch.upstream)
  const pushed = upstream && (await call(repo, 'isAncestor', hash, upstream.fullName))
  const message = [
    `The ${staged === 1 ? 'staged file is' : `${staged} staged files are`} added to ${hash.slice(0, 7)}${
      isHead ? '.' : ', and the commits after it are rewritten on top.'
    } Its message stays the same.`,
    ...(pushed && pushed.ok && pushed.value
      ? ['', `It is already on ${upstream.name}: you will have to force push.`]
      : [])
  ].join('\n')
  const ok = await confirm(
    'Add staged changes to this commit',
    message,
    'Add to commit',
    !!(pushed && pushed.ok && pushed.value)
  )
  if (!ok) return
  await runOutcome(repo, 'Fixup', `Staged changes added to ${hash.slice(0, 7)}`, 'fixup', hash)
}

/** Opens the dialog that splits a commit of the current branch in two. */
export async function splitCommit(snapshot: RepoSnapshot, hash: string): Promise<void> {
  const repo = snapshot.path
  const [detail, onBranch] = await Promise.all([
    call(repo, 'commitDetail', hash),
    call(repo, 'isAncestor', hash, 'HEAD')
  ])
  if (!detail.ok) return fail(detail)
  if (onBranch.ok && !onBranch.value)
    return notify('info', 'The commit is not on the current branch: check out its branch first')
  if (detail.value.parents.length > 1) return notify('info', 'A merge commit cannot be split')
  if (detail.value.files.length < 2)
    return notify('info', 'The commit changes a single file: there is nothing to split')
  const branch = snapshot.refs.find((r) => r.type === 'local' && r.name === snapshot.head.branch)
  const upstream = branch?.upstream && snapshot.refs.find((r) => r.name === branch.upstream)
  const pushed = upstream && (await call(repo, 'isAncestor', hash, upstream.fullName))
  const { subject, body, files } = detail.value
  useUi.setState({
    split: {
      repo,
      hash: detail.value.hash,
      message: body ? `${subject}\n\n${body}` : subject,
      files,
      isHead: detail.value.hash === snapshot.head.hash,
      pushedTo: pushed && pushed.ok && pushed.value ? upstream.name : undefined
    }
  })
}

export async function runSplitCommit(
  repo: string,
  hash: string,
  paths: string[],
  first: string,
  second: string
): Promise<void> {
  const result = await runBusy(repo, 'Split…', 'splitCommit', hash, paths, first, second)
  if (!result.ok) return fail(result)
  // The commit is gone: show the second of the two
  useApp.getState().select(result.value.second, true)
  notify('success', `Split ${hash.slice(0, 7)} in two commits`)
}

/**
 * Moves a commit of the current branch, dragged in the graph, before or after another one.
 * `chain` is the branch from HEAD back to its last merge, newest first, as the graph lists it.
 */
export async function reorderCommits(
  snapshot: RepoSnapshot,
  chain: Commit[],
  from: number,
  to: number,
  after: boolean
): Promise<void> {
  const repo = snapshot.path
  const order = chain.filter((_, i) => i !== from)
  const at = (after ? to + 1 : to) - (to > from ? 1 : 0)
  order.splice(at, 0, chain[from])
  // Only the commits from the oldest one that moved are rewritten
  const deepest = order.findLastIndex((c, i) => c.hash !== chain[i].hash)
  if (deepest < 0) return
  const oldest = chain[deepest]
  const branch = snapshot.refs.find((r) => r.type === 'local' && r.name === snapshot.head.branch)
  const upstream = branch?.upstream && snapshot.refs.find((r) => r.name === branch.upstream)
  const pushed = upstream && (await call(repo, 'isAncestor', oldest.hash, upstream.fullName))
  const isPushed = !!(pushed && pushed.ok && pushed.value)
  const message = [
    `"${chain[from].subject}" moves ${after ? 'below' : 'above'} "${chain[to].subject}".`,
    `${deepest + 1} commits are replayed in the new order. If they change the same lines, the rebase stops on the conflicts.`,
    ...(isPushed ? ['', `They are already on ${upstream.name}: you will have to force push.`] : [])
  ].join('\n')
  if (!(await confirm('Reorder commits', message, 'Reorder', isPushed))) return
  await runOutcome(
    repo,
    'Reorder',
    'Commits reordered',
    'reorderCommits',
    oldest.parents[0] ?? null,
    order
      .slice(0, deepest + 1)
      .reverse()
      .map((c) => c.hash)
  )
}
