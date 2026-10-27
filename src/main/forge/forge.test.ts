import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseForgeHosts } from '../../shared/forge'
import type { Remote } from '../../shared/types'
import { AccountStore, type Cipher } from './accounts'
import { parseCredential } from './credential'
import { detectForge, parseRemoteUrl, remotesOn } from './detect'
import { pollDeviceToken, type DeviceEndpoints } from './device'
import { githubPull, mergeability } from './github'
import { gitlabPull } from './gitlab'
import { graphql, requestJson, setFetcher } from './http'
import { ForgeService } from './service'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })

const remote = (name: string, url: string): Remote => ({ name, fetchUrl: url, pushUrl: url })

describe('parseRemoteUrl', () => {
  it.each([
    ['https://github.com/acme/widgets.git', 'github.com', 'acme/widgets'],
    ['https://user@github.com/acme/widgets', 'github.com', 'acme/widgets'],
    ['git@github.com:acme/widgets.git', 'github.com', 'acme/widgets'],
    ['ssh://git@ssh.github.com:443/acme/widgets.git', 'github.com', 'acme/widgets'],
    ['https://gitlab.com/group/sub/project.git/', 'gitlab.com', 'group/sub/project'],
    ['git@bitbucket.org:team/repo.git', 'bitbucket.org', 'team/repo'],
    ['https://org@dev.azure.com/org/Project/_git/repo', 'dev.azure.com', 'org/Project/repo'],
    ['git@ssh.dev.azure.com:v3/org/Project/repo', 'dev.azure.com', 'org/Project/repo'],
    [
      'https://org.visualstudio.com/DefaultCollection/Project/_git/repo',
      'dev.azure.com',
      'org/Project/repo'
    ],
    ['ssh://git@git.example.com:2222/team/app.git', 'git.example.com', 'team/app']
  ])('%s', (url, host, path) => {
    expect(parseRemoteUrl(url)).toEqual({ host, path })
  })

  it('ignores local paths and URLs without a repository', () => {
    for (const url of [
      'C:\\repos\\app',
      '/srv/git/app.git',
      'file:///srv/app',
      'https://github.com/acme'
    ])
      expect(parseRemoteUrl(url)).toBeNull()
  })
})

describe('detectForge', () => {
  it('prefers upstream, the repository a fork sends pull requests to', () => {
    const remotes = [
      remote('origin', 'https://github.com/me/widgets.git'),
      remote('upstream', 'git@github.com:acme/widgets.git')
    ]
    expect(detectForge(remotes, [])).toEqual({
      kind: 'github',
      host: 'github.com',
      path: 'acme/widgets',
      remote: 'upstream',
      webUrl: 'https://github.com/acme/widgets'
    })
    expect(remotesOn(remotes, detectForge(remotes, [])!)).toEqual({
      origin: 'me/widgets',
      upstream: 'acme/widgets'
    })
  })

  it('knows servers listed in the preferences, and nothing else', () => {
    const remotes = [remote('origin', 'https://git.example.com/team/app.git')]
    expect(detectForge(remotes, [])).toBeNull()
    const hosts = parseForgeHosts('https://git.example.com/ gitlab\nnonsense\nother.com svn')
    expect(hosts).toEqual([{ host: 'git.example.com', kind: 'gitlab' }])
    expect(detectForge(remotes, hosts)?.kind).toBe('gitlab')
  })

  it('links Azure DevOps repositories to their web page', () => {
    const repo = detectForge([remote('origin', 'git@ssh.dev.azure.com:v3/org/Proj/app')], [])
    expect(repo?.webUrl).toBe('https://dev.azure.com/org/Proj/_git/app')
  })
})

const actor = (login: string): { login: string; avatarUrl: string; name: string } => ({
  login,
  avatarUrl: `https://avatars.githubusercontent.com/${login}`,
  name: login.toUpperCase()
})

function githubNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: 'Add widgets',
    url: 'https://github.com/acme/widgets/pull/42',
    isDraft: false,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-21T10:00:00Z',
    author: actor('ann'),
    headRefName: 'feature/widgets',
    headRefOid: 'a'.repeat(40),
    baseRefName: 'main',
    headRepository: { nameWithOwner: 'ann/widgets' },
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    totalCommentsCount: 3,
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    reviewRequests: {
      nodes: [
        { requestedReviewer: { login: 'bob', avatarUrl: null, name: 'Bob' } },
        { requestedReviewer: { teamName: 'Core', slug: 'core', teamAvatar: null } }
      ]
    },
    latestOpinionatedReviews: {
      nodes: [
        { state: 'APPROVED', author: actor('cy') },
        { state: 'CHANGES_REQUESTED', author: actor('bob') }
      ]
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: 'FAILURE',
              contexts: {
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'build',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                    detailsUrl: 'https://ci/build'
                  },
                  {
                    __typename: 'CheckRun',
                    name: 'lint',
                    status: 'IN_PROGRESS',
                    conclusion: null,
                    detailsUrl: null
                  },
                  {
                    __typename: 'StatusContext',
                    context: 'ci/legacy',
                    state: 'ERROR',
                    targetUrl: null
                  }
                ]
              }
            }
          }
        }
      ]
    },
    ...overrides
  }
}

describe('GitHub pull requests', () => {
  it('maps reviews, checks and mergeability', () => {
    const pull = githubPull(githubNode() as never, 'acme/widgets')
    expect(pull).toMatchObject({
      number: 42,
      state: 'open',
      sourceBranch: 'feature/widgets',
      sourceRepo: 'ann/widgets',
      targetBranch: 'main',
      review: 'required',
      comments: 3,
      labels: [{ name: 'bug', color: '#d73a4a' }],
      merge: { state: 'blocked', reason: 'Review required' }
    })
    // Bob was asked again after asking for changes: the request is what's pending
    expect(pull.reviewers.map((r) => [r.user.login, r.vote])).toEqual([
      ['cy', 'approved'],
      ['bob', 'requested'],
      ['core', 'requested']
    ])
    expect(pull.checks).toEqual({
      state: 'failure',
      url: 'https://github.com/acme/widgets/pull/42/checks',
      items: [
        { name: 'build', state: 'success', url: 'https://ci/build' },
        { name: 'lint', state: 'pending', url: null },
        { name: 'ci/legacy', state: 'failure', url: null }
      ]
    })
  })

  it('tells drafts, conflicts and branches behind apart', () => {
    expect(githubPull(githubNode({ isDraft: true }) as never, 'a/b')).toMatchObject({
      state: 'draft',
      merge: { state: 'draft' }
    })
    expect(githubPull(githubNode({ mergeable: 'CONFLICTING' }) as never, 'a/b').merge.state).toBe(
      'conflicts'
    )
    const noChecks = githubPull(
      githubNode({
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        headRepository: null
      }) as never,
      'a/b'
    )
    expect(noChecks.checks).toBeNull()
    expect(noChecks.sourceRepo).toBe('a/b')
  })
})

describe('GitHub mergeability', () => {
  const facts = { isDraft: false, reviewDecision: null, mergeable: 'MERGEABLE' }
  it("guesses it from the list, which doesn't ask GitHub's verdict", () => {
    expect(mergeability(facts, 'failure')).toEqual({
      state: 'clean',
      reason: 'Some checks are failing'
    })
    expect(mergeability({ ...facts, mergeable: 'UNKNOWN' }, null).state).toBe('unknown')
    expect(mergeability({ ...facts, reviewDecision: 'CHANGES_REQUESTED' }, null)).toEqual({
      state: 'blocked',
      reason: 'Changes requested'
    })
  })

  it('follows GitHub’s verdict for one pull request', () => {
    expect(mergeability({ ...facts, mergeStateStatus: 'BEHIND' }, null).state).toBe('behind')
    expect(mergeability({ ...facts, mergeStateStatus: 'BLOCKED' }, 'success')).toEqual({
      state: 'blocked',
      reason: 'Blocked by the branch rules'
    })
    expect(mergeability({ ...facts, mergeStateStatus: 'CLEAN' }, 'success').state).toBe('clean')
  })
})

