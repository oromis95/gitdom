// Pull requests of the open repositories: which account to use for a host, the last list read
// for each repository, and the commits of a pull request fetched to show its changes.
import type {
  DeviceLogin,
  ForgeAccount,
  ForgeHost,
  ForgeKind,
  ForgeRepo,
  ForgeStatus,
  PullDetail,
  PullRange,
  PullRequest
} from '../../shared/forge'
import type { Remote } from '../../shared/types'
import { runGit } from '../git/exec'
import { inAction } from '../git/activity'
import type { AccountStore, Secret } from './accounts'
import { credentialFill, type Credential } from './credential'
import { detectForge, remotesOn } from './detect'
import {
  deviceEndpoints,
  pollDeviceToken,
  refreshToken,
  requestDeviceCode,
  type DeviceCode,
  type DeviceEndpoints
} from './device'
import { github } from './github'
import { gitlab } from './gitlab'
import { ForgeError, send } from './http'
import type { ForgeProvider } from './provider'

// Bitbucket and Azure DevOps come next (ROADMAP Step 20): their repositories show no section yet
const PROVIDERS: Partial<Record<ForgeKind, ForgeProvider>> = { github, gitlab }

/** Where a token for API access is created, with the permissions GitDom needs. */
export function tokenPage(kind: ForgeKind, host: string): string {
  if (kind === 'gitlab')
    return `https://${host}/-/user_settings/personal_access_tokens?name=GitDom&scopes=api`
  return `https://${host}/settings/tokens/new?scopes=repo,read:org&description=GitDom`
}

// The refs a pull request's commits are fetched into, out of the way of branches and tags
const PULL_REFS = 'refs/gitdom/pull/'

