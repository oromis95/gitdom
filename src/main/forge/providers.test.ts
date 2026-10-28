import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Remote } from '../../shared/types'
import { AccountStore, type Cipher } from './accounts'
import { azure, azureChecks, azureGitPath, azurePull } from './azure'
import { bitbucket, bitbucketChecks, bitbucketPull } from './bitbucket'
import { detectForge, parseRemoteUrl } from './detect'
import { setFetcher } from './http'
import { ForgeService, tokenPage } from './service'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const remote = (name: string, url: string): Remote => ({ name, fetchUrl: url, pushUrl: url })

const cipher: Cipher = {
  available: () => true,
  encrypt: (text) => `enc:${Buffer.from(text).toString('base64')}`,
  decrypt: (text) => Buffer.from(text.slice(4), 'base64').toString()
}

afterEach(() => setFetcher(() => Promise.reject(new Error('no network in tests'))))

describe('Azure DevOps addresses', () => {
  it('reads servers of one’s own, whose collection has several segments', () => {
    expect(parseRemoteUrl('https://tfs.example.com/tfs/DefaultCollection/Shop/_git/web')).toEqual({
      host: 'tfs.example.com',
      path: 'tfs/DefaultCollection/Shop/web'
    })
    const repo = detectForge(
      [remote('origin', 'https://tfs.example.com/tfs/DefaultCollection/My%20Shop/_git/web')],
      [{ host: 'tfs.example.com', kind: 'azure' }]
    )
    expect(repo?.webUrl).toBe('https://tfs.example.com/tfs/DefaultCollection/My%20Shop/_git/web')
    expect(azureGitPath(repo!.path)).toBe('tfs/DefaultCollection/My Shop/_git/web')
  })

  it('sends personal access tokens as a password, Entra tokens as bearer', () => {
    expect(azure.auth({ host: 'dev.azure.com', token: 'pat123' })).toEqual({
      Authorization: `Basic ${Buffer.from(':pat123').toString('base64')}`
    })
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'
    expect(azure.auth({ host: 'dev.azure.com', token: jwt })).toEqual({
      Authorization: `Bearer ${jwt}`
    })
  })

  it('links to the token page of the organization', () => {
    expect(tokenPage('azure', 'dev.azure.com', 'contoso/Shop/web')).toBe(
      'https://dev.azure.com/contoso/_usersSettings/tokens'
    )
  })
})

describe('Bitbucket pull requests', () => {
  type Page = { values: never[] }
  const nodes = (fixture('bitbucket-pulls.json') as Page).values
  const byId = (id: number): never => nodes.find((n: { id: number }) => n.id === id)!

  it('reads a real answer of bitbucket.org', () => {
    const checks = bitbucketChecks((fixture('bitbucket-statuses.json') as Page).values)
    expect(checks).toMatchObject({ state: 'success', items: [{ name: 'Pipeline - default' }] })
    const approved = bitbucketPull(byId(527), 'atlassian/atlassian-connect-express', checks)
    expect(approved).toMatchObject({
      number: 527,
      state: 'open',
      review: 'approved',
      headSha: '070df5fd772f',
      url: 'https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/527',
      merge: { state: 'unknown' }
    })
    // Who only commented isn't a reviewer
    expect(approved.reviewers.map((r) => r.vote)).toEqual([
      'approved',
      'approved',
      'requested',
      'requested'
    ])
    expect(bitbucketPull(byId(552), 'a/b', null)).toMatchObject({
      state: 'draft',
      merge: { state: 'draft' }
    })
    expect(bitbucketPull(byId(514), 'a/b', null).review).toBe('required')
  })

  it('sends an API token with its email, an access token alone', () => {
    expect(bitbucket.auth({ host: 'bitbucket.org', token: 't', username: 'me@x.it' })).toEqual({
      Authorization: `Basic ${Buffer.from('me@x.it:t').toString('base64')}`
    })
    expect(bitbucket.auth({ host: 'bitbucket.org', token: 't' })).toEqual({
      Authorization: 'Bearer t'
    })
  })

  it('reads the conversation, without deleted comments, and the commits oldest first', async () => {
    setFetcher(async (url) => {
      if (url.endsWith('/comments?pagelen=100')) return json(fixture('bitbucket-comments.json'))
      if (url.endsWith('/commits?pagelen=100')) return json(fixture('bitbucket-commits.json'))
      if (url.includes('/diffstat')) return json({ values: [{ status: 'merge conflict' }] })
      return json({ ...(byId(527) as object), description: 'The **body**' })
    })
    const detail = await bitbucket.detail({ host: 'bitbucket.org', token: 't' }, 'atlassian/x', 527)
    expect(detail.body).toBe('The **body**')
    expect(detail.merge).toEqual({ state: 'conflicts', reason: 'Conflicts with the target branch' })
    expect(detail.timeline[0]).toMatchObject({
      path: 'lib/internal/forge-user-token-handler.js',
      line: 56
    })
    expect(detail.timeline.find((c) => c.author.login === 'Code Reviewer')).toBeDefined()
    const commits = (fixture('bitbucket-commits.json') as { values: { hash: string }[] }).values
    expect(detail.commits).toEqual(commits.map((c) => c.hash).reverse())
  })

  it("doesn't take Bitbucket Data Center for Bitbucket Cloud", async () => {
    await expect(bitbucket.viewer({ host: 'git.example.com', token: 't' }, 'a/b')).rejects.toThrow(
      'Bitbucket Data Center'
    )
  })
})

