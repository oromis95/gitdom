// Checkout, branches and tags.
import type { Result, StashMode } from '../../../shared/api'
import type { Ref, RepoSnapshot } from '../../../shared/types'
import { useApp } from '../store'
import { useSettings } from '../settings'
import { confirm, notify, prompt, showForm } from '../ui'
import { openWorktree, worktreeOf } from '../worktrees'
import { call, fail, run, runBusy, snapshotOf } from './core'

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

export async function checkoutBranch(repo: string, branch: string): Promise<boolean> {
  // Git refuses to check out a branch that another worktree has: offer to open that one instead
  const snapshot = snapshotOf(repo)
  const elsewhere = snapshot && worktreeOf(snapshot, branch)
  if (elsewhere) {
    const open = await confirm(
      'Branch is in another worktree',
      `${branch} is checked out in ${elsewhere.path}. Open that worktree in a tab?`,
      'Open worktree'
    )
    if (open) await openWorktree(elsewhere.path)
    return false
  }
  return checkoutWith(repo, branch, (stash) => call(repo, 'checkout', branch, stash))
}

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

export async function renameBranch(repo: string, branch: string): Promise<void> {
  const name = await prompt('Rename branch', 'New name', branch, 'Rename')
  if (name && name.trim() !== branch) await run(repo, 'renameBranch', branch, name.trim())
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
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

export async function deleteRemoteBranch(repo: string, ref: Ref): Promise<void> {
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

export async function setUpstream(repo: string, snapshot: RepoSnapshot, ref: Ref): Promise<void> {
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

export async function deleteTag(repo: string, name: string): Promise<void> {
  if (await confirm('Delete tag', `Delete the local tag "${name}"?`, 'Delete', true)) {
    await run(repo, 'deleteTag', name)
  }
}

export async function pushTag(repo: string, remote: string, name: string): Promise<void> {
  const result = await runBusy(repo, 'Pushing', 'pushTag', remote, name)
  if (result.ok) notify('success', `Pushed tag ${name} to ${remote}`)
  else fail(result)
}

export async function deleteRemoteTag(repo: string, remote: string, name: string): Promise<void> {
  if (
    !(await confirm('Delete remote tag', `Delete tag "${name}" from "${remote}"?`, 'Delete', true))
  )
    return
  const result = await runBusy(repo, 'Deleting', 'deleteRemoteTag', remote, name)
  if (result.ok) notify('success', `Deleted tag ${name} from ${remote}`)
  else fail(result)
}