/** Branch names a service sends, checked before they go into a refspec. */
const safeBranch = (name: string): boolean => /^[^\s:~^?*[\\]+$/.test(name) && !name.startsWith('-')

const MAX_AVATAR = 512 * 1024

interface Login {
  endpoints: DeviceEndpoints
  code: DeviceCode
  host: string
  kind: ForgeKind
  abort: AbortController
}

export class ForgeService {
  private hosts: ForgeHost[] = []
  /** The last status read for each repository: fetching a pull request looks it up there */
  private statuses = new Map<string, ForgeStatus>()
  /** Hosts whose Git Credential Manager token was refused this session: not asked again */
  private gcmRefused = new Set<string>()
  private logins = new Map<number, Login>()
  private lastLogin = 0
  private avatars = new Map<string, Promise<string | null>>()

  constructor(
    private readonly accounts: AccountStore,
    /** Git's stored credential for a host; replaced in tests */
    private readonly fill: (host: string) => Promise<Credential | null> = credentialFill
  ) {}

  setHosts(hosts: ForgeHost[]): void {
    this.hosts = hosts
  }

  listAccounts(): ForgeAccount[] {
    return this.accounts.list()
  }

  private provider(kind: ForgeKind): ForgeProvider {
    const provider = PROVIDERS[kind]
    if (!provider) throw new Error(`Pull requests on this service aren't supported yet`)
    return provider
  }

  /** A usable token for the host: the saved one (renewed when expired) or Git Credential Manager's. */
  private async token(host: string): Promise<string | null> {
    const account = this.accounts.find(host)
    if (!account) return null
    let secret = this.accounts.secret(host)
    if (!secret && account.source === 'gcm' && !this.gcmRefused.has(host)) {
      const credential = await this.fill(host)
      if (credential) {
        secret = { token: credential.password }
        this.accounts.save(account, secret)
      }
    }
    if (!secret) return null
    if (secret.expiresAt && secret.expiresAt < Date.now() + 60000 && secret.refresh) {
      const endpoints = deviceEndpoints(account.kind, host)
      if (!endpoints) return null
      secret = await refreshToken(endpoints, secret.refresh)
      this.accounts.save(account, secret)
    }
    return secret.token
  }

  /** The service a repository is on, and its open pull requests when there's an account for it. */
  async status(repoPath: string, remotes: Remote[]): Promise<ForgeStatus> {
    const repo = detectForge(remotes, this.hosts)
    if (!repo || !PROVIDERS[repo.kind]) return this.remember(repoPath, { state: 'none' })
    const device = !!deviceEndpoints(repo.kind, repo.host)
    if (!this.accounts.find(repo.host))
      return this.remember(repoPath, { state: 'signedOut', repo, device })
    try {
      const token = await this.token(repo.host)
      if (!token)
        throw new ForgeError(`No token for ${repo.host}: connect the account again`, 401, true)
      const { viewer, pulls } = await this.provider(repo.kind).load(
        { host: repo.host, token },
        repo.path
      )
      await this.pruneRefs(repoPath, pulls).catch(() => undefined)
      return this.remember(repoPath, {
        state: 'ready',
        repo,
        viewer,
        pulls,
        remotes: remotesOn(remotes, repo),
        fetchedAt: Date.now()
      })
    } catch (e) {
      const auth = e instanceof ForgeError && e.auth
      if (auth) this.refused(repo.host)
      return this.remember(repoPath, {
        state: 'error',
        repo,
        error: e instanceof Error ? e.message : String(e),
        auth,
        device
      })
    }
  }

  private remember(repoPath: string, status: ForgeStatus): ForgeStatus {
    this.statuses.set(repoPath, status)
    return status
  }

  /** The token was refused: Git Credential Manager's isn't asked for again this session. */
  private refused(host: string): void {
    if (this.accounts.find(host)?.source === 'gcm') this.gcmRefused.add(host)
    this.accounts.drop(host)
  }

  private ready(repoPath: string): Extract<ForgeStatus, { state: 'ready' }> {
    const status = this.statuses.get(repoPath)
    if (status?.state !== 'ready')
      throw new Error('The pull requests of this repository are not loaded')
    return status
  }

  private pull(repoPath: string, number: number): { repo: ForgeRepo; pull: PullRequest } {
    const status = this.ready(repoPath)
    const pull = status.pulls.find((p) => p.number === number)
    if (!pull) throw new Error(`#${number} is no longer open`)
    return { repo: status.repo, pull }
  }

  async detail(repoPath: string, number: number): Promise<PullDetail> {
    const { repo } = this.pull(repoPath, number)
    const token = await this.token(repo.host)
    if (!token) throw new ForgeError(`No token for ${repo.host}`, 401, true)
    return this.provider(repo.kind).detail({ host: repo.host, token }, repo.path, number)
  }

  /**
   * Fetches a pull request's commits and its target branch, and returns the range of its changes:
   * from where it left the target branch to its last commit, as the service shows them.
   */
  async fetchPull(repoPath: string, number: number): Promise<PullRange> {
    const { repo, pull } = this.pull(repoPath, number)
    const headRef = this.provider(repo.kind).headRef(number)
    if (!headRef) throw new Error(`Fetching pull requests from this service isn't supported yet`)
    if (!safeBranch(pull.targetBranch))
      throw new Error(`Unexpected branch name: ${pull.targetBranch}`)
    const head = `${PULL_REFS}${number}/head`
    const base = `${PULL_REFS}${number}/base`
    return inAction(`Fetch ${repo.kind === 'gitlab' ? '!' : '#'}${number}`, async () => {
      await runGit(
        repoPath,
        [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          repo.remote,
          `+${headRef}:${head}`,
          `+refs/heads/${pull.targetBranch}:${base}`
        ],
        { withStderr: true }
      )
      const to = (await runGit(repoPath, ['rev-parse', '--verify', `${head}^{commit}`])).trim()
      const from = (await runGit(repoPath, ['merge-base', base, head])).trim()
      return { from, to }
    })
  }

  /** Removes the fetched refs of pull requests that are no longer open. */
  private async pruneRefs(repoPath: string, open: PullRequest[]): Promise<void> {
    const refs = (await runGit(repoPath, ['for-each-ref', '--format=%(refname)', PULL_REFS]))
      .split('\n')
      .filter(Boolean)
    const keep = new Set(open.map((p) => String(p.number)))
    const stale = refs.filter((ref) => !keep.has(ref.slice(PULL_REFS.length).split('/')[0]))
    if (stale.length)
      await runGit(repoPath, ['update-ref', '--stdin'], {
        input: stale.map((ref) => `delete ${ref}\n`).join('')
      })
  }

  /**
   * Connects the host with Git Credential Manager's token, when it has one the API accepts.
   * Null when there's none: the user then logs in or types a token.
   */
  async connectWithGit(host: string, kind: ForgeKind): Promise<ForgeAccount | null> {
    const credential = await this.fill(host)
    if (!credential) return null
    try {
      return await this.connect(host, kind, 'gcm', { token: credential.password })
    } catch (e) {
      // A password rather than a token, or one without the API's permissions
      if (e instanceof ForgeError && e.auth) return null
      throw e
    }
  }

  /** Checks a token with the service and saves the account. */
  async connect(
    host: string,
    kind: ForgeKind,
    source: ForgeAccount['source'],
    secret: Secret
  ): Promise<ForgeAccount> {
    const user = await this.provider(kind).viewer({ host, token: secret.token })
    this.gcmRefused.delete(host)
    this.accounts.save({ host, kind, user, source }, secret)
    return { host, kind, user, source }
  }

  disconnect(host: string): void {
    this.accounts.remove(host)
    this.gcmRefused.delete(host)
  }

  async startLogin(host: string, kind: ForgeKind): Promise<DeviceLogin> {
    const endpoints = deviceEndpoints(kind, host)
    if (!endpoints) throw new Error(`Device login isn't available for ${host}`)
    const code = await requestDeviceCode(endpoints)
    const id = ++this.lastLogin
    this.logins.set(id, { endpoints, code, host, kind, abort: new AbortController() })
    return {
      id,
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      expiresIn: code.expiresIn
    }
  }

  /** Resolves once the user approved the login on the service's page. */
  async finishLogin(id: number): Promise<ForgeAccount> {
    const login = this.logins.get(id)
    if (!login) throw new Error('No login in progress')
    try {
      const secret = await pollDeviceToken(login.endpoints, login.code, login.abort.signal)
      return await this.connect(login.host, login.kind, 'oauth', secret)
    } finally {
      this.logins.delete(id)
    }
  }

  cancelLogin(id: number): void {
    this.logins.get(id)?.abort.abort()
  }

  /**
   * A profile picture as a data: URL, loaded here so the interface needn't allow every host in its
   * content security policy. Kept for the session; null when it can't be loaded.
   */
  avatar(url: string): Promise<string | null> {
    let cached = this.avatars.get(url)
    if (!cached) {
      cached = loadImage(url).catch(() => null)
      this.avatars.set(url, cached)
    }
    return cached
  }
}

async function loadImage(url: string): Promise<string | null> {
  if (!/^https:\/\//i.test(url)) return null
  const response = await send(url)
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !type.startsWith('image/') || type.includes('svg')) return null
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_AVATAR) return null
  return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`
}
