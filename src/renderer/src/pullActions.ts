// What GitDom does with a pull request besides reading it (ROADMAP Step 21): checking it out, in a
// worktree too, editing it, closing it, and cleaning up the local branch once it's merged.
import {
  PULL_NOUN,
  type CreatedPull,
  type ForgeKind,
  type MergeOutcome,
  type NewPull,
  type PullChange,
  type PullRequest
} from '../../shared/forge'
import type { Ref } from '../../shared/types'
import { call, fail, run, runBusy, snapshotOf } from './actions/core'
import { checkoutBranch, checkoutRemoteBranch } from './actions/refs'
import { choosePushRemote, pull as pullBranch } from './actions/remote'
import { isReady, pullLabel, pullsByRef, refreshForge, setEnded, useForge } from './forge'
import { useApp } from './store'
import { notify, showForm } from './ui'
import { checkoutInWorktree, createWorktree } from './worktrees'

const statusOf = (repo: string): ReturnType<typeof useForge.getState>['byRepo'][string] =>
  useForge.getState().byRepo[repo]

const kindOf = (repo: string): ForgeKind => {
  const status = statusOf(repo)
  return status && status.state !== 'none' ? status.repo.kind : 'github'
}

/** Reads the repository again, so the remote branches just fetched are known. */
async function fetchRemotes(repo: string): Promise<boolean> {
  const result = await runBusy(repo, 'Fetching', 'fetch', false)
  if (!result.ok) fail(result)
  await useApp.getState().refreshPath(repo)
  return result.ok
}

const remoteRef = (repo: string, remote: string, branch: string): Ref | undefined =>
  snapshotOf(repo)?.refs.find((r) => r.type === 'remote' && r.name === `${remote}/${branch}`)

/**
 * Checks a pull request out, or opens it in a new worktree: a branch following its source branch
 * when it's on a remote of the repository, so a push updates it. From a fork GitDom offers to add
 * the fork as a remote, or takes the pull request's commits on a branch of its own.
 */
export async function checkoutPull(
  repo: string,
  pull: PullRequest,
  worktree: boolean
): Promise<void> {
  const label = pullLabel(kindOf(repo), pull.number)
  const source = await window.api.forge.checkoutSource(repo, pull.number)
  if (!source.ok) return fail(source)
  let { remote } = source.value
  const { url, branch, owner } = source.value

  if (!remote && url) {
    const values = await showForm({
      title: `Check out ${label}`,
      message: `${label} comes from ${owner}'s fork. As a remote, its branch can be followed, and pushed to if the fork allows it; otherwise GitDom takes its commits on a branch of their own.`,
      fields: [{ key: 'name', label: 'Remote name', initial: owner }],
      checks: [{ key: 'add', label: 'Add the fork as a remote', initial: true }],
      confirmLabel: worktree ? 'Open in a worktree' : 'Check out'
    })
    if (!values) return
    if (values.add) {
      const name = String(values.name).trim()
      if (!(await run(repo, 'addRemote', name, url))) return
      remote = name
    }
  }

  if (remote) {
    if (!(await fetchRemotes(repo))) return
    const ref = remoteRef(repo, remote, branch)
    const snapshot = snapshotOf(repo)
    if (!ref || !snapshot) return notify('error', `${remote}/${branch} isn't there after the fetch`)
    if (worktree) await checkoutInWorktree(snapshot, ref)
    else await checkoutRemoteBranch(repo, snapshot, ref)
    return
  }

  // Just the commits: the pull request's last commit, fetched by GitDom
  const range = await window.api.forge.fetchPull(repo, pull.number)
  if (!range.ok) return fail(range)
  const name = `pr/${pull.number}`
  const snapshot = snapshotOf(repo)
  if (worktree) {
    if (snapshot) await createWorktree(snapshot, range.value.to, label)
  } else if (snapshot?.refs.some((r) => r.type === 'local' && r.name === name)) {
    await checkoutBranch(repo, name)
  } else if (await run(repo, 'createBranch', name, range.value.to, true)) {
    notify('success', `Checked out ${label} as ${name}: pushing it won't update ${label}`)
  }
}

/**
 * Pushes the branch when it isn't published or has commits to push, then opens the pull request
 * and shows it.
 */
export async function createPull(repo: string, pull: NewPull, push: boolean): Promise<boolean> {
  if (push) {
    const remote = await choosePushRemote(repo, pull.branch)
    if (remote === null) return false
    const pushed = await runBusy(repo, 'Pushing', 'push', false, pull.branch, remote)
    if (!pushed.ok) {
      fail(pushed)
      return false
    }
  }
  const created = await window.api.forge.createPull(repo, pull)
  if (!created.ok) {
    fail(created)
    return false
  }
  await showCreated(repo, created.value)
  return true
}

async function showCreated(repo: string, created: CreatedPull): Promise<void> {
  const label = pullLabel(kindOf(repo), created.number)
  await refreshForge(repo, true)
  useApp.getState().openPullRequest(created.number)
  if (created.warning) notify('warning', `Opened ${label}, but: ${created.warning}`)
  else notify('success', `Opened ${label}`)
}

