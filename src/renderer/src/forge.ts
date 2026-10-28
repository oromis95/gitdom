// Pull requests of the open repositories (INT-01, SIDE-07): the last list read for each, kept
// fresh while GitDom is in use, and which branch each pull request belongs to.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import {
  FORGE_NAMES,
  PULL_NOUN,
  sameRepoPath,
  type ForgeAccount,
  type ForgeKind,
  type ForgeStatus,
  type PullRequest
} from '../../shared/forge'
import type { RepoSnapshot } from '../../shared/types'
import { useApp } from './store'
import { notify } from './ui'

type Ready = Extract<ForgeStatus, { state: 'ready' }>

/** The device login or token dialog of a host */
export interface ConnectRequest {
  host: string
  kind: ForgeKind
  /** The repository on the host it's asked from (ForgeRepo.path) */
  path: string
  device: boolean
}

/** A pull request of a repository, for the dialogs acting on it */
export interface PullTarget {
  repo: string
  number: number
}

interface ForgeState {
  byRepo: Record<string, ForgeStatus>
  /** Repositories whose pull requests are being read */
  loading: Record<string, boolean>
  accounts: ForgeAccount[]
  connect: ConnectRequest | null
  /** The new pull request dialog: the repository and the branch it starts from */
  create: { repo: string; branch: string } | null
  merge: PullTarget | null
  /** The dialog asking reviewers */
  review: PullTarget | null
  /** Pull requests closed or merged in GitDom this session, by endedKey() */
  ended: Record<string, EndedPull>
}

export interface EndedPull {
  pull: PullRequest
  how: 'closed' | 'merged'
}

export const useForge = create<ForgeState>(() => ({
  byRepo: {},
  loading: {},
  accounts: [],
  connect: null,
  create: null,
  merge: null,
  review: null,
  ended: {}
}))

// The service is asked at most this often for a repository, unless the user asks
const MIN_GAP = 20 * 1000
// While GitDom is in front, and while it's behind other windows
const FOCUSED_EVERY = 60 * 1000
const BACKGROUND_EVERY = 5 * 60 * 1000

const asked = new Map<string, number>()
const running = new Map<string, Promise<void>>()

/** Reads the pull requests of an open repository again; `force` skips the minimum gap. */
export function refreshForge(path: string, force = false): Promise<void> {
  const pending = running.get(path)
  if (pending) {
    if (!force) return pending
    // The running read may have started before what the user changed, e.g. an account connected:
    // read again once it's done
    return pending.then(() => refreshForge(path, true))
  }
  if (!force && Date.now() - (asked.get(path) ?? 0) < MIN_GAP) return Promise.resolve()
  const snapshot = useApp.getState().tabs.find((t) => t.path === path)?.snapshot
  if (!snapshot) return Promise.resolve()
  asked.set(path, Date.now())
  useForge.setState((s) => ({ loading: { ...s.loading, [path]: true } }))
  const work = window.api.forge
    .status(path, snapshot.remotes)
    .then((result) => {
      if (result.ok) useForge.setState((s) => ({ byRepo: { ...s.byRepo, [path]: result.value } }))
    })
    .finally(() => {
      running.delete(path)
      useForge.setState((s) => ({ loading: { ...s.loading, [path]: false } }))
    })
  running.set(path, work)
  return work
}

export async function loadAccounts(): Promise<void> {
  useForge.setState({ accounts: await window.api.forge.accounts() })
}

/** Reads again every open repository on a host, after its account changed. */
function refreshHost(host: string): void {
  const { byRepo } = useForge.getState()
  for (const tab of useApp.getState().tabs) {
    const status = byRepo[tab.path]
    if (status && status.state !== 'none' && status.repo.host === host)
      void refreshForge(tab.path, true)
  }
}

/** Reads every open repository again, e.g. after the servers of one's own changed. */
export function refreshAllForge(): void {
  for (const tab of useApp.getState().tabs) void refreshForge(tab.path, true)
}

