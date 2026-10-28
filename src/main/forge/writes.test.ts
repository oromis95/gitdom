import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullRequest } from '../../shared/forge'
import { AccountStore, type Cipher } from './accounts'
import { azure } from './azure'
import { bitbucket, bitbucketMethods } from './bitbucket'
import { bitbucketServer, bitbucketServerMethods } from './bitbucketServer'
import { github } from './github'
import { draftTitle, gitlab } from './gitlab'
import { setFetcher } from './http'
import { ForgeService, readTemplate } from './service'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

interface Sent {
  method: string
  url: string
  body: Record<string, unknown> | null
  auth?: string
}

/** Records the requests and answers each with `answer(url, method)`, or {} */
function recorder(answer: (url: string, method: string) => unknown = () => ({})): Sent[] {
  const sent: Sent[] = []
  setFetcher(async (url, init) => {
    const method = init.method ?? 'GET'
    sent.push({
      method,
      url,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      auth: (init.headers as Record<string, string>).Authorization
    })
    const value = answer(url, method)
    if (value instanceof Response) return value
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
  })
  return sent
}

afterEach(() => setFetcher(() => Promise.reject(new Error('no network in tests'))))

const ctx = { host: 'github.com', token: 'tok' }

function pull(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 7,
    title: 'Add login',
    url: 'https://x/7',
    state: 'open',
    author: { login: 'ann', name: null, avatarUrl: null },
    sourceBranch: 'feature/login',
    sourceRepo: 'acme/app',
    targetBranch: 'main',
    headSha: 'f'.repeat(40),
    createdAt: 0,
    updatedAt: 0,
    review: null,
    reviewers: [],
    checks: null,
    merge: { state: 'clean', reason: null },
    comments: 0,
    labels: [],
    ...overrides
  }
}

const newPull = {
  targetBranch: 'main',
  title: 'Add login',
  body: 'Body',
  draft: true,
  reviewers: [{ id: 'bob', user: { login: 'bob', name: null, avatarUrl: null } }],
  labels: ['auth']
}

describe('GitHub changes', () => {
  it('reads the merge methods the repository allows', async () => {
    recorder(() => ({
      default_branch: 'trunk',
      allow_merge_commit: false,
      allow_squash_merge: true,
      allow_rebase_merge: true,
      allow_auto_merge: true,
      delete_branch_on_merge: true
    }))
    expect(await github.info(ctx, 'acme/app')).toEqual({
      defaultBranch: 'trunk',
      methods: ['squash', 'rebase'],
      deleteBranch: true,
      autoMerge: true,
      labels: true,
      reopen: true
    })
  })

  it("opens a fork's pull request with its owner, then asks reviewers and adds labels", async () => {
    const sent = recorder((url) =>
      url.endsWith('/pulls')
        ? { number: 9, html_url: 'https://github.com/acme/app/pull/9' }
        : url.includes('requested_reviewers')
          ? new Response(
              JSON.stringify({ message: 'Reviews may only be requested from collaborators' }),
              {
                status: 422
              }
            )
          : {}
    )
    const created = await github.create(ctx, 'acme/app', {
      ...newPull,
      sourceRepo: 'ann/app',
      sourceBranch: 'feature/login'
    })
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.github.com/repos/acme/app/pulls',
      body: { head: 'ann:feature/login', base: 'main', draft: true, title: 'Add login' }
    })
    expect(sent.map((s) => s.url.replace('https://api.github.com/repos/acme/app', ''))).toEqual([
      '/pulls',
      '/pulls/9/requested_reviewers',
      '/issues/9/labels'
    ])
    // The pull request is open; what failed after is told
    expect(created).toEqual({
      number: 9,
      url: 'https://github.com/acme/app/pull/9',
      warning: 'Reviews may only be requested from collaborators'
    })
  })

  it('turns a pull request into a draft through GraphQL', async () => {
    const sent = recorder((url) =>
      url.endsWith('/graphql') ? { data: { x: 1 } } : { node_id: 'PR_1' }
    )
    await github.update(ctx, 'acme/app', pull(), { draft: true })
    expect(sent[1]).toMatchObject({
      url: 'https://api.github.com/graphql',
      body: { variables: { id: 'PR_1' } }
    })
    expect(String(sent[1].body?.query)).toContain('convertPullRequestToDraft')
  })

  it('merges what was reviewed, and deletes only its own branches', async () => {
    const sent = recorder()
    expect(
      await github.merge(ctx, 'acme/app', pull(), {
        method: 'squash',
        message: 'Add login (#7)\n\nWith tests',
        deleteBranch: true,
        auto: false
      })
    ).toBe('merged')
    expect(sent[0]).toMatchObject({
      method: 'PUT',
      body: {
        merge_method: 'squash',
        sha: 'f'.repeat(40),
        commit_title: 'Add login (#7)',
        commit_message: 'With tests'
      }
    })
    expect(sent[1]).toMatchObject({
      method: 'DELETE',
      url: 'https://api.github.com/repos/acme/app/git/refs/heads/feature/login'
    })
    const fork = recorder()
    await github.merge(ctx, 'acme/app', pull({ sourceRepo: 'ann/app' }), {
      method: 'merge',
      message: '',
      deleteBranch: true,
      auto: false
    })
    expect(fork.map((s) => s.method)).toEqual(['PUT'])
  })

  it('asks GitHub Enterprise on its own API address', async () => {
    const sent = recorder(() => ({ default_branch: 'main' }))
    await github.info({ host: 'git.example.com', token: 't' }, 'acme/app')
    expect(sent[0].url).toBe('https://git.example.com/api/v3/repos/acme/app')
  })
})

