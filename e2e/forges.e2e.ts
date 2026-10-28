import { readFileSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AVATAR,
  cleanUp,
  commitFile,
  git,
  gitBackend,
  launch,
  makeRepo,
  scratch,
  seedProfile,
  type Running
} from './helpers'

type Route = (url: string, req: IncomingMessage, res: ServerResponse) => boolean

const send = (res: ServerResponse, body: unknown, status = 200): true => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
  return true
}

/** A fake service on this computer: `route` answers its API, git's http-backend the rest. */
async function fakeService(
  served: string,
  route: Route
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    if (!route(req.url ?? '', req, res)) gitBackend(served, req, res)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return { server, port: (server.address() as AddressInfo).port }
}

/** A repository with a pull request's branch: pushed to `bare` and fetched as origin's. */
function repoWithBranch(dir: string, bare: string): { repo: string; head: string } {
  const repo = makeRepo(dir)
  git(repo, 'commit', '-q', '-am', 'Change the readme')
  git(dir, 'init', '-q', '--bare', '-b', 'main', bare)
  git(repo, 'push', '-q', bare, 'main')
  git(repo, 'checkout', '-q', '-b', 'feature/login')
  commitFile(repo, 'login.js', 'export const login = () => true\n', 'Add the login')
  const head = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'push', '-q', bare, 'feature/login')
  git(repo, 'checkout', '-q', 'main')
  git(repo, 'branch', '-q', '-D', 'feature/login')
  // From the folder: a synchronous git over HTTP would wait on this very process's server
  git(repo, 'fetch', '-q', bare, '+refs/heads/*:refs/remotes/origin/*')
  return { repo, head }
}

/** A new profile with servers of one's own set in the preferences. */
function profileWith(repo: string, forgeHosts: string): string {
  const profile = scratch('forge-profile')
  seedProfile(profile, [repo])
  const file = join(profile, 'settings.json')
  const settings = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  settings['gitdom.settings'] = JSON.stringify({
    ...JSON.parse(settings['gitdom.settings']),
    forgeHosts
  })
  writeFileSync(file, JSON.stringify(settings))
  return profile
}

