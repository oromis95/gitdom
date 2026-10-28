// Pull requests of the open repositories: which account to use for a host, the last list read
// for each repository, and the commits of a pull request fetched to show its changes.
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import {
  PULL_NOUN,
  forkOwner,
  sameRepoPath,
  type Candidate,
  type DeviceLogin,
  type ForgeAccount,
  type ForgeHost,
  type ForgeKind,
  type ForgeRepo,
  type ForgeRepoInfo,
  type ForgeStatus,
  type MergeOptions,
  type MergeOutcome,
  type NewPull,
  type PullChange,
  type PullDetail,
  type PullLabel,
  type PullRange,
  type PullRequest,
  type PullSource
} from '../../shared/forge'
import type { Remote } from '../../shared/types'
import { runGit } from '../git/exec'
import { inAction } from '../git/activity'
import type { AccountStore, Secret } from './accounts'
import { azure, azureGitPath, azureParts } from './azure'
import { bitbucket } from './bitbucket'
import { bitbucketServer, serverParts } from './bitbucketServer'
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
import type { Created, ForgeProvider, ProviderContext } from './provider'

const PROVIDERS: Record<ForgeKind, ForgeProvider> = {
  github,
  gitlab,
  bitbucket,
  bitbucketServer,
  azure
}

/** Where a token for API access is created, with the permissions GitDom needs. */
export function tokenPage(kind: ForgeKind, host: string, repoPath: string): string {
  if (kind === 'gitlab')
    return `https://${host}/-/user_settings/personal_access_tokens?name=GitDom&scopes=api`
  if (kind === 'bitbucket') return 'https://id.atlassian.com/manage-profile/security/api-tokens'
  if (kind === 'bitbucketServer') {
    const context = repoPath ? serverParts(repoPath).context : []
    const root = [host, ...context.map(encodeURIComponent)].join('/')
    return `https://${root}/plugins/servlet/access-tokens/manage`
  }
  if (kind === 'azure') {
    const { collection } = azureParts(repoPath)
    return `https://${host}/${collection.map(encodeURIComponent).join('/')}/_usersSettings/tokens`
  }
  return `https://${host}/settings/tokens/new?scopes=repo,read:org&description=GitDom`
}

/** The path Git Credential Manager keys a host's token by, where it does (Azure DevOps). */
const credentialPath = (kind: ForgeKind, repoPath: string): string | undefined =>
  kind === 'azure' && repoPath ? azureGitPath(repoPath) : undefined

// The refs a pull request's commits are fetched into, out of the way of branches and tags
const PULL_REFS = 'refs/gitdom/pull/'