describe('GitLab merge requests', () => {
  type Answer = { data: { project: { mergeRequests: { nodes: never[] } } } }
  const nodes = (fixture('gitlab-pulls.json') as Answer).data.project.mergeRequests.nodes

  it('reads a real answer of gitlab.com', () => {
    const pulls = nodes.map((n) => gitlabPull('gitlab.com', n, 'gitlab-org/gitlab-runner'))
    const [fork, mergeable, changes] = pulls
    expect(fork).toMatchObject({
      number: 7722,
      sourceRepo: 'gitlab-renovate-forks/gitlab-runner',
      review: 'required',
      merge: { state: 'blocked', reason: 'Approval required' },
      checks: { state: 'success' }
    })
    expect(fork.checks?.url).toMatch(/^https:\/\/gitlab\.com\/.+\/pipelines\/\d+$/)
    expect(fork.checks?.items[0].url).toMatch(/^https:\/\/gitlab\.com\/.+\/jobs\/\d+$/)
    expect(mergeable).toMatchObject({ merge: { state: 'clean' }, checks: { state: 'pending' } })
    expect(changes).toMatchObject({ review: 'changes', merge: { reason: 'Changes requested' } })
    // Avatars uploaded to GitLab come as paths on the server
    for (const pull of pulls)
      for (const r of pull.reviewers) expect(r.user.avatarUrl ?? 'https://').toMatch(/^https:\/\//)
  })
})

describe('requests', () => {
  afterEach(() => setFetcher(() => Promise.reject(new Error('no network in tests'))))

  it('turns refusals and rate limits into clear errors', async () => {
    setFetcher(async () => json({ message: 'Bad credentials' }, 401))
    await expect(requestJson('https://api.github.com/graphql')).rejects.toMatchObject({
      status: 401,
      auth: true,
      message: 'api.github.com refused the token: Bad credentials'
    })
    setFetcher(async () =>
      json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' })
    )
    await expect(requestJson('https://api.github.com/graphql')).rejects.toMatchObject({
      auth: false,
      message: expect.stringContaining('too many requests')
    })
    setFetcher(() => Promise.reject(new Error('ECONNRESET')))
    await expect(requestJson('https://gitlab.com/api/graphql')).rejects.toMatchObject({
      status: 0,
      message: "Can't reach gitlab.com: ECONNRESET"
    })
  })

  it('sends the token and reports a missing permission as a refusal', async () => {
    const seen: RequestInit[] = []
    setFetcher(async (_url, init) => {
      seen.push(init)
      return json({
        data: null,
        errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'needs read:org' }]
      })
    })
    await expect(
      graphql('https://api.github.com/graphql', 'tok', 'query { a }', {})
    ).rejects.toMatchObject({
      auth: true,
      message: 'needs read:org'
    })
    expect((seen[0].headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })
})

describe('parseCredential', () => {
  it('reads the password git credential fill prints', () => {
    expect(
      parseCredential('protocol=https\nhost=github.com\nusername=ann\npassword=gho_x=y\n')
    ).toEqual({ username: 'ann', password: 'gho_x=y' })
    expect(parseCredential('protocol=https\nhost=github.com\n')).toBeNull()
  })
})

const fakeCipher = (available = true): Cipher => ({
  available: () => available,
  encrypt: (text) => `enc:${Buffer.from(text).toString('base64')}`,
  decrypt: (text) => Buffer.from(text.slice(4), 'base64').toString()
})

describe('AccountStore', () => {
  let dir: string
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'gitdom-accounts-'))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const user = { login: 'ann', name: null, avatarUrl: null }

  it('saves tokens encrypted, and never Git Credential Manager’s', () => {
    const path = join(dir, 'accounts.json')
    const store = new AccountStore(path, fakeCipher())
    store.save({ host: 'github.com', kind: 'github', user, source: 'token' }, { token: 'secret-1' })
    store.save({ host: 'gitlab.com', kind: 'gitlab', user, source: 'gcm' }, { token: 'secret-2' })
    const text = readFileSync(path, 'utf8')
    expect(text).not.toContain('secret-1')
    expect(text).not.toContain('secret-2')

    const again = new AccountStore(path, fakeCipher())
    again.load()
    expect(again.list().map((a) => [a.host, a.source])).toEqual([
      ['github.com', 'token'],
      ['gitlab.com', 'gcm']
    ])
    expect(again.secret('github.com')?.token).toBe('secret-1')
    expect(again.secret('gitlab.com')).toBeNull()
    again.remove('github.com')
    expect(readFileSync(path, 'utf8')).not.toContain('github.com')
  })

  it('keeps tokens only for the session when nothing can encrypt them', () => {
    const path = join(dir, 'accounts.json')
    const store = new AccountStore(path, fakeCipher(false))
    store.save({ host: 'github.com', kind: 'github', user, source: 'token' }, { token: 'secret' })
    expect(store.list()).toHaveLength(1)
    expect(store.secret('github.com')?.token).toBe('secret')
    expect(readFileSync(path, 'utf8')).not.toContain('secret')
  })
})