const identity = (name: string): { displayName: string; uniqueName: string; imageUrl: string } => ({
  displayName: name,
  uniqueName: `${name.toLowerCase()}@contoso.com`,
  imageUrl: `https://dev.azure.com/contoso/_api/_common/identityImage?id=${name}`
})

function azureNode(overrides: Record<string, unknown> = {}): never {
  return {
    pullRequestId: 12,
    title: 'Add the cart',
    isDraft: false,
    createdBy: identity('Ann'),
    creationDate: '2026-10-20T10:00:00Z',
    sourceRefName: 'refs/heads/feature/cart',
    targetRefName: 'refs/heads/main',
    mergeStatus: 'succeeded',
    lastMergeSourceCommit: { commitId: 'a'.repeat(40) },
    reviewers: [
      { ...identity('Bob'), vote: 10, isRequired: true },
      { ...identity('Cy'), vote: 0 },
      { ...identity('Dee'), vote: -5 }
    ],
    labels: [{ name: 'shop', active: true }],
    repository: { project: { id: 'p1' } },
    ...overrides
  } as never
}

describe('Azure DevOps pull requests', () => {
  const none = { checks: null, blockers: [] }

  it('maps votes, branches and its page', () => {
    const pull = azurePull(azureNode(), 'dev.azure.com', 'contoso/Shop/web', none)
    expect(pull).toMatchObject({
      number: 12,
      sourceBranch: 'feature/cart',
      targetBranch: 'main',
      url: 'https://dev.azure.com/contoso/Shop/_git/web/pullrequest/12',
      review: 'changes',
      merge: { state: 'clean' },
      labels: [{ name: 'shop', color: null }]
    })
    expect(pull.reviewers.map((r) => [r.user.login, r.vote])).toEqual([
      ['bob@contoso.com', 'approved'],
      ['cy@contoso.com', 'requested'],
      ['dee@contoso.com', 'changes']
    ])
  })

  it('tells drafts, conflicts and policies apart', () => {
    expect(
      azurePull(azureNode({ isDraft: true }), 'dev.azure.com', 'o/p/r', none).merge.state
    ).toBe('draft')
    expect(
      azurePull(azureNode({ mergeStatus: 'conflicts' }), 'dev.azure.com', 'o/p/r', none).merge.state
    ).toBe('conflicts')
    expect(
      azurePull(azureNode(), 'dev.azure.com', 'o/p/r', {
        checks: null,
        blockers: ['Open comments must be resolved']
      }).merge
    ).toEqual({ state: 'blocked', reason: 'Open comments must be resolved' })
  })

  it('names a fork and where to fetch it from', () => {
    const pull = azurePull(
      azureNode({
        forkSource: {
          repository: {
            name: 'web-fork',
            project: { name: 'Mine' },
            remoteUrl: 'https://dev.azure.com/contoso/Mine/_git/web-fork'
          }
        }
      }),
      'dev.azure.com',
      'contoso/Shop/web',
      none
    )
    expect(pull.sourceRepo).toBe('contoso/Mine/web-fork')
    expect(pull.sourceUrl).toBe('https://dev.azure.com/contoso/Mine/_git/web-fork')
  })

  it('takes the latest status of each check, and the builds and blockers of the policies', () => {
    const { checks, blockers } = azureChecks(
      [
        { id: 1, state: 'failed', context: { name: 'lint', genre: 'ci' } },
        {
          id: 2,
          state: 'succeeded',
          context: { name: 'lint', genre: 'ci' },
          targetUrl: 'https://ci/2'
        }
      ],
      [
        {
          status: 'running',
          configuration: {
            isBlocking: true,
            type: { displayName: 'Build' },
            settings: { displayName: 'PR build' }
          },
          context: { buildId: 77 }
        },
        {
          status: 'rejected',
          configuration: { isBlocking: true, type: { displayName: 'Minimum number of reviewers' } }
        },
        {
          status: 'rejected',
          configuration: { isBlocking: false, type: { displayName: 'Work item linking' } }
        }
      ],
      'https://dev.azure.com/contoso/Shop'
    )
    expect(checks).toEqual({
      state: 'pending',
      url: null,
      items: [
        { name: 'ci/lint', state: 'success', url: 'https://ci/2' },
        {
          name: 'PR build',
          state: 'pending',
          url: 'https://dev.azure.com/contoso/Shop/_build/results?buildId=77'
        }
      ]
    })
    // Optional policies don't block
    expect(blockers).toEqual(['Required builds must pass', 'Review required'])
  })

  it('reads the list with the checks of each pull request', async () => {
    const urls: string[] = []
    setFetcher(async (url) => {
      urls.push(url)
      if (url.includes('/connectionData'))
        return json({
          authenticatedUser: {
            providerDisplayName: 'Ann',
            properties: { Account: { $value: 'ann@contoso.com' } }
          }
        })
      if (url.includes('/pullrequests?')) return json({ value: [azureNode()], count: 1 })
      if (url.includes('/statuses')) return json({ value: [] })
      return json({ value: [] })
    })
    const { viewer, pulls } = await azure.load(
      { host: 'dev.azure.com', token: 'pat' },
      'contoso/My Shop/web'
    )
    expect(viewer.login).toBe('ann@contoso.com')
    expect(pulls).toHaveLength(1)
    expect(
      urls.some((u) =>
        u.startsWith(
          'https://dev.azure.com/contoso/My%20Shop/_apis/git/repositories/web/pullrequests?'
        )
      )
    ).toBe(true)
    expect(
      urls.some((u) =>
        u.includes('artifactId=vstfs%3A%2F%2F%2FCodeReview%2FCodeReviewId%2Fp1%2F12')
      )
    ).toBe(true)
  })

  it('takes the anonymous user of a refused token as a refusal', async () => {
    setFetcher(async () => json({ authenticatedUser: { providerDisplayName: 'Anonymous' } }))
    await expect(
      azure.viewer({ host: 'dev.azure.com', token: 'x' }, 'o/p/r')
    ).rejects.toMatchObject({ auth: true })
  })
})