// Azure DevOps Server at 127.0.0.1, collection "coll", project "proj", repository "widgets"
describe('pull requests of Azure DevOps', () => {
  let dir: string
  let profile: string
  let server: Server
  let gitdom: Running
  const avatarAuth: string[] = []

  const identity = (name: string): Record<string, string> => ({
    displayName: name,
    uniqueName: `${name.toLowerCase()}@contoso.com`,
    imageUrl: `https://127.0.0.1/coll/_api/_common/identityImage?id=${name}`
  })

  beforeAll(async () => {
    dir = scratch('azure')
    const served = join(dir, 'served')
    const { repo, head } = repoWithBranch(dir, join(served, 'coll', 'proj', '_git', 'widgets'))
    const api = '/127.0.0.1/coll/proj/_apis/git/repositories/widgets'
    ;({ server } = await fakeService(served, (url, req, res) => {
      if (url.startsWith('/127.0.0.1/coll/_api/_common/identityImage')) {
        avatarAuth.push(String(req.headers.authorization))
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(AVATAR)
        return true
      }
      if (!url.startsWith('/127.0.0.1/')) return false
      if (req.headers.authorization !== `Basic ${Buffer.from(':gcm-token').toString('base64')}`)
        return send(res, { message: 'TF400813: not authorized' }, 401)
      if (url.startsWith('/127.0.0.1/coll/_apis/connectionData'))
        return send(res, {
          authenticatedUser: {
            providerDisplayName: 'Ann',
            properties: { Account: { $value: 'ann@contoso.com' } }
          }
        })
      if (url.startsWith(`${api}/pullrequests?`))
        return send(res, {
          value: [
            {
              pullRequestId: 7,
              title: 'Log in with a password',
              description: 'Short',
              isDraft: false,
              createdBy: identity('Bob'),
              creationDate: '2026-10-20T10:00:00Z',
              sourceRefName: 'refs/heads/feature/login',
              targetRefName: 'refs/heads/main',
              mergeStatus: 'succeeded',
              lastMergeSourceCommit: { commitId: head },
              reviewers: [
                { ...identity('Ann'), vote: 0, isRequired: true },
                { ...identity('Cy'), vote: 10 }
              ],
              labels: [{ name: 'auth', active: true }],
              repository: { project: { id: 'p1' } }
            }
          ],
          count: 1
        })
      if (url.startsWith(`${api}/pullRequests/7/statuses`))
        return send(res, {
          value: [{ id: 1, state: 'succeeded', context: { name: 'lint', genre: 'ci' } }]
        })
      if (url.startsWith('/127.0.0.1/coll/proj/_apis/policy/evaluations'))
        return send(res, {
          value: [
            {
              status: 'rejected',
              configuration: {
                isBlocking: true,
                type: { displayName: 'Build' },
                settings: { displayName: 'PR build' }
              },
              context: { buildId: 42 }
            },
            {
              status: 'running',
              configuration: { isBlocking: true, type: { displayName: 'Comment requirements' } }
            }
          ]
        })
      if (url.startsWith(`${api}/pullrequests/7?`))
        return send(res, { pullRequestId: 7, description: '## Why\nUsers asked for it.' })
      if (url.startsWith(`${api}/pullRequests/7/threads`))
        return send(res, {
          value: [
            {
              threadContext: { filePath: '/login.js', rightFileStart: { line: 1 } },
              comments: [
                {
                  author: identity('Cy'),
                  content: 'Name it **signIn**',
                  publishedDate: '2026-10-21T09:00:00Z',
                  commentType: 'text'
                }
              ]
            },
            {
              comments: [
                {
                  author: identity('Cy'),
                  content: 'Cy voted 10',
                  publishedDate: '2026-10-21T09:01:00Z',
                  commentType: 'system'
                }
              ]
            }
          ]
        })
      if (url.startsWith(`${api}/pullRequests/7/commits`))
        return send(res, { value: [{ commitId: head }] })
      return send(res, { message: `Unexpected ${url}` }, 404)
    }))
    const { port } = server.address() as AddressInfo
    git(repo, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/coll/proj/_git/widgets`)
    profile = profileWith(repo, '127.0.0.1 azure')
    gitdom = await launch([repo], {
      profile,
      env: {
        GITDOM_FORGE_MOCK: `http://127.0.0.1:${port}`,
        GITDOM_FORGE_MOCK_GCM_TOKEN: 'gcm-token',
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1'
      }
    })
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    await new Promise((done) => server?.close(done))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    cleanUp(profile)
  })

  it('connects and lists the pull requests waiting for my review', async () => {
    const { win } = gitdom
    await win.locator('.pull-connect:has-text("Connect to Azure DevOps (127.0.0.1)")').click()
    await win.locator('.toast:has-text("Connected to Azure DevOps as ann@contoso.com")').waitFor()
    const row = win.locator('.pull-row:has-text("Log in with a password")')
    await row.waitFor()
    await expect(row.innerText()).resolves.toContain('!7')
    const groups = await win.locator('.pull-group').allInnerTexts()
    expect(groups.map((g) => g.split('\n')[0].trim())).toEqual(['REVIEW REQUESTED'])
  })

  it('shows the badge, and why it is blocked', async () => {
    const { win } = gitdom
    const badge = win.locator('.ref-pill:has-text("origin/feature/login") .pull-badge')
    await expect(badge.innerText()).resolves.toBe('!7')
    await badge.click()
    const view = win.locator('.pull-view')
    await view.locator('.pull-description .md-heading:has-text("Why")').waitFor()
    await view.locator('.pull-merge:has-text("Required builds must pass")').waitFor()
    await view.locator('.pull-check:has-text("PR build")').waitFor()
    await view.locator('.pull-comment:has-text("Name it signIn")').waitFor()
    await expect(view.locator('.pull-comment').count()).resolves.toBe(1)
    await expect(view.locator('.pull-comment').innerText()).resolves.toContain('login.js:1')
  })

  it("fetches the source branch for the pull request's changes", async () => {
    const { win } = gitdom
    await win.locator('.detail-title:has-text("Changes of !7")').waitFor()
    await win.locator('.detail .file-row:has-text("login.js")').waitFor()
    await win.locator('.pull-commit:has-text("Add the login")').waitFor()
    // Azure DevOps keeps the pictures behind the login
    expect(avatarAuth.length).toBeGreaterThan(0)
    expect(avatarAuth.every((a) => a.startsWith('Basic '))).toBe(true)
    await win.keyboard.press('Escape')
  })
})

