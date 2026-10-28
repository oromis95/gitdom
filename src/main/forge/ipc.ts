// IPC of the pull requests. Tokens stay in this process: the interface only learns who is connected.
import { join } from 'path'
import { app, ipcMain, net, safeStorage, shell } from 'electron'
import { IPC, type Result } from '../../shared/api'
import { parseForgeHosts, type ForgeKind } from '../../shared/forge'
import type { Remote } from '../../shared/types'
import { GitError } from '../git/exec'
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

const KINDS = new Set<ForgeKind>(['github', 'gitlab', 'bitbucket', 'azure'])
const kindOf = (kind: unknown): ForgeKind => {
  if (!KINDS.has(kind as ForgeKind)) throw new Error(`Unknown service: ${String(kind)}`)
  return kind as ForgeKind
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
}