describe('GitLab changes', () => {
  const gl = { host: 'gitlab.com', token: 'tok' }

  it('tells drafts by the title', () => {
    expect(draftTitle('Add login', true)).toBe('Draft: Add login')
    expect(draftTitle('Draft: Add login', false)).toBe('Add login')
    expect(draftTitle('WIP: Add login', true)).toBe('Draft: Add login')
  })

  it("offers the project's merge method, and squashing as it allows", async () => {
    recorder(() => ({ default_branch: 'main', merge_method: 'ff', squash_option: 'default_on' }))
    expect((await gitlab.info(gl, 'group/app')).methods).toEqual(['squash', 'fastForward'])
    recorder(() => ({
      default_branch: 'main',
      merge_method: 'rebase_merge',
      squash_option: 'never'
    }))
    expect((await gitlab.info(gl, 'group/app')).methods).toEqual(['rebaseMerge'])
  })

  it("opens a fork's merge request on the fork, pointing at the project", async () => {
    const sent = recorder((_url, method) =>
      method === 'POST'
        ? { iid: 4, web_url: 'https://gitlab.com/group/app/-/merge_requests/4' }
        : { id: 99 }
    )
    await gitlab.create(gl, 'group/app', {
      ...newPull,
      reviewers: [{ id: '12', user: { login: 'bob', name: null, avatarUrl: null } }],
      sourceRepo: 'ann/app',
      sourceBranch: 'feature/login'
    })
    expect(sent[1]).toMatchObject({
      method: 'POST',
      url: 'https://gitlab.com/api/v4/projects/ann%2Fapp/merge_requests',
      body: { target_project_id: 99, title: 'Draft: Add login', reviewer_ids: [12], labels: 'auth' }
    })
  })

  it('keeps the reviewers already asked when asking more', async () => {
    const sent = recorder()
    await gitlab.update(
      gl,
      'group/app',
      pull({
        reviewers: [
          { user: { login: 'cy', name: null, avatarUrl: null, id: '5' }, vote: 'requested' }
        ]
      }),
      {
        reviewers: [{ id: '12', user: { login: 'bob', name: null, avatarUrl: null } }],
        state: 'closed'
      }
    )
    expect(sent[0].body).toEqual({ state_event: 'close', reviewer_ids: [5, 12] })
  })

  it('merges by itself when asked, with both names of the option', async () => {
    const sent = recorder(() => ({ state: 'opened' }))
    expect(
      await gitlab.merge(gl, 'group/app', pull(), {
        method: 'squash',
        message: '',
        deleteBranch: true,
        auto: true
      })
    ).toBe('auto')
    expect(sent[0].body).toEqual({
      squash: true,
      should_remove_source_branch: true,
      sha: 'f'.repeat(40),
      auto_merge: true,
      merge_when_pipeline_succeeds: true
    })
  })
})

