// IPC of the pull requests. Tokens stay in this process: the interface only learns who is connected.
import { join } from 'path'
import { app, ipcMain, net, safeStorage, shell } from 'electron'
import { IPC, type Result } from '../../shared/api'
import {
  MERGE_METHODS,
  parseForgeHosts,
  type Candidate,
  type ForgeKind,
  type MergeMethod,
  type MergeOptions,
  type NewPull,
  type PullChange
} from '../../shared/forge'
import type { Remote } from '../../shared/types'
import { GitError } from '../git/exec'
import { inAction } from '../git/activity'
import { AccountStore } from './accounts'
import { credentialFill } from './credential'
import { setFetcher } from './http'
import { ForgeService, tokenPage } from './service'

async function toResult<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    const details = e instanceof GitError && e.stderr.trim() ? e.stderr.trim() : undefined
    return { ok: false, error, details }
  }
}

const KINDS = new Set<ForgeKind>(['github', 'gitlab', 'bitbucket', 'bitbucketServer', 'azure'])
const kindOf = (kind: unknown): ForgeKind => {
  if (!KINDS.has(kind as ForgeKind)) throw new Error(`Unknown service: ${String(kind)}`)
  return kind as ForgeKind
}

// What the interface sends is checked before it reaches a service

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function candidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((c) => {
    const id = text((c as Candidate)?.id)
    const login = text((c as Candidate)?.user?.login)
    return id ? [{ id, user: { login: login || id, name: null, avatarUrl: null } }] : []
  })
}

function newPull(value: unknown): NewPull {
  const v = (value ?? {}) as Record<string, unknown>
  const pull: NewPull = {
    branch: text(v.branch).trim(),
    targetBranch: text(v.targetBranch).trim(),
    title: text(v.title).trim(),
    body: text(v.body),
    draft: v.draft === true,
    reviewers: candidates(v.reviewers),
    labels: Array.isArray(v.labels) ? v.labels.map(text).filter(Boolean) : []
  }
  if (!pull.branch || !pull.targetBranch) throw new Error('Choose the branches')
  if (!pull.title) throw new Error('The title is empty')
  return pull
}

function pullChange(value: unknown): PullChange {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    ...(typeof v.title === 'string' ? { title: v.title.trim() } : {}),
    ...(typeof v.body === 'string' ? { body: v.body } : {}),
    ...(typeof v.draft === 'boolean' ? { draft: v.draft } : {}),
    ...(v.state === 'open' || v.state === 'closed' ? { state: v.state } : {}),
    ...(Array.isArray(v.reviewers) ? { reviewers: candidates(v.reviewers) } : {})
  }
}

function mergeOptions(value: unknown): MergeOptions {
  const v = (value ?? {}) as Record<string, unknown>
  const method = text(v.method) as MergeMethod
  if (!(method in MERGE_METHODS)) throw new Error(`Unknown merge method: ${method}`)
  return {
    method,
    message: text(v.message),
    deleteBranch: v.deleteBranch === true,
    auto: v.auto === true
  }
}

/**
 * The end-to-end tests point GitDom at a fake service: GITDOM_FORGE_MOCK is its address, which
 * receives https://host/path as <mock>/host/path. Git's own credentials are never read then.
 */