/** Keeps the active repository's pull requests fresh; returns the function that stops it. */
export function startForge(): () => void {
  void loadAccounts()
  const tick = (): void => {
    const tab = useApp.getState().tabs[useApp.getState().active]
    if (!tab?.snapshot) return
    const every = document.hasFocus() ? FOCUSED_EVERY : BACKGROUND_EVERY
    if (Date.now() - (asked.get(tab.path) ?? 0) >= every) void refreshForge(tab.path, true)
  }
  const timer = setInterval(tick, 15 * 1000)
  // A tab shown, or its remotes changed: read it if it's never been read or it's been a while
  let last = ''
  const unsubscribe = useApp.subscribe((s) => {
    const tab = s.tabs[s.active]
    const key = tab?.snapshot
      ? `${tab.path}\n${tab.snapshot.remotes.map((r) => r.fetchUrl).join('\n')}`
      : ''
    if (key === last) return
    const remotesChanged = last.split('\n')[0] === tab?.path
    last = key
    if (tab?.snapshot) void refreshForge(tab.path, remotesChanged || !asked.has(tab.path))
  })
  // After a fetch, a push or a commit, the pull requests may have changed too
  const unwatch = window.api.onRepoChanged((path, scope) => {
    if (scope === 'git') void refreshForge(path)
  })
  return () => {
    clearInterval(timer)
    unsubscribe()
    unwatch()
  }
}

export const useForgeStatus = (path: string): ForgeStatus | undefined =>
  useForge((s) => s.byRepo[path])

export const isReady = (status: ForgeStatus | undefined): status is Ready =>
  status?.state === 'ready'

const branchMaps = new WeakMap<
  Ready,
  { refs: RepoSnapshot['refs']; map: Map<string, PullRequest> }
>()

/**
 * The pull request of each branch, by full ref name: the remote branch it comes from (on origin,
 * or the fork's remote) and the local branches following that remote branch.
 */
export function pullsByRef(status: Ready, snapshot: RepoSnapshot): Map<string, PullRequest> {
  const cached = branchMaps.get(status)
  if (cached?.refs === snapshot.refs) return cached.map
  const map = new Map<string, PullRequest>()
  const remoteNames = Object.entries(status.remotes)
  for (const pull of status.pulls) {
    for (const [remote, path] of remoteNames) {
      if (!sameRepoPath(path, pull.sourceRepo)) continue
      const tracking = `${remote}/${pull.sourceBranch}`
      map.set(`refs/remotes/${tracking}`, pull)
      for (const ref of snapshot.refs)
        if (ref.type === 'local' && ref.upstream === tracking) map.set(ref.fullName, pull)
    }
  }
  branchMaps.set(status, { refs: snapshot.refs, map })
  return map
}

/** The pull request of the checked-out branch, if it has one. */
export function currentPull(
  status: ForgeStatus | undefined,
  snapshot: RepoSnapshot
): PullRequest | null {
  if (!isReady(status) || !snapshot.head.branch) return null
  return pullsByRef(status, snapshot).get(`refs/heads/${snapshot.head.branch}`) ?? null
}

export interface PullGroups {
  mine: PullRequest[]
  review: PullRequest[]
  others: PullRequest[]
}

/** The viewer's pull requests, those waiting for the viewer's review, and the rest. */
export function groupPulls(status: Ready): PullGroups {
  const me = status.viewer.login.toLowerCase()
  const groups: PullGroups = { mine: [], review: [], others: [] }
  for (const pull of status.pulls) {
    if (pull.author.login.toLowerCase() === me) groups.mine.push(pull)
    else if (
      pull.reviewers.some((r) => r.vote === 'requested' && r.user.login.toLowerCase() === me)
    )
      groups.review.push(pull)
    else groups.others.push(pull)
  }
  return groups
}

/** "#42" or "!42", as the service writes it. */
export const pullLabel = (kind: ForgeKind, number: number): string =>
  `${PULL_NOUN[kind].prefix}${number}`