describe('Bitbucket changes', () => {
  const bb = { host: 'bitbucket.org', token: 'tok' }

  it("maps the target branch's strategies, its default first", () => {
    const methods = bitbucketMethods({
      merge_strategies: ['merge_commit', 'squash_fast_forward', 'rebase_merge'],
      default_merge_strategy: 'rebase_merge'
    })
    expect([...methods.entries()]).toEqual([
      ['rebaseMerge', 'rebase_merge'],
      ['merge', 'merge_commit'],
      ['squash', 'squash_fast_forward']
    ])
  })

  it('says a merge waiting in the queue is queued', async () => {
    const sent = recorder((url) =>
      url.endsWith('/merge')
        ? new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } })
        : { merge_strategies: ['merge_commit', 'squash'] }
    )
    expect(
      await bitbucket.merge(bb, 'team/app', pull(), {
        method: 'squash',
        message: 'Squashed',
        deleteBranch: true,
        auto: false
      })
    ).toBe('queued')
    expect(sent[1].body).toEqual({
      type: 'pullrequest',
      merge_strategy: 'squash',
      close_source_branch: true,
      message: 'Squashed'
    })
  })

  it('declines, and refuses to reopen', async () => {
    const sent = recorder()
    await bitbucket.update(bb, 'team/app', pull(), { state: 'closed' })
    expect(sent.map((s) => `${s.method} ${s.url.split('/2.0')[1]}`)).toEqual([
      'POST /repositories/team/app/pullrequests/7/decline'
    ])
    await expect(bitbucket.update(bb, 'team/app', pull(), { state: 'open' })).rejects.toThrow(
      "can't reopen"
    )
  })
})