function mockSetup(): { rewrite(url: string): string; token: string | undefined } | null {
  const mock = process.env.GITDOM_FORGE_MOCK
  if (!mock) return null
  return {
    rewrite: (url) => url.replace(/^https:\/\//, `${mock.replace(/\/$/, '')}/`),
    token: process.env.GITDOM_FORGE_MOCK_GCM_TOKEN
  }
}

export function registerForgeHandlers(): void {
  const mock = mockSetup()
  // The fake service is on this computer: Node's fetch reaches it without the system proxy
  setFetcher(
    mock ? (url, init) => fetch(mock.rewrite(url), init) : (url, init) => net.fetch(url, init)
  )
  const accounts = new AccountStore(join(app.getPath('userData'), 'accounts.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (text) => safeStorage.decryptString(Buffer.from(text, 'base64'))
  })
  accounts.load()
  const service = new ForgeService(
    accounts,
    mock
      ? async () => (mock.token ? { username: 'git', password: mock.token } : null)
      : credentialFill
  )

  ipcMain.on(IPC.forgeConfigure, (_event, hosts: unknown) =>
    service.setHosts(parseForgeHosts(String(hosts ?? '')))
  )
  ipcMain.handle(IPC.forgeStatus, (_event, repo: string, remotes: Remote[]) =>
    toResult(() => service.status(String(repo), Array.isArray(remotes) ? remotes : []))
  )
  ipcMain.handle(IPC.forgeDetail, (_event, repo: string, number: number) =>
    toResult(() => service.detail(String(repo), Number(number)))
  )
  ipcMain.handle(IPC.forgeFetchPull, (_event, repo: string, number: number) =>
    toResult(() => service.fetchPull(String(repo), Number(number)))
  )
  ipcMain.handle(IPC.forgeAccounts, () => service.listAccounts())
  ipcMain.handle(IPC.forgeConnectGit, (_event, host: string, kind: unknown, path: string) =>
    toResult(() => service.connectWithGit(String(host), kindOf(kind), String(path ?? '')))
  )
  ipcMain.handle(
    IPC.forgeConnectToken,
    (_event, host: string, kind: unknown, token: string, username: string, path: string) =>
      toResult(() => {
        const value = String(token ?? '').trim()
        if (!value) throw new Error('Paste the token')
        const user = String(username ?? '').trim()
        return service.connect(
          String(host),
          kindOf(kind),
          'token',
          { token: value, ...(user ? { username: user } : {}) },
          String(path ?? '')
        )
      })
  )
  ipcMain.handle(IPC.forgeStartLogin, (_event, host: string, kind: unknown) =>
    toResult(() => service.startLogin(String(host), kindOf(kind)))
  )
  ipcMain.handle(IPC.forgeFinishLogin, (_event, id: number) =>
    toResult(() => service.finishLogin(Number(id)))
  )
  ipcMain.on(IPC.forgeCancelLogin, (_event, id: number) => service.cancelLogin(Number(id)))
  ipcMain.handle(IPC.forgeDisconnect, (_event, host: string) => service.disconnect(String(host)))
  ipcMain.handle(IPC.forgeCanSave, () => accounts.canSave())
  ipcMain.handle(IPC.forgeAvatar, (_event, url: string) => service.avatar(String(url)))
  ipcMain.on(IPC.forgeOpenUrl, (_event, url: unknown) => {
    // Only web pages: never a file or another program's protocol
    if (typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle(IPC.forgeTokenPage, (_event, host: string, kind: unknown, path: string) =>
    tokenPage(kindOf(kind), String(host), String(path ?? ''))
  )
  ipcMain.handle(IPC.forgeRepoInfo, (_event, repo: string, target: unknown) =>
    toResult(() => service.repoInfo(String(repo), typeof target === 'string' ? target : undefined))
  )
  ipcMain.handle(IPC.forgeCandidates, (_event, repo: string, query: unknown) =>
    toResult(() => service.candidates(String(repo), text(query)))
  )
  ipcMain.handle(IPC.forgeLabels, (_event, repo: string) =>
    toResult(() => service.labels(String(repo)))
  )
  ipcMain.handle(IPC.forgeTemplate, (_event, repo: string) =>
    toResult(async () => service.template(String(repo)))
  )
  ipcMain.handle(IPC.forgeCreatePull, (_event, repo: string, pull: unknown) =>
    toResult(() =>
      inAction('Create pull request', () => service.createPull(String(repo), newPull(pull)))
    )
  )
  ipcMain.handle(IPC.forgeUpdatePull, (_event, repo: string, number: number, change: unknown) =>
    toResult(() => service.updatePull(String(repo), Number(number), pullChange(change)))
  )
  ipcMain.handle(IPC.forgeMergePull, (_event, repo: string, number: number, options: unknown) =>
    toResult(() => service.mergePull(String(repo), Number(number), mergeOptions(options)))
  )
  ipcMain.handle(IPC.forgeCheckoutSource, (_event, repo: string, number: number) =>
    toResult(() => service.checkoutSource(String(repo), Number(number)))
  )
}