describe('device login', () => {
  const endpoints: DeviceEndpoints = {
    codeUrl: 'https://gitlab.com/oauth/authorize_device',
    tokenUrl: 'https://gitlab.com/oauth/token',
    clientId: 'id',
    scope: 'api'
  }
  afterEach(() => vi.useRealTimers())

  it('waits while pending, slows down when asked, and returns the token', async () => {
    vi.useFakeTimers()
    const answers = [
      json({ error: 'authorization_pending' }, 400),
      json({ error: 'slow_down' }),
      json({ access_token: 'tok', refresh_token: 'ref', expires_in: 7200 })
    ]
    const bodies: string[] = []
    setFetcher(async (_url, init) => {
      bodies.push(String(init.body))
      return answers.shift()!
    })
    const code = {
      deviceCode: 'dc',
      userCode: 'ABCD',
      verificationUri: 'https://x',
      expiresIn: 900,
      interval: 5
    }
    const done = pollDeviceToken(endpoints, code, new AbortController().signal, () => 1000)
    await vi.advanceTimersByTimeAsync(5000 + 5000 + 10000)
    await expect(done).resolves.toEqual({ token: 'tok', refresh: 'ref', expiresAt: 1000 + 7200000 })
    expect(bodies[0]).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code')
  })

  it('stops when the user refuses', async () => {
    vi.useFakeTimers()
    setFetcher(async () => json({ error: 'access_denied' }))
    const code = {
      deviceCode: 'dc',
      userCode: 'A',
      verificationUri: 'https://x',
      expiresIn: 900,
      interval: 1
    }
    const done = pollDeviceToken(endpoints, code, new AbortController().signal)
    const failed = expect(done).rejects.toThrow('The login was refused')
    await vi.advanceTimersByTimeAsync(1000)
    await failed
  })
})