describe('Bitbucket Data Center changes', () => {
  const dc = { host: 'git.example.com', token: 'tok' }
  const api = 'https://git.example.com/rest/api/1.0/projects/ABC/repos/app'
  const user = (name: string): Record<string, unknown> => ({ name, displayName: name })
  const node = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 7,
    version: 5,
    title: 'Add login',
    description: 'Body',
    state: 'OPEN',
    fromRef: { id: 'refs/heads/feature/login', latestCommit: 'f'.repeat(40) },
    reviewers: [{ user: user('bob'), role: 'REVIEWER', status: 'APPROVED' }],
    ...overrides
  })
  const asked = (sent: { method: string; url: string }[]): string[] =>
    sent.map((s) => `${s.method} ${s.url.replace('https://git.example.com/rest/', '')}`)

  it('maps the strategies the repository allows, its default first', () => {
    const methods = bitbucketServerMethods({
      defaultStrategy: { id: 'squash' },
      strategies: [
        { id: 'no-ff', enabled: true },
        { id: 'ff', enabled: true },
        { id: 'ff-only', enabled: false },
        { id: 'rebase-no-ff', enabled: true },
        { id: 'squash', enabled: true }
      ]
    })
    expect([...methods.entries()]).toEqual([
      ['squash', 'squash'],
      ['merge', 'no-ff'],
      ['rebaseMerge', 'rebase-no-ff']
    ])
    expect([...bitbucketServerMethods(undefined).keys()]).toEqual(['merge'])
  })

  it('reads the default branch, the strategies and whether auto-merge is on', async () => {
    recorder((url) =>
      url.endsWith('/default-branch')
        ? new Response('{"errors":[{"message":"Not found"}]}', { status: 404 })
        : url.endsWith('/branches/default')
          ? { id: 'refs/heads/develop', displayId: 'develop' }
          : url.endsWith('/auto-merge')
            ? { enabled: true }
            : {
                mergeConfig: { defaultStrategy: { id: 'ff-only' }, strategies: [{ id: 'ff-only' }] }
              }
    )
    expect(await bitbucketServer.info(dc, 'ABC/app')).toEqual({
      defaultBranch: 'develop',
      methods: ['fastForward'],
      deleteBranch: false,
      autoMerge: true,
      labels: false,
      reopen: true
    })
  })

  it("opens a fork's pull request with the default reviewers, never the author", async () => {
    const sent = recorder((url, method) => {
      if (url.endsWith('/projects/ABC/repos/app')) return { id: 1 }
      if (url.endsWith('/projects/~ANN/repos/app')) return { id: 12 }
      if (url.includes('/default-reviewers/'))
        return [user('cy'), { reviewers: [user('ann'), user('bob')] }]
      if (url.includes('/users?limit=1'))
        return new Response('{"values":[]}', { headers: { 'X-AUSERNAME': 'ann' } })
      if (method === 'POST')
        return {
          id: 9,
          links: {
            self: [{ href: 'https://git.example.com/projects/ABC/repos/app/pull-requests/9' }]
          }
        }
      return {}
    })
    const created = await bitbucketServer.create(dc, 'ABC/app', {
      ...newPull,
      sourceRepo: '~ANN/app',
      sourceBranch: 'feature/login'
    })
    expect(created).toEqual({
      number: 9,
      url: 'https://git.example.com/projects/ABC/repos/app/pull-requests/9'
    })
    const reviewersAsked = sent.find((s) => s.url.includes('/default-reviewers/'))!.url
    expect(new URL(reviewersAsked).searchParams.toString()).toBe(
      'sourceRepoId=12&targetRepoId=1&sourceRefId=refs%2Fheads%2Ffeature%2Flogin&targetRefId=refs%2Fheads%2Fmain'
    )
    const post = sent.find((s) => s.method === 'POST')!
    expect(post.url).toBe(`${api}/pull-requests`)
    expect(post.body).toEqual({
      title: 'Add login',
      description: 'Body',
      fromRef: {
        id: 'refs/heads/feature/login',
        repository: { slug: 'app', project: { key: '~ANN' } }
      },
      toRef: { id: 'refs/heads/main', repository: { slug: 'app', project: { key: 'ABC' } } },
      reviewers: [{ user: { name: 'bob' } }, { user: { name: 'cy' } }],
      draft: true
    })
  })

  it('opens it all the same when the default reviewers cannot be read', async () => {
    const sent = recorder((_url, method) =>
      method === 'POST' ? { id: 3 } : new Response('{}', { status: 500 })
    )
    const created = await bitbucketServer.create(dc, 'ABC/app', {
      ...newPull,
      draft: false,
      reviewers: [],
      sourceRepo: 'ABC/app',
      sourceBranch: 'fix'
    })
    expect(created.url).toBe('https://git.example.com/projects/ABC/repos/app/pull-requests/3')
    const post = sent.find((s) => s.method === 'POST')!
    expect(post.body).toMatchObject({ reviewers: [] })
    expect(post.body).not.toHaveProperty('draft')
  })

  it('sends the current version, keeps the reviewers, and adds new ones as participants', async () => {
    const sent = recorder((_url, method) => (method === 'GET' ? node() : {}))
    await bitbucketServer.update(dc, 'ABC/app', pull(), { title: 'Better title', draft: true })
    expect(sent[1]).toMatchObject({
      method: 'PUT',
      url: `${api}/pull-requests/7`,
      body: {
        version: 5,
        title: 'Better title',
        description: 'Body',
        reviewers: [{ user: { name: 'bob' } }],
        draft: true
      }
    })
    sent.length = 0
    await bitbucketServer.update(dc, 'ABC/app', pull(), {
      reviewers: [{ id: 'cy', user: { login: 'cy', name: null, avatarUrl: null } }]
    })
    expect(sent).toMatchObject([
      {
        method: 'POST',
        url: `${api}/pull-requests/7/participants`,
        body: { user: { name: 'cy' }, role: 'REVIEWER' }
      }
    ])
    expect(sent[0].auth).toBe('Bearer tok')
  })

  it('declines and reopens with the version', async () => {
    const sent = recorder((_url, method) => (method === 'GET' ? node() : {}))
    await bitbucketServer.update(dc, 'ABC/app', pull(), { state: 'closed' })
    await bitbucketServer.update(dc, 'ABC/app', pull(), { state: 'open' })
    expect(asked(sent)).toEqual([
      'GET api/1.0/projects/ABC/repos/app/pull-requests/7',
      'POST api/1.0/projects/ABC/repos/app/pull-requests/7/decline?version=5',
      'GET api/1.0/projects/ABC/repos/app/pull-requests/7',
      'POST api/1.0/projects/ABC/repos/app/pull-requests/7/reopen?version=5'
    ])
    expect(sent[1].body).toEqual({ version: 5 })
  })

  it('merges what was reviewed with its strategy, then deletes its own branch', async () => {
    const sent = recorder((url, method) => {
      if (url.endsWith('/settings/pull-requests'))
        return { mergeConfig: { strategies: [{ id: 'no-ff' }, { id: 'squash' }] } }
      if (method === 'POST') return node({ state: 'MERGED' })
      if (method === 'DELETE') return new Response(null, { status: 204 })
      return node()
    })
    const options = {
      method: 'squash' as const,
      message: 'Squashed',
      deleteBranch: true,
      auto: false
    }
    expect(
      await bitbucketServer.merge(dc, 'ABC/app', pull({ sourceRepo: 'ABC/app' }), options)
    ).toBe('merged')
    const merge = sent.find((s) => s.method === 'POST')!
    expect(merge.url).toBe(`${api}/pull-requests/7/merge?version=5`)
    expect(merge.body).toEqual({ version: 5, strategyId: 'squash', message: 'Squashed' })
    expect(sent.find((s) => s.method === 'DELETE')).toMatchObject({
      url: 'https://git.example.com/rest/branch-utils/1.0/projects/ABC/repos/app/branches',
      body: { name: 'refs/heads/feature/login', endPoint: 'f'.repeat(40) }
    })

    // A fork's branch belongs to its owner
    sent.length = 0
    await bitbucketServer.merge(dc, 'ABC/app', pull({ sourceRepo: '~ANN/app' }), options)
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false)
  })

  it('merges by itself when asked, and refuses once new commits came', async () => {
    const sent = recorder((_url, method) => node(method === 'POST' ? { state: 'OPEN' } : {}))
    const options = { method: 'merge' as const, message: '', deleteBranch: true, auto: true }
    expect(await bitbucketServer.merge(dc, 'ABC/app', pull(), options)).toBe('auto')
    expect(sent.find((s) => s.method === 'POST')!.body).toEqual({ version: 5, autoMerge: true })
    expect(sent.some((s) => s.method === 'DELETE')).toBe(false)
    sent.length = 0
    await expect(
      bitbucketServer.merge(dc, 'ABC/app', pull({ headSha: 'e'.repeat(40) }), options)
    ).rejects.toThrow('new commits')
    expect(sent.some((s) => s.method === 'POST')).toBe(false)
  })

  it('searches the people who can read the repository', async () => {
    const sent = recorder(() => ({
      values: [
        { name: 'bob', displayName: 'Bob', active: true },
        { name: 'old', displayName: 'Gone', active: false }
      ]
    }))
    const found = await bitbucketServer.candidates(dc, 'ABC/app', ' bo ')
    expect(found).toEqual([{ id: 'bob', user: { login: 'bob', name: 'Bob', avatarUrl: null } }])
    const params = new URL(sent[0].url).searchParams
    expect(Object.fromEntries(params)).toEqual({
      'permission.1': 'REPO_READ',
      'permission.1.projectKey': 'ABC',
      'permission.1.repositorySlug': 'app',
      avatarSize: '64',
      limit: '20',
      filter: 'bo'
    })
  })
})