describe('ForgeService on services without a pull request ref', () => {
  let dir: string
  let repo: string
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', input: '' }).trim()
  const user = { display_name: 'Ann', nickname: 'ann', links: { avatar: { href: null } } }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitdom-forge20-'))
    repo = join(dir, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 't@t.it')
    git(repo, 'config', 'user.name', 'T')
    writeFileSync(join(repo, 'a.txt'), '1\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')
    // The workspace's repository and a fork, as bare repositories at matching paths
    for (const name of ['repo', 'fork'])
      git(dir, 'init', '-q', '--bare', '-b', 'main', join(dir, 'acme', `${name}.git`))
    git(repo, 'remote', 'add', 'origin', join(dir, 'acme', 'repo.git'))
    git(repo, 'push', '-q', 'origin', 'main')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function bitbucketNode(id: number, branch: string, source: string): Record<string, unknown> {
    return {
      id,
      title: `PR ${id}`,
      author: user,
      created_on: '2026-10-20T10:00:00Z',
      updated_on: '2026-10-20T10:00:00Z',
      comment_count: 0,
      source: {
        branch: { name: branch },
        commit: { hash: 'abc' },
        repository: { full_name: source }
      },
      destination: { branch: { name: 'main' } },
      participants: [],
      links: { html: { href: `https://bitbucket.org/acme/repo/pull-requests/${id}` } }
    }
  }

  it('fetches the source branch, from the repository or from the fork', async () => {
    const commitOn = (target: string, branch: string, text: string): string => {
      git(repo, 'checkout', '-q', '-b', branch, 'main')
      writeFileSync(join(repo, 'a.txt'), text)
      git(repo, 'commit', '-q', '-am', text)
      git(repo, 'push', '-q', target, `${branch}:${branch}`)
      const head = git(repo, 'rev-parse', 'HEAD')
      git(repo, 'checkout', '-q', 'main')
      git(repo, 'branch', '-q', '-D', branch)
      return head
    }
    const same = commitOn('origin', 'feature', '2\n')
    const forked = commitOn(join(dir, 'acme', 'fork.git'), 'idea', '3\n')
    const base = git(repo, 'rev-parse', 'main')

    const service = new ForgeService(
      new AccountStore(join(dir, 'accounts.json'), cipher),
      async () => null
    )
    setFetcher(async () => json(user))
    await service.connect('bitbucket.org', 'bitbucket', 'token', { token: 't' }, 'acme/repo')
    setFetcher(async (url) =>
      url.endsWith('/user')
        ? json(user)
        : url.includes('/statuses')
          ? json({ values: [] })
          : json({
              values: [
                bitbucketNode(1, 'feature', 'acme/repo'),
                bitbucketNode(2, 'idea', 'acme/fork')
              ]
            })
    )
    // The remote GitDom sees is Bitbucket's; git's own is the bare repository
    const status = await service.status(repo, [
      remote('origin', 'https://bitbucket.org/acme/repo.git')
    ])
    expect(status.state).toBe('ready')
    expect(await service.fetchPull(repo, 1)).toEqual({ from: base, to: same })
    expect(await service.fetchPull(repo, 2)).toEqual({ from: base, to: forked })
  })

  it("tries Git Credential Manager's username with Bitbucket, then the token alone", async () => {
    const service = new ForgeService(
      new AccountStore(join(dir, 'accounts.json'), cipher),
      async () => ({
        username: 'ann',
        password: 'oauth-token'
      })
    )
    const sent: string[] = []
    setFetcher(async (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization
      sent.push(auth)
      return auth === 'Bearer oauth-token' ? json(user) : json({ error: { message: 'Bad' } }, 401)
    })
    expect(await service.connectWithGit('bitbucket.org', 'bitbucket', 'acme/repo')).toMatchObject({
      source: 'gcm'
    })
    expect(sent).toEqual([
      `Basic ${Buffer.from('ann:oauth-token').toString('base64')}`,
      'Bearer oauth-token'
    ])
  })

  it("asks Git Credential Manager for an Azure DevOps token by the repository's path", async () => {
    const asked: (string | undefined)[] = []
    const service = new ForgeService(
      new AccountStore(join(dir, 'accounts.json'), cipher),
      async (_host, path) => {
        asked.push(path)
        return { username: 'contoso', password: 'pat' }
      }
    )
    setFetcher(async () =>
      json({
        authenticatedUser: {
          providerDisplayName: 'Ann',
          properties: { Account: { $value: 'ann@contoso.com' } }
        }
      })
    )
    await service.connectWithGit('dev.azure.com', 'azure', 'contoso/Shop/web')
    expect(asked).toEqual(['contoso/Shop/_git/web'])
  })

  it('sends the token with pictures of a connected host only', async () => {
    const service = new ForgeService(
      new AccountStore(join(dir, 'accounts.json'), cipher),
      async () => null
    )
    setFetcher(async () =>
      json({
        authenticatedUser: {
          providerDisplayName: 'Ann',
          properties: { Account: { $value: 'ann@contoso.com' } }
        }
      })
    )
    await service.connect('dev.azure.com', 'azure', 'token', { token: 'pat' }, 'contoso/Shop/web')
    const sent: Record<string, string | undefined> = {}
    setFetcher(async (url, init) => {
      sent[new URL(url).hostname] = (init.headers as Record<string, string>).Authorization
      return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    })
    expect(
      await service.avatar('https://dev.azure.com/contoso/_api/_common/identityImage?id=1')
    ).toBe('data:image/png;base64,AQID')
    await service.avatar('https://avatars.example.com/u/1.png')
    expect(sent['dev.azure.com']).toMatch(/^Basic /)
    expect(sent['avatars.example.com']).toBeUndefined()
  })
})