/** Changes a pull request and reads it again; says what failed. */
export async function updatePull(
  repo: string,
  pull: PullRequest,
  change: PullChange,
  done: string
): Promise<boolean> {
  const result = await window.api.forge.updatePull(repo, pull.number, change)
  if (!result.ok) {
    fail(result)
    return false
  }
  if (change.state) setEnded(repo, pull, change.state === 'closed' ? 'closed' : null)
  await refreshForge(repo, true)
  notify('success', done)
  return true
}

export async function editPull(repo: string, pull: PullRequest, body: string): Promise<void> {
  const label = pullLabel(kindOf(repo), pull.number)
  const values = await showForm({
    title: `Edit ${label}`,
    fields: [
      { key: 'title', label: 'Title', initial: pull.title },
      { key: 'body', label: 'Description', initial: body, multiline: true, optional: true }
    ],
    confirmLabel: 'Save'
  })
  if (!values) return
  const title = String(values.title).trim()
  const text = String(values.body)
  const change: PullChange = {
    ...(title !== pull.title ? { title } : {}),
    ...(text !== body ? { body: text } : {})
  }
  if (Object.keys(change).length) await updatePull(repo, pull, change, `Saved ${label}`)
}

export async function setDraft(repo: string, pull: PullRequest, draft: boolean): Promise<void> {
  const label = pullLabel(kindOf(repo), pull.number)
  await updatePull(
    repo,
    pull,
    { draft },
    draft ? `${label} is a draft again` : `${label} is ready for review`
  )
}

export async function closePull(repo: string, pull: PullRequest): Promise<void> {
  const kind = kindOf(repo)
  const label = pullLabel(kind, pull.number)
  const status = statusOf(repo)
  const reopen = isReady(status) && status.info?.reopen !== false
  const values = await showForm({
    title: `Close ${label}`,
    message: `Close "${pull.title}" without merging it?${reopen ? '' : ` ${PULL_NOUN[kind].name} can't be opened again on this service.`}`,
    confirmLabel: 'Close',
    danger: true
  })
  if (values) await updatePull(repo, pull, { state: 'closed' }, `Closed ${label}`)
}

export async function reopenPull(repo: string, pull: PullRequest): Promise<void> {
  await updatePull(
    repo,
    pull,
    { state: 'open' },
    `Opened ${pullLabel(kindOf(repo), pull.number)} again`
  )
}

/**
 * After a merge: offers to switch to the target branch and bring it up to date, and to delete the
 * local branches of the pull request, which the merge made useless.
 */
export async function afterMerge(
  repo: string,
  pull: PullRequest,
  outcome: MergeOutcome
): Promise<void> {
  const kind = kindOf(repo)
  const label = pullLabel(kind, pull.number)
  const status = statusOf(repo)
  const snapshot = snapshotOf(repo)
  if (outcome === 'auto') return notify('success', `${label} will merge by itself once it can`)
  if (outcome === 'queued') return notify('success', `${label} is being merged`)
  setEnded(repo, pull, 'merged')
  if (!isReady(status) || !snapshot) return notify('success', `Merged ${label}`)

  const locals = [...pullsByRef(status, snapshot).entries()]
    .filter(([ref, p]) => p.number === pull.number && ref.startsWith('refs/heads/'))
    .map(([ref]) => ref.slice('refs/heads/'.length))
  await refreshForge(repo, true)
  if (!locals.length) return notify('success', `Merged ${label}`)

  const current = snapshot.head.branch
  const onIt = !!current && locals.includes(current)
  const values = await showForm({
    title: `Merged ${label}`,
    message: `Clean up after ${label}?`,
    checks: [
      ...(onIt
        ? [{ key: 'switch', label: `Switch to ${pull.targetBranch} and pull`, initial: true }]
        : []),
      {
        key: 'delete',
        label: `Delete the local branch${locals.length > 1 ? 'es' : ''} ${locals.join(', ')}`,
        initial: true
      }
    ],
    confirmLabel: 'Clean up'
  })
  if (!values) return
  if (onIt && values.switch) {
    const local = snapshot.refs.find((r) => r.type === 'local' && r.name === pull.targetBranch)
    const remote = remoteRef(repo, status.repo.remote, pull.targetBranch)
    const switched = local
      ? await checkoutBranch(repo, local.name)
      : remote
        ? await checkoutRemoteBranch(repo, snapshot, remote)
        : false
    if (!switched) return
    await pullBranch(repo, 'ff')
  }
  if (values.delete) {
    const head = snapshotOf(repo)?.head.branch
    for (const branch of locals) {
      if (branch === head) continue
      // A squashed merge leaves git thinking the branch isn't merged: the service says it is
      const result = await call(repo, 'deleteBranch', branch, true)
      if (!result.ok) fail(result)
    }
    void useApp.getState().refreshPath(repo)
  }
}