/**
 * Connects the account for a host: with Git Credential Manager's token when it has a usable one,
 * otherwise by opening the login dialog.
 */
export async function connectForge(request: ConnectRequest): Promise<void> {
  const result = await window.api.forge.connectWithGit(request.host, request.kind, request.path)
  if (result.ok && result.value) return connected(result.value)
  if (!result.ok) notify('warning', result.error)
  useForge.setState({ connect: request })
}

/** After an account is connected: tells the user, and reads its repositories again. */
export function connected(account: ForgeAccount): void {
  useForge.setState({ connect: null })
  const how = account.source === 'gcm' ? " with Git Credential Manager's token" : ''
  notify('success', `Connected to ${FORGE_NAMES[account.kind]} as ${account.user.login}${how}`)
  void loadAccounts()
  refreshHost(account.host)
}

export async function disconnectForge(host: string): Promise<void> {
  await window.api.forge.disconnect(host)
  await loadAccounts()
  refreshHost(host)
}

export const openInBrowser = (url: string): void => window.api.forge.openUrl(url)

export const endedKey = (repo: string, number: number): string => `${repo}\n${number}`

/** Remembers how a pull request ended in GitDom, or forgets it once it's open again. */
export function setEnded(repo: string, pull: PullRequest, how: EndedPull['how'] | null): void {
  useForge.setState((s) => {
    const ended = { ...s.ended }
    if (how) ended[endedKey(repo, pull.number)] = { pull, how }
    else delete ended[endedKey(repo, pull.number)]
    return { ended }
  })
}

/** Opens the new pull request dialog, from a branch or the checked-out one. */
export function openCreatePull(repo: string, branch?: string): void {
  const snapshot = useApp.getState().tabs.find((t) => t.path === repo)?.snapshot
  const from = branch ?? snapshot?.head.branch
  if (!from) return notify('warning', 'Check out a branch to open a pull request from it')
  useForge.setState({ create: { repo, branch: from } })
}

/**
 * Whether a pull request can be opened from a branch: the repository is on a connected service,
 * the branch isn't the default one and has no open pull request yet.
 */
export function canOpenPull(repo: string, branch: string): boolean {
  const status = useForge.getState().byRepo[repo]
  const snapshot = useApp.getState().tabs.find((t) => t.path === repo)?.snapshot
  if (!isReady(status) || !snapshot) return false
  if (branch === (status.info?.defaultBranch ?? '')) return false
  return !pullsByRef(status, snapshot).has(`refs/heads/${branch}`)
}

/** After a push: says so, offering to open a pull request when the branch has none. */
export function notifyPushed(repo: string, output: string): void {
  const branch = useApp.getState().tabs.find((t) => t.path === repo)?.snapshot?.head.branch
  const status = useForge.getState().byRepo[repo]
  const offer = branch && canOpenPull(repo, branch) && isReady(status)
  notify(
    'success',
    'Pushed',
    output,
    offer
      ? {
          label: `Create ${PULL_NOUN[status.repo.kind].name}`,
          run: () => openCreatePull(repo, branch)
        }
      : undefined
  )
}

const avatars = new Map<string, string | null>()
const waiting = new Map<string, Promise<string | null>>()

/** A profile picture, loaded by the main process; null until it arrives, or when there's none. */
export function useAvatar(url: string | null): string | null {
  const [, setLoaded] = useState(0)
  const known = url ? avatars.get(url) : null
  useEffect(() => {
    if (!url || avatars.has(url)) return
    let alive = true
    let request = waiting.get(url)
    if (!request) {
      request = window.api.forge.avatar(url)
      waiting.set(url, request)
    }
    void request.then((image) => {
      avatars.set(url, image)
      waiting.delete(url)
      if (alive) setLoaded((n) => n + 1)
    })
    return () => {
      alive = false
    }
  }, [url])
  return known ?? null
}