describe('ForgeService', () => {
  let dir: string
  let repo: string
  let origin: string
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', input: '' }).trim()
  const remotes = [remote('origin', 'https://github.com/acme/widgets.git')]
  const user = { login: 'ann', name: 'Ann', avatarUrl: null }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitdom-forge-'))
    origin = join(dir, 'origin.git')
    repo = join(dir, 'repo')
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 't@t.it')
    git(repo, 'config', 'user.name', 'T')
    writeFileSync(join(repo, 'a.txt'), '1\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')
    git(repo, 'remote', 'add', 'origin', origin)
    git(repo, 'push', '-q', 'origin', 'main')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function service(
    fill: () => Promise<{ username: string; password: string } | null> = async () => null
  ): {
    service: ForgeService
    store: AccountStore
  } {
    const store = new AccountStore(join(dir, 'accounts.json'), fakeCipher())
    return { service: new ForgeService(store, fill), store }
  }

  const answer = (nodes: unknown[]): Response =>
    json({ data: { viewer: actor('ann'), repository: { pullRequests: { nodes } } } })

  it('is signed out until an account is connected, then lists the pull requests', async () => {
    const { service: s } = service()
    expect(await s.status(repo, [remote('origin', 'C:\\local\\copy')])).toEqual({ state: 'none' })
    expect(await s.status(repo, remotes)).toMatchObject({ state: 'signedOut', device: false })

    setFetcher(async () => json({ data: { viewer: user } }))
    await s.connect('github.com', 'github', 'token', { token: 'tok' })
    setFetcher(async () => answer([githubNode()]))
    const status = await s.status(repo, remotes)
    expect(status).toMatchObject({
      state: 'ready',
      viewer: { login: 'ann' },
      remotes: { origin: 'acme/widgets' }
    })
    expect(status.state === 'ready' && status.pulls[0].number).toBe(42)
  })

  it("uses Git Credential Manager's token, and stops asking once it's refused", async () => {
    const fill = vi.fn(async () => ({ username: 'ann', password: 'gcm-token' }))
    const { service: s } = service(fill)
    setFetcher(async () => json({ data: { viewer: user } }))
    expect(await s.connectWithGit('github.com', 'github')).toMatchObject({ source: 'gcm' })

    const tokens: string[] = []
    setFetcher(async (_url, init) => {
      tokens.push((init.headers as Record<string, string>).Authorization)
      return json({ message: 'Bad credentials' }, 401)
    })
    expect(await s.status(repo, remotes)).toMatchObject({ state: 'error', auth: true })
    expect(tokens).toEqual(['Bearer gcm-token'])
    expect(await s.status(repo, remotes)).toMatchObject({ state: 'error', auth: true })
    // Asked once to connect; after the refusal it isn't asked again
    expect(fill).toHaveBeenCalledTimes(1)
    expect(tokens).toHaveLength(1)
  })

  it("leaves teams out when the token can't read them, as Git Credential Manager's can't", async () => {
    const { service: s } = service()
    setFetcher(async () => json({ data: { viewer: user } }))
    await s.connect('github.com', 'github', 'token', { token: 'tok' })
    const queries: string[] = []
    setFetcher(async (_url, init) => {
      const { query } = JSON.parse(String(init.body)) as { query: string }
      queries.push(query)
      return query.includes('on Team')
        ? json({
            data: null,
            errors: [
              {
                type: 'INSUFFICIENT_SCOPES',
                message: "The 'name' field requires one of the following scopes: ['read:org']"
              }
            ]
          })
        : answer([githubNode()])
    })
    expect(await s.status(repo, remotes)).toMatchObject({ state: 'ready' })
    await s.status(repo, remotes)
    // Asked with teams once; then without them
    expect(queries.map((q) => q.includes('on Team'))).toEqual([true, false, false])
  })

  it('returns null when Git Credential Manager has nothing usable', async () => {
    const { service: s } = service(async () => ({ username: 'ann', password: 'a-password' }))
    setFetcher(async () => json({ message: 'Bad credentials' }, 401))
    expect(await s.connectWithGit('github.com', 'github')).toBeNull()
  })

  it("fetches a pull request's commits and finds where it left the target branch", async () => {
    // The pull request: two commits on a branch, published only as GitHub's pull ref
    git(repo, 'checkout', '-q', '-b', 'feature')
    for (const n of [2, 3]) {
      writeFileSync(join(repo, 'a.txt'), `${n}\n`)
      git(repo, 'commit', '-q', '-am', `c${n}`)
    }
    const head = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'push', '-q', 'origin', 'feature:refs/pull/42/head')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'branch', '-q', '-D', 'feature')
    const base = git(repo, 'rev-parse', 'HEAD')

    const { service: s } = service()
    setFetcher(async () => json({ data: { viewer: user } }))
    await s.connect('github.com', 'github', 'token', { token: 'tok' })
    setFetcher(async () => answer([githubNode({ headRefOid: head })]))
    await s.status(repo, remotes)

    expect(await s.fetchPull(repo, 42)).toEqual({ from: base, to: head })
    expect(git(repo, 'for-each-ref', '--format=%(refname)', 'refs/gitdom/')).toBe(
      'refs/gitdom/pull/42/base\nrefs/gitdom/pull/42/head'
    )
    // Once it's closed, its refs go at the next refresh
    setFetcher(async () => answer([]))
    await s.status(repo, remotes)
    expect(git(repo, 'for-each-ref', '--format=%(refname)', 'refs/gitdom/')).toBe('')
    expect(existsSync(join(dir, 'accounts.json'))).toBe(true)
  })

  it('refuses branch names that could change the refspec', async () => {
    const { service: s } = service()
    setFetcher(async () => json({ data: { viewer: user } }))
    await s.connect('github.com', 'github', 'token', { token: 'tok' })
    setFetcher(async () => answer([githubNode({ baseRefName: 'main:refs/heads/x' })]))
    await s.status(repo, remotes)
    await expect(s.fetchPull(repo, 42)).rejects.toThrow('Unexpected branch name')
  })
})