describe('pull requests of Bitbucket', () => {
  let dir: string
  let profile: string
  let server: Server
  let gitdom: Running
  const auths: string[] = []

  const account = (name: string): Record<string, unknown> => ({
    display_name: name,
    nickname: name.toLowerCase(),
    links: { avatar: { href: `https://avatars.bitbucket.invalid/${name}.png` } }
  })

  beforeAll(async () => {
    dir = scratch('bitbucket')
    const served = join(dir, 'served')
    const { repo, head } = repoWithBranch(dir, join(served, 'widgets.git'))
    const api = '/api.bitbucket.org/2.0/repositories/acme/widgets/pullrequests'
    ;({ server } = await fakeService(served, (url, req, res) => {
      if (!url.startsWith('/api.bitbucket.org/')) return false
      auths.push(String(req.headers.authorization))
      // An OAuth token, as Git Credential Manager keeps: no username with it
      if (req.headers.authorization !== 'Bearer gcm-token')
        return send(res, { type: 'error', error: { message: 'Bad credentials' } }, 401)
      if (url === '/api.bitbucket.org/2.0/user') return send(res, account('Ann'))
      const node = {
        id: 3,
        title: 'Log in with a password',
        draft: false,
        author: account('Bob'),
        created_on: '2026-10-20T10:00:00+00:00',
        updated_on: '2026-10-21T10:00:00+00:00',
        comment_count: 1,
        source: {
          branch: { name: 'feature/login' },
          commit: { hash: head.slice(0, 12) },
          repository: { full_name: 'acme/widgets' }
        },
        destination: { branch: { name: 'main' } },
        participants: [
          { user: account('Ann'), role: 'REVIEWER', approved: false, state: 'changes_requested' }
        ],
        links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/3' } },
        description: 'Adds **the login**'
      }
      if (url.startsWith(`${api}?`)) return send(res, { values: [node] })
      if (url.startsWith(`${api}/3/statuses`))
        return send(res, {
          values: [
            { key: 'ci', name: 'Pipeline', state: 'INPROGRESS', url: 'https://bitbucket.org/ci/1' }
          ]
        })
      if (url.startsWith(`${api}/3/comments`))
        return send(res, {
          values: [
            {
              content: { raw: 'Please add a test' },
              created_on: '2026-10-21T09:00:00+00:00',
              user: account('Ann'),
              deleted: false,
              inline: { path: 'login.js', to: 1, from: null }
            }
          ]
        })
      if (url.startsWith(`${api}/3/commits`)) return send(res, { values: [{ hash: head }] })
      if (url.startsWith(`${api}/3/diffstat`)) return send(res, { values: [{ status: 'added' }] })
      if (url.startsWith(`${api}/3`)) return send(res, node)
      return send(res, { message: `Unexpected ${url}` }, 404)
    }))
    const { port } = server.address() as AddressInfo
    git(repo, 'remote', 'add', 'origin', 'https://bitbucket.org/acme/widgets.git')
    profile = profileWith(repo, '')
    gitdom = await launch([repo], {
      profile,
      env: {
        GITDOM_FORGE_MOCK: `http://127.0.0.1:${port}`,
        GITDOM_FORGE_MOCK_GCM_TOKEN: 'gcm-token',
        // bitbucket.org isn't reachable in the tests: git refuses https at once
        GIT_ALLOW_PROTOCOL: 'file',
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1'
      }
    })
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    await new Promise((done) => server?.close(done))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    cleanUp(profile)
  })

  it("connects with Git Credential Manager's token, with its username and then alone", async () => {
    const { win } = gitdom
    await win.locator('.pull-connect:has-text("Connect to Bitbucket")').click()
    await win.locator('.toast:has-text("Connected to Bitbucket as ann")').waitFor()
    expect(auths[0]).toMatch(/^Basic /)
    expect(auths).toContain('Bearer gcm-token')
    const row = win.locator('.pull-row:has-text("Log in with a password")')
    await row.waitFor()
    await expect(row.innerText()).resolves.toContain('#3')
  })

  it('shows changes requested on the badge, and the conversation in the view', async () => {
    const { win } = gitdom
    const badge = win.locator('.ref-pill:has-text("origin/feature/login") .pull-badge')
    await expect(badge.getAttribute('class')).resolves.toContain('tone-changes')
    await badge.click()
    const view = win.locator('.pull-view')
    await view.locator('.pull-description:has-text("Adds the login")').waitFor()
    await view.locator('.pull-comment:has-text("Please add a test")').waitFor()
    await view.locator('.pull-check:has-text("Pipeline")').waitFor()
    // The commits can't be fetched here: the view says so, and the rest stays
    await view.locator('.pull-fetch-error:has-text("Couldn\'t fetch #3")').waitFor()
    await win.keyboard.press('Escape')
  })
})