describe('Azure DevOps changes', () => {
  const az = { host: 'dev.azure.com', token: 'pat' }

  it('completes a pull request, and says when Azure DevOps is still at it', async () => {
    const sent = recorder(() => ({ status: 'active' }))
    expect(
      await azure.merge(az, 'contoso/Shop/web', pull(), {
        method: 'squash',
        message: '',
        deleteBranch: true,
        auto: false
      })
    ).toBe('queued')
    expect(sent[0]).toMatchObject({
      method: 'PATCH',
      url: 'https://dev.azure.com/contoso/Shop/_apis/git/repositories/web/pullrequests/7?api-version=7.1',
      body: {
        status: 'completed',
        lastMergeSourceCommit: { commitId: 'f'.repeat(40) },
        completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: true }
      }
    })
  })

  it('sets auto-complete in the name of the account', async () => {
    const sent = recorder((url) =>
      url.includes('connectionData')
        ? {
            authenticatedUser: {
              id: 'me-1',
              properties: { Account: { $value: 'ann@contoso.com' } }
            }
          }
        : {}
    )
    expect(
      await azure.merge(az, 'contoso/Shop/web', pull(), {
        method: 'merge',
        message: '',
        deleteBranch: false,
        auto: true
      })
    ).toBe('auto')
    expect(sent[1].body).toMatchObject({
      autoCompleteSetBy: { id: 'me-1' },
      completionOptions: { mergeStrategy: 'noFastForward' }
    })
  })

  it('searches people in the organization’s directory', async () => {
    const sent = recorder(() => ({
      value: [
        {
          id: 'u1',
          providerDisplayName: 'Bob',
          properties: { Mail: { $value: 'bob@contoso.com' } }
        }
      ]
    }))
    const found = await azure.candidates(az, 'contoso/Shop/web', 'bo')
    expect(sent[0].url).toMatch(
      /^https:\/\/vssps\.dev\.azure\.com\/contoso\/_apis\/identities\?searchFilter=General&filterValue=bo/
    )
    expect(found).toEqual([
      { id: 'u1', user: { login: 'bob@contoso.com', name: 'Bob', avatarUrl: null, id: 'u1' } }
    ])
  })
})