/** Branch names a service sends, checked before they go into a refspec. */
const safeBranch = (name: string): boolean => /^[^\s:~^?*[\\]+$/.test(name) && !name.startsWith('-')

/** Repository paths a service sends, checked before they go into a URL. */
const safeRepoPath = (path: string): boolean => /^[\w.-]+(\/[\w. -]+)+$/.test(path)

const MAX_AVATAR = 512 * 1024

/**
 * Where each service looks for the description template of a new pull request, folders ending
 * with a slash (their first Markdown file); names are matched whatever their case.
 */
const TEMPLATES: Record<ForgeKind, string[]> = {
  github: [
    '.github/pull_request_template.md',
    'pull_request_template.md',
    'docs/pull_request_template.md',
    '.github/pull_request_template/'
  ],
  gitlab: ['.gitlab/merge_request_templates/default.md', '.gitlab/merge_request_templates/'],
  bitbucket: [],
  bitbucketServer: [],
  azure: [
    '.azuredevops/pull_request_template.md',
    '.vsts/pull_request_template.md',
    'docs/pull_request_template.md',
    'pull_request_template.md'
  ]
}

/** A file or folder of `root` named like `path` but in any case, or null. */
function findInsensitive(root: string, path: string): string | null {
  let current = root
  for (const part of path.split('/').filter(Boolean)) {
    if (!existsSync(current) || !statSync(current).isDirectory()) return null
    const match = readdirSync(current).find((name) => name.toLowerCase() === part.toLowerCase())
    if (!match) return null
    current = join(current, match)
  }
  return current
}

/** The description template of the repository in the working tree, empty when it has none. */
export function readTemplate(root: string, kind: ForgeKind): string {
  for (const candidate of TEMPLATES[kind]) {
    const found = findInsensitive(root, candidate)
    if (!found) continue
    if (candidate.endsWith('/')) {
      if (!statSync(found).isDirectory()) continue
      const first = readdirSync(found)
        .filter((n) => n.toLowerCase().endsWith('.md'))
        .sort()[0]
      if (first) return readFileSync(join(found, first), 'utf8')
    } else if (statSync(found).isFile()) return readFileSync(found, 'utf8')
  }
  return ''
}

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
  /** What each repository allows, read once a session */
  private infos = new Map<string, Promise<ForgeRepoInfo | null>>()
  /** Pull requests closed in GitDom, by repository and number, to open them again */
  private closed = new Map<string, PullRequest>()

  constructor(
    private readonly accounts: AccountStore,
    /** Git's stored credential for a host; replaced in tests */
    private readonly fill: (
      host: string,
      path?: string
    ) => Promise<Credential | null> = credentialFill
  ) {}

  setHosts(hosts: ForgeHost[]): void {
    this.hosts = hosts
  }

  listAccounts(): ForgeAccount[] {
    return this.accounts.list()
  }

  /**
   * What to send to the host's API: the saved token (renewed when expired) or Git Credential
   * Manager's. `repoPath` is a repository on the host, for the services GCM keys tokens by path.
   */
  private async context(host: string, repoPath: string): Promise<ProviderContext | null> {
    const account = this.accounts.find(host)
    if (!account) return null
    let secret = this.accounts.secret(host)
    if (!secret && account.source === 'gcm' && !this.gcmRefused.has(host)) {
      const credential = await this.fill(host, credentialPath(account.kind, repoPath))
      if (credential) {
        secret = {
          token: credential.password,
          username: account.gcmUser ? credential.username : undefined
        }
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
    return { host, token: secret.token, username: secret.username }
  }

  private async requireContext(repo: ForgeRepo): Promise<ProviderContext> {
    const ctx = await this.context(repo.host, repo.path)
    if (!ctx)
      throw new ForgeError(`No token for ${repo.host}: connect the account again`, 401, true)
    return ctx
  }

  /** The service a repository is on, and its open pull requests when there's an account for it. */
  async status(repoPath: string, remotes: Remote[]): Promise<ForgeStatus> {
    const repo = detectForge(remotes, this.hosts)
    if (!repo) return this.remember(repoPath, { state: 'none' })
    const device = !!deviceEndpoints(repo.kind, repo.host)
    if (!this.accounts.find(repo.host))
      return this.remember(repoPath, { state: 'signedOut', repo, device })
    try {
      const ctx = await this.requireContext(repo)
      const [{ viewer, pulls }, info] = await Promise.all([
        PROVIDERS[repo.kind].load(ctx, repo.path),
        this.cachedInfo(ctx, repo)
      ])
      await this.pruneRefs(repoPath, pulls).catch(() => undefined)
      return this.remember(repoPath, {
        state: 'ready',
        repo,
        viewer,
        pulls,
        remotes: remotesOn(remotes, repo),
        info,
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

  private cachedInfo(ctx: ProviderContext, repo: ForgeRepo): Promise<ForgeRepoInfo | null> {
    const key = `${repo.host}/${repo.path}`
    let info = this.infos.get(key)
    if (!info) {
      // A token that can read but not see the settings still lists the pull requests
      info = PROVIDERS[repo.kind].info(ctx, repo.path).catch(() => null)
      this.infos.set(key, info)
      void info.then((value) => value ?? this.infos.delete(key))
    }
    return info
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

  private pull(
    repoPath: string,
    number: number
  ): { status: Extract<ForgeStatus, { state: 'ready' }>; pull: PullRequest } {
    const status = this.ready(repoPath)
    const pull = status.pulls.find((p) => p.number === number)
    if (!pull) throw new Error(`#${number} is no longer open`)
    return { status, pull }
  }

  /** What the repository allows; `target` is the branch a pull request goes into. */
  async repoInfo(repoPath: string, target?: string): Promise<ForgeRepoInfo> {
    const { repo } = this.ready(repoPath)
    return PROVIDERS[repo.kind].info(await this.requireContext(repo), repo.path, target)
  }

  async candidates(repoPath: string, query: string): Promise<Candidate[]> {
    const { repo } = this.ready(repoPath)
    return PROVIDERS[repo.kind].candidates(await this.requireContext(repo), repo.path, query)
  }

  async labels(repoPath: string): Promise<PullLabel[]> {
    const { repo } = this.ready(repoPath)
    return PROVIDERS[repo.kind].labels(await this.requireContext(repo), repo.path)
  }

  /** The description template of the repository, as the service would offer it. */
  template(repoPath: string): string {
    return readTemplate(repoPath, this.ready(repoPath).repo.kind)
  }

  /**
   * Opens a pull request from a local branch, already published: GitDom reads the remote and
   * branch it follows, which may be a fork's.
   */
  async createPull(repoPath: string, pull: NewPull): Promise<Created> {
    const status = this.ready(repoPath)
    const { repo } = status
    const config = async (key: string): Promise<string> =>
      (await runGit(repoPath, ['config', '--get', key], { okExitCodes: [1] })).trim()
    const remote = await config(`branch.${pull.branch}.remote`)
    const merge = await config(`branch.${pull.branch}.merge`)
    if (!remote || !merge) throw new Error(`Push ${pull.branch} first: it isn't on the remote yet`)
    const sourceRepo = status.remotes[remote]
    if (!sourceRepo)
      throw new Error(`${pull.branch} follows ${remote}, which isn't on ${repo.host}`)
    const sourceBranch = merge.replace(/^refs\/heads\//, '')
    for (const name of [sourceBranch, pull.targetBranch])
      if (!safeBranch(name)) throw new Error(`Unexpected branch name: ${name}`)
    const { branch: _branch, ...rest } = pull
    void _branch
    return PROVIDERS[repo.kind].create(await this.requireContext(repo), repo.path, {
      ...rest,
      sourceRepo,
      sourceBranch
    })
  }

  async updatePull(repoPath: string, number: number, change: PullChange): Promise<void> {
    const status = this.ready(repoPath)
    const key = `${repoPath}\n${number}`
    // A closed pull request isn't in the list any more: the one closed here can be opened again
    const pull =
      status.pulls.find((p) => p.number === number) ??
      (change.state === 'open' ? this.closed.get(key) : undefined)
    if (!pull) throw new Error(`#${number} is no longer open`)
    const ctx = await this.requireContext(status.repo)
    await PROVIDERS[status.repo.kind].update(ctx, status.repo.path, pull, change)
    if (change.state === 'closed') this.closed.set(key, pull)
    if (change.state === 'open') this.closed.delete(key)
  }

  async mergePull(repoPath: string, number: number, options: MergeOptions): Promise<MergeOutcome> {
    const { status, pull } = this.pull(repoPath, number)
    const ctx = await this.requireContext(status.repo)
    return PROVIDERS[status.repo.kind].merge(ctx, status.repo.path, pull, options)
  }

  /**
   * Where a pull request's branch is, to check it out: a remote of the repository (origin, or a
   * fork already added), or the fork's address, to add it as a remote or take its commits once.
   */
  async checkoutSource(repoPath: string, number: number): Promise<PullSource> {
    const { status, pull } = this.pull(repoPath, number)
    const owner = forkOwner(status.repo.kind, pull.sourceRepo)
    const remote = sameRepoPath(pull.sourceRepo, status.repo.path)
      ? status.repo.remote
      : Object.entries(status.remotes).find(([, path]) => sameRepoPath(path, pull.sourceRepo))?.[0]
    if (remote) return { remote, url: null, branch: pull.sourceBranch, owner }
    const url = await this.forkUrl(repoPath, status.repo, pull).catch(() => null)
    return { remote: null, url, branch: pull.sourceBranch, owner }
  }

  async detail(repoPath: string, number: number): Promise<PullDetail> {
    const { repo } = this.pull(repoPath, number).status
    const ctx = await this.requireContext(repo)
    return PROVIDERS[repo.kind].detail(ctx, repo.path, number)
  }

  /**
   * Where a pull request's last commit is fetched from: the pull request's own ref on the
   * repository it targets, where the service has one, otherwise its source branch, from the remote
   * of the repository it's in, or from the fork's address.
   */
  private async source(
    repoPath: string,
    status: Extract<ForgeStatus, { state: 'ready' }>,
    pull: PullRequest
  ): Promise<{ from: string; ref: string }> {
    const { repo } = status
    const headRef = PROVIDERS[repo.kind].headRef(pull.number)
    if (headRef) return { from: repo.remote, ref: headRef }
    if (!safeBranch(pull.sourceBranch))
      throw new Error(`Unexpected branch name: ${pull.sourceBranch}`)
    const ref = `refs/heads/${pull.sourceBranch}`
    if (sameRepoPath(pull.sourceRepo, repo.path)) return { from: repo.remote, ref }
    const remote = Object.entries(status.remotes).find(([, path]) =>
      sameRepoPath(path, pull.sourceRepo)
    )?.[0]
    if (remote) return { from: remote, ref }
    return { from: await this.forkUrl(repoPath, repo, pull), ref }
  }

  /**
   * The address of the fork a pull request comes from: the one the service gives (Azure DevOps),
   * or the remote's, with the fork's path in place of the repository's.
   */
  private async forkUrl(repoPath: string, repo: ForgeRepo, pull: PullRequest): Promise<string> {
    if (pull.sourceUrl && /^https:\/\//.test(pull.sourceUrl)) return pull.sourceUrl
    if (!safeRepoPath(pull.sourceRepo)) throw new Error(`Unexpected fork name: ${pull.sourceRepo}`)
    // A folder on Windows has backslashes; git takes forward slashes there too
    const url = (await runGit(repoPath, ['remote', 'get-url', repo.remote]))
      .trim()
      .replaceAll('\\', '/')
    const at = url.toLowerCase().lastIndexOf(repo.path.toLowerCase())
    if (at < 0) throw new Error(`Can't tell where the fork ${pull.sourceRepo} is`)
    return url.slice(0, at) + pull.sourceRepo + url.slice(at + repo.path.length)
  }

  /**
   * Fetches a pull request's commits and its target branch, and returns the range of its changes:
   * from where it left the target branch to its last commit, as the service shows them.
   */
  async fetchPull(repoPath: string, number: number): Promise<PullRange> {
    const { status, pull } = this.pull(repoPath, number)
    const { repo } = status
    if (!safeBranch(pull.targetBranch))
      throw new Error(`Unexpected branch name: ${pull.targetBranch}`)
    const source = await this.source(repoPath, status, pull)
    const head = `${PULL_REFS}${number}/head`
    const base = `${PULL_REFS}${number}/base`
    const fetch = (from: string, ...refspecs: string[]): Promise<string> =>
      runGit(repoPath, ['fetch', '--no-tags', '--no-write-fetch-head', from, ...refspecs], {
        withStderr: true
      })
    return inAction(`Fetch ${PULL_NOUN[repo.kind].prefix}${number}`, async () => {
      const target = `+refs/heads/${pull.targetBranch}:${base}`
      if (source.from === repo.remote) await fetch(repo.remote, `+${source.ref}:${head}`, target)
      else {
        await fetch(source.from, `+${source.ref}:${head}`)
        await fetch(repo.remote, target)
      }
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
  async connectWithGit(
    host: string,
    kind: ForgeKind,
    repoPath: string
  ): Promise<ForgeAccount | null> {
    const credential = await this.fill(host, credentialPath(kind, repoPath))
    if (!credential) return null
    // Bitbucket takes an app password (on Data Center, a password or a token) with its username,
    // an OAuth token alone
    const tries: Secret[] =
      (kind === 'bitbucket' || kind === 'bitbucketServer') && credential.username
        ? [
            { token: credential.password, username: credential.username },
            { token: credential.password }
          ]
        : [{ token: credential.password }]
    for (const secret of tries) {
      try {
        return await this.connect(host, kind, 'gcm', secret, repoPath)
      } catch (e) {
        // A password rather than a token, or one without the API's permissions
        if (!(e instanceof ForgeError && e.auth)) throw e
      }
    }
    return null
  }

  /** Checks a token with the service and saves the account. */
  async connect(
    host: string,
    kind: ForgeKind,
    source: ForgeAccount['source'],
    secret: Secret,
    repoPath: string
  ): Promise<ForgeAccount> {
    const user = await PROVIDERS[kind].viewer(
      { host, token: secret.token, username: secret.username },
      repoPath
    )
    this.gcmRefused.delete(host)
    const gcmUser = source === 'gcm' && !!secret.username
    this.accounts.save({ host, kind, user, source, ...(gcmUser ? { gcmUser } : {}) }, secret)
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
      return await this.connect(login.host, login.kind, 'oauth', secret, '')
    } finally {
      this.logins.delete(id)
    }
  }

  cancelLogin(id: number): void {
    this.logins.get(id)?.abort.abort()
  }

  /**
   * A profile picture as a data: URL, loaded here so the interface needn't allow every host in its
   * content security policy. Kept for the session; null when it can't be loaded. Pictures on a
   * connected host (Azure DevOps keeps them behind the login) are asked for with its token.
   */
  avatar(url: string): Promise<string | null> {
    let cached = this.avatars.get(url)
    if (!cached) {
      cached = this.loadImage(url).catch(() => null)
      this.avatars.set(url, cached)
    }
    return cached
  }

  private async loadImage(url: string): Promise<string | null> {
    if (!/^https:\/\//i.test(url)) return null
    const host = new URL(url).hostname
    const account = this.accounts.find(host)
    const secret = account && this.accounts.secret(host)
    const headers =
      account && secret
        ? PROVIDERS[account.kind].auth({ host, token: secret.token, username: secret.username })
        : {}
    const response = await send(url, { headers })
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !type.startsWith('image/') || type.includes('svg')) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_AVATAR) return null
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`
  }
}