// Bitbucket Data Center at 127.0.0.1, project "abc", repository "widgets", told by its /scm/ address
describe('pull requests of Bitbucket Data Center', () => {
  let dir: string
  let profile: string
  let server: Server
  let gitdom: Running
  const avatarAuth: string[] = []
  const posted: { url: string; body: Record<string, unknown> }[] = []

  const person = (name: string): Record<string, unknown> => ({
    name: name.toLowerCase(),
    displayName: name,
    slug: name.toLowerCase(),
    active: true,
    avatarUrl: `/users/${name.toLowerCase()}/avatar.png?s=64`
  })

  beforeAll(async () => {
    dir = scratch('bitbucket-server')
    const served = join(dir, 'served')
    const { repo, head } = repoWithBranch(dir, join(served, 'scm', 'abc', 'widgets.git'))
    // The branch a new pull request comes from, already pushed
    git(repo, 'checkout', '-q', '-b', 'feature/cart')
    commitFile(repo, 'cart.js', 'export const cart = []\n', 'Add the cart')
    const cart = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'push', '-q', join(served, 'scm', 'abc', 'widgets.git'), 'feature/cart')

    const repoApi = '/127.0.0.1/rest/api/1.0/projects/ABC/repos/widgets'
    const ref = (branch: string, commit: string): Record<string, unknown> => ({
      id: `refs/heads/${branch}`,
      displayId: branch,
      latestCommit: commit,
      repository: { slug: 'widgets', project: { key: 'ABC' } }
    })
    const pulls = [
      {
        id: 5,
        version: 1,
        title: 'Log in with a password',
        description: 'Adds **the login**',
        state: 'OPEN',
        createdDate: 1790000000000,
        updatedDate: 1790000600000,
        fromRef: ref('feature/login', head),
        toRef: ref('main', head),
        author: { user: person('Bob'), role: 'AUTHOR', status: 'UNAPPROVED' },
        reviewers: [{ user: person('Ann'), role: 'REVIEWER', status: 'UNAPPROVED' }],
        participants: [],
        properties: { mergeResult: { outcome: 'CLEAN' }, commentCount: 1 },
        links: { self: [{ href: 'https://127.0.0.1/projects/ABC/repos/widgets/pull-requests/5' }] }
      }
    ]
    const reply = (res: ServerResponse, body: unknown, headers = {}): true => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-AUSERNAME': 'ann', ...headers })
      res.end(JSON.stringify(body))
      return true
    }
    ;({ server } = await fakeService(served, (url, req, res) => {
      if (url.startsWith('/127.0.0.1/users/')) {
        avatarAuth.push(String(req.headers.authorization))
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(AVATAR)
        return true
      }
      if (!url.startsWith('/127.0.0.1/rest/')) return false
      // Git Credential Manager's username and password, as a Data Center keeps them
      if (req.headers.authorization !== `Basic ${Buffer.from('git:gcm-token').toString('base64')}`)
        return send(res, { errors: [{ message: 'Authentication failed' }] }, 401)
      if (req.method === 'POST') {
        let raw = ''
        req.on('data', (chunk: Buffer) => (raw += chunk.toString()))
        req.on('end', () => {
          const body = JSON.parse(raw) as Record<string, unknown>
          posted.push({ url, body })
          const created = {
            ...pulls[0],
            id: 6,
            title: String(body.title),
            fromRef: ref('feature/cart', cart)
          }
          pulls.push(created)
          reply(res, { ...created, reviewers: body.reviewers })
        })
        return true
      }
      if (url.startsWith('/127.0.0.1/rest/api/1.0/users?')) {
        if (url.includes('permission.1=REPO_READ'))
          return reply(res, { values: [person('Bob'), person('Cy')] })
        return reply(res, { values: url.includes('filter=ann') ? [person('Ann')] : [] })
      }
      if (url.startsWith('/127.0.0.1/rest/build-status/1.0/commits/'))
        return reply(res, {
          values: [{ key: 'ci', name: 'Jenkins', state: 'FAILED', url: 'https://127.0.0.1/ci/1' }]
        })
      if (url.startsWith('/127.0.0.1/rest/default-reviewers/')) return reply(res, [person('Cy')])
      if (url.startsWith(`${repoApi}/pull-requests?`)) return reply(res, { values: pulls })
      if (url.startsWith(`${repoApi}/default-branch`)) return reply(res, { displayId: 'main' })
      if (url.startsWith(`${repoApi}/settings/pull-requests`))
        return reply(res, {
          mergeConfig: { defaultStrategy: { id: 'no-ff' }, strategies: [{ id: 'no-ff' }] }
        })
      if (url.startsWith(`${repoApi}/settings/auto-merge`)) return reply(res, { enabled: false })
      const one = /\/pull-requests\/(\d+)(\/[a-z]+)?/.exec(url)
      if (one?.[2] === '/activities')
        return reply(res, {
          values: [
            {
              action: 'COMMENTED',
              commentAction: 'ADDED',
              comment: {
                id: 1,
                text: 'Use a **constant**',
                author: person('Ann'),
                createdDate: 1790000300000,
                comments: []
              },
              commentAnchor: { path: 'login.js', line: 1 }
            }
          ]
        })
      if (one?.[2] === '/commits') return reply(res, { values: [{ id: head }] })
      if (one?.[2] === '/merge')
        return reply(res, {
          canMerge: false,
          conflicted: false,
          outcome: 'CLEAN',
          vetoes: [{ summaryMessage: 'Requires 2 approvals' }]
        })
      if (one) return reply(res, pulls.find((p) => p.id === Number(one[1])) ?? pulls[0])
      if (url === repoApi) return reply(res, { id: 1, slug: 'widgets' })
      return send(res, { errors: [{ message: `Unexpected ${url}` }] }, 404)
    }))
    const { port } = server.address() as AddressInfo
    git(repo, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/scm/abc/widgets.git`)
    git(
      repo,
      'fetch',
      '-q',
      join(served, 'scm', 'abc', 'widgets.git'),
      'feature/cart:refs/remotes/origin/feature/cart'
    )
    git(repo, 'branch', '-q', '--set-upstream-to=origin/feature/cart', 'feature/cart')
    profile = profileWith(repo, '')
    gitdom = await launch([repo], {
      profile,
      env: {
        GITDOM_FORGE_MOCK: `http://127.0.0.1:${port}`,
        GITDOM_FORGE_MOCK_GCM_TOKEN: 'gcm-token',
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1'
      }
    })
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    await new Promise((done) => server?.close(done))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    cleanUp(profile)
  })

  it("connects with Git Credential Manager's username and password", async () => {
    const { win } = gitdom
    await win
      .locator('.pull-connect:has-text("Connect to Bitbucket Data Center (127.0.0.1)")')
      .click()
    await win.locator('.toast:has-text("Connected to Bitbucket Data Center as ann")').waitFor()
    const row = win.locator('.pull-row:has-text("Log in with a password")')
    await row.waitFor()
    await expect(row.innerText()).resolves.toContain('#5')
    const groups = await win.locator('.pull-group').allInnerTexts()
    expect(groups.map((g) => g.split('\n')[0].trim())).toEqual(['REVIEW REQUESTED'])
  })

  it('shows the merge checks that veto it, the conversation, the build and the changes', async () => {
    const { win } = gitdom
    const badge = win.locator('.ref-pill:has-text("origin/feature/login") .pull-badge')
    await expect(badge.innerText()).resolves.toBe('#5')
    await badge.click()
    const view = win.locator('.pull-view')
    await view.locator('.pull-description:has-text("Adds the login")').waitFor()
    await view.locator('.pull-merge:has-text("Requires 2 approvals")').waitFor()
    await view.locator('.pull-check:has-text("Jenkins")').waitFor()
    await view.locator('.pull-comment:has-text("Use a constant")').waitFor()
    await expect(view.locator('.pull-comment').innerText()).resolves.toContain('login.js:1')
    await win.locator('.detail-title:has-text("Changes of #5")').waitFor()
    await win.locator('.detail .file-row:has-text("login.js")').waitFor()
    // The pictures are on the server, behind the login
    expect(avatarAuth.length).toBeGreaterThan(0)
    expect(avatarAuth.every((a) => a.startsWith('Basic '))).toBe(true)
    await win.keyboard.press('Escape')
  })

  it('opens a pull request with a reviewer and the default reviewers', async () => {
    const { win } = gitdom
    await win
      .locator('.section-header:has-text("Pull Requests") .section-add[title="New pull request"]')
      .click()
    const dialog = win.locator('.create-pull')
    await dialog
      .locator('.modal-title:has-text("New pull request on Bitbucket Data Center")')
      .waitFor()
    await dialog.locator('.create-commit:has-text("Add the cart")').waitFor()
    await expect(dialog.locator('input').first().inputValue()).resolves.toBe('Add the cart')
    // Data Center has no labels
    await expect(dialog.locator('.create-labels').count()).resolves.toBe(0)
    await dialog.locator('.reviewer-chips input').fill('bo')
    await dialog.locator('.reviewer-result:has-text("bob")').click()
    await dialog.locator('button[type=submit]:has-text("Open pull request")').click()
    await win.locator('.pull-view .pull-title:has-text("Add the cart")').waitFor()
    expect(posted).toHaveLength(1)
    expect(posted[0].url).toBe('/127.0.0.1/rest/api/1.0/projects/ABC/repos/widgets/pull-requests')
    expect(posted[0].body).toEqual({
      title: 'Add the cart',
      description: '',
      fromRef: {
        id: 'refs/heads/feature/cart',
        repository: { slug: 'widgets', project: { key: 'ABC' } }
      },
      toRef: { id: 'refs/heads/main', repository: { slug: 'widgets', project: { key: 'ABC' } } },
      reviewers: [{ user: { name: 'bob' } }, { user: { name: 'cy' } }]
    })
    await win.keyboard.press('Escape')
  })
})