describe('creating from a local branch', () => {
  let dir: string
  let repo: string
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', input: '' }).trim()
  const cipher: Cipher = {
    available: () => true,
    encrypt: (text) => `enc:${text}`,
    decrypt: (text) => text.slice(4)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitdom-forge21-'))
    repo = join(dir, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 't@t.it')
    git(repo, 'config', 'user.name', 'T')
    writeFileSync(join(repo, 'a.txt'), '1\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')
    git(dir, 'init', '-q', '--bare', '-b', 'main', join(dir, 'origin.git'))
    git(repo, 'remote', 'add', 'origin', join(dir, 'origin.git'))
    git(repo, 'push', '-q', 'origin', 'main')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('opens it from the remote branch the local one follows', async () => {
    const service = new ForgeService(
      new AccountStore(join(dir, 'accounts.json'), cipher),
      async () => null
    )
    recorder(() => ({ data: { viewer: { login: 'ann', avatarUrl: null } } }))
    await service.connect('github.com', 'github', 'token', { token: 't' }, 'acme/app')
    recorder((url) =>
      url.endsWith('/graphql')
        ? {
            data: {
              viewer: { login: 'ann', avatarUrl: null },
              repository: { pullRequests: { nodes: [] } }
            }
          }
        : { default_branch: 'main' }
    )
    const remotes = [{ name: 'origin', fetchUrl: 'https://github.com/acme/app.git', pushUrl: '' }]
    await service.status(repo, remotes)
    const draft = { ...newPull, branch: 'local-name', reviewers: [], labels: [] }

    git(repo, 'checkout', '-q', '-b', 'local-name')
    await expect(service.createPull(repo, draft)).rejects.toThrow('Push local-name first')

    // Published under another name: the pull request comes from that one
    git(repo, 'push', '-q', '-u', 'origin', 'local-name:feature/remote-name')
    const sent = recorder(() => ({ number: 3, html_url: 'https://github.com/acme/app/pull/3' }))
    expect(await service.createPull(repo, draft)).toEqual({
      number: 3,
      url: 'https://github.com/acme/app/pull/3'
    })
    expect(sent[0].body).toMatchObject({ head: 'feature/remote-name', base: 'main' })
  })

  it("reads the repository's description template, whatever the case of its name", () => {
    mkdirSync(join(repo, '.github'))
    writeFileSync(join(repo, '.github', 'PULL_REQUEST_TEMPLATE.md'), '## What\n')
    expect(readTemplate(repo, 'github')).toBe('## What\n')
    mkdirSync(join(repo, '.gitlab', 'merge_request_templates'), { recursive: true })
    writeFileSync(join(repo, '.gitlab', 'merge_request_templates', 'Bug.md'), '## Bug\n')
    expect(readTemplate(repo, 'gitlab')).toBe('## Bug\n')
    expect(readTemplate(repo, 'bitbucket')).toBe('')
  })
})
