import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanUp,
  commitFile,
  git,
  gitBackend,
  launch,
  makeRepo,
  palette,
  scratch,
  seedProfile,
  type Running
} from './helpers'

interface FakePull {
  number: number
  title: string
  branch: string
  head: string
  draft: boolean
}

const user = (login: string): { login: string; name: string; avatarUrl: null } => ({
  login,
  name: login,
  avatarUrl: null
})

/** A pull request as GitDom's list query reads it */
function node(p: FakePull): Record<string, unknown> {
  return {
    number: p.number,
    title: p.title,
    url: `https://127.0.0.1/acme/widgets/pull/${p.number}`,
    isDraft: p.draft,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-21T10:00:00Z',
    author: user(p.number === 9 ? 'ann' : 'bob'),
    headRefName: p.branch,
    headRefOid: p.head,
    baseRefName: 'main',
    headRepository: { nameWithOwner: 'acme/widgets' },
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    totalCommentsCount: 0,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] }
  }
}

describe('working on pull requests', () => {
  let dir: string
  let repo: string
  let bare: string
  let profile: string
  let server: Server
  let gitdom: Running
  const pulls: FakePull[] = []
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = []

  const sent = (method: string, path: string): Record<string, unknown> | undefined =>
    requests.find((r) => r.method === method && r.path === path)?.body

  beforeAll(async () => {
    dir = scratch('pull-actions')
    repo = makeRepo(dir)
    git(repo, 'commit', '-q', '-am', 'Change the readme')
    const served = join(dir, 'served')
    bare = join(served, 'acme', 'widgets.git')
    git(dir, 'init', '-q', '--bare', '-b', 'main', bare)
    // git's http-backend takes pushes only when told to
    git(bare, 'config', 'http.receivepack', 'true')
    git(repo, 'push', '-q', bare, 'main')
    for (const [number, branch, title, draft] of [
      [7, 'feature/login', 'Log in with a password', false],
      [8, 'dark-mode', 'Dark mode', true]
    ] as const) {
      git(repo, 'checkout', '-q', '-b', branch, 'main')
      commitFile(repo, `${branch.replace('/', '-')}.txt`, `${title}\n`, title)
      git(repo, 'push', '-q', bare, `${branch}:${branch}`, `${branch}:refs/pull/${number}/head`)
      pulls.push({ number, title, branch, head: git(repo, 'rev-parse', 'HEAD'), draft })
    }
    // The branch a new pull request comes from: one commit, not pushed yet
    git(repo, 'checkout', '-q', '-b', 'feature/signup', 'main')
    commitFile(repo, 'signup.js', 'export const signup = () => true\n', 'Add signup')
    mkdirSync(join(repo, '.github'))
    writeFileSync(
      join(repo, '.github', 'pull_request_template.md'),
      '## Why\n\n## How it was tested\n'
    )
    for (const branch of ['feature/login', 'dark-mode']) git(repo, 'branch', '-q', '-D', branch)
    git(repo, 'fetch', '-q', bare, '+refs/heads/*:refs/remotes/origin/*')

    const api = '/127.0.0.1/api/v3/repos/acme/widgets'
    server = createServer((req, res) => {
      const url = req.url ?? ''
      if (!url.startsWith('/127.0.0.1/')) return gitBackend(served, req, res)
      let raw = ''
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()))
      req.on('end', () => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        const method = req.method ?? 'GET'
        requests.push({ method, path: url.replace('/127.0.0.1', ''), body })
        const reply = (value: unknown, status = 200): void => {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(value))
        }
        if (url === '/127.0.0.1/api/graphql') {
          const query = String(body.query)
          if (query.includes('markPullRequestReadyForReview')) {
            pulls.find((p) => p.number === 8)!.draft = false
            return reply({
              data: { markPullRequestReadyForReview: { pullRequest: { id: 'PR_8' } } }
            })
          }
          if (query.includes('pullRequests('))
            return reply({
              data: {
                viewer: user('ann'),
                repository: { pullRequests: { nodes: pulls.map(node) } }
              }
            })
          if (query.includes('pullRequest('))
            return reply({
              data: {
                repository: {
                  pullRequest: {
                    number: (body.variables as { number: number }).number,
                    body: 'A description',
                    isDraft: false,
                    reviewDecision: null,
                    mergeable: 'MERGEABLE',
                    mergeStateStatus: 'CLEAN',
                    last: { nodes: [] },
                    comments: { nodes: [] },
                    reviews: { nodes: [] },
                    commits: { nodes: [] }
                  }
                }
              }
            })
          return reply({ data: { viewer: user('ann') } })
        }
        if (url === api)
          return reply({
            default_branch: 'main',
            allow_merge_commit: true,
            allow_squash_merge: true,
            allow_rebase_merge: false,
            delete_branch_on_merge: false
          })
        if (url.startsWith(`${api}/assignees`)) return reply([{ login: 'bob', avatar_url: null }])
        if (url.startsWith(`${api}/labels`)) return reply([{ name: 'feature', color: '0e8a16' }])
        if (method === 'POST' && url === `${api}/pulls`) {
          const number = 9 + pulls.filter((p) => p.number >= 9).length
          pulls.push({
            number,
            title: String(body.title),
            branch: String(body.head),
            head: git(bare, 'rev-parse', `refs/heads/${String(body.head)}`),
            draft: body.draft === true
          })
          return reply({ number, html_url: `https://127.0.0.1/acme/widgets/pull/${number}` }, 201)
        }
        const merge = /\/pulls\/(\d+)\/merge$/.exec(url)
        if (merge && method === 'PUT') {
          pulls.splice(
            pulls.findIndex((p) => p.number === Number(merge[1])),
            1
          )
          return reply({ merged: true })
        }
        const one = /\/pulls\/(\d+)$/.exec(url)
        if (one && method === 'PATCH') {
          if (body.state === 'closed')
            pulls.splice(
              pulls.findIndex((p) => p.number === Number(one[1])),
              1
            )
          if (body.state === 'open')
            pulls.push({
              number: 8,
              title: 'Dark mode',
              branch: 'dark-mode',
              head: git(bare, 'rev-parse', 'refs/heads/dark-mode'),
              draft: false
            })
          return reply({})
        }
        if (one) return reply({ node_id: `PR_${one[1]}` })
        return reply({})
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    git(repo, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/acme/widgets.git`)
    git(repo, 'branch', '-q', '--set-upstream-to=origin/main', 'main')

    profile = scratch('pull-actions-profile')
    seedProfile(profile, [repo])
    const file = join(profile, 'settings.json')
    const settings = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    settings['gitdom.settings'] = JSON.stringify({
      ...JSON.parse(settings['gitdom.settings']),
      forgeHosts: '127.0.0.1 github'
    })
    writeFileSync(file, JSON.stringify(settings))
    gitdom = await launch([repo], {
      profile,
      env: {
        GITDOM_FORGE_MOCK: `http://127.0.0.1:${port}`,
        GITDOM_FORGE_MOCK_GCM_TOKEN: 'gcm-token',
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1'
      }
    })
    await gitdom.win.locator('.pull-connect').click()
    await gitdom.win.locator('.pull-row:has-text("Log in with a password")').waitFor()
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    await new Promise((done) => server?.close(done))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    cleanUp(profile)
  })

  it('pushes a new branch and opens its pull request, with the template, a reviewer and a label', async () => {
    const { win } = gitdom
    await win
      .locator('.section-header:has-text("Pull Requests") .section-add[title="New pull request"]')
      .click()
    const dialog = win.locator('.create-pull')
    // The title follows the commits once they're read: one commit, its subject
    await dialog.locator('.create-commit:has-text("Add signup")').waitFor()
    await expect(dialog.locator('input').first().inputValue()).resolves.toBe('Add signup')
    await expect(dialog.locator('textarea').inputValue()).resolves.toContain('## How it was tested')
    await dialog.locator('.create-note:has-text("isn\'t on the remote yet")').waitFor()
    await dialog.locator('.create-commit:has-text("Add signup")').waitFor()
    await dialog.locator('.reviewer-chips input').fill('bo')
    await dialog.locator('.reviewer-result:has-text("bob")').click()
    await dialog.locator('.create-label:has-text("feature")').click()
    await dialog.locator('button[type=submit]:has-text("Push and open")').click()
    await win.locator('.pull-view .pull-title:has-text("Add signup")').waitFor()
    expect(sent('POST', '/api/v3/repos/acme/widgets/pulls')).toMatchObject({
      head: 'feature/signup',
      base: 'main',
      title: 'Add signup',
      draft: false
    })
    expect(sent('POST', '/api/v3/repos/acme/widgets/pulls/9/requested_reviewers')).toEqual({
      reviewers: ['bob']
    })
    expect(sent('POST', '/api/v3/repos/acme/widgets/issues/9/labels')).toEqual({
      labels: ['feature']
    })
    // Pushed for real, with its upstream set
    expect(git(bare, 'rev-parse', 'refs/heads/feature/signup')).toBe(
      git(repo, 'rev-parse', 'feature/signup')
    )
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'feature/signup@{upstream}')).toBe(
      'origin/feature/signup'
    )
    await win.keyboard.press('Escape')
  })

  it('checks out a pull request, squashes it and cleans up the local branch', async () => {
    const { win } = gitdom
    await palette(win, 'Open #7 Log in')
    const view = win.locator('.pull-view')
    await view.locator('.pull-actions button:has-text("Check out")').click()
    await win.locator('.toast:has-text("Checked out feature/login")').waitFor()
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/login')
    await view.locator('.pull-actions button:has-text("Merge")').click()
    const dialog = win.locator('.merge-pull')
    await dialog.locator('.merge-method').first().waitFor()
    // Rebasing isn't allowed by the repository
    await expect(dialog.locator('.merge-method').allInnerTexts()).resolves.toEqual([
      expect.stringContaining('Merge commit'),
      expect.stringContaining('Squash')
    ])
    await dialog.locator('.merge-method:has-text("Squash")').click()
    await dialog.locator('button[type=submit]:has-text("Merge")').click()
    const cleanup = win.locator('.modal:has-text("Merged #7")')
    await cleanup.waitFor()
    expect(sent('PUT', '/api/v3/repos/acme/widgets/pulls/7/merge')).toEqual({
      merge_method: 'squash',
      sha: pulls.length ? git(bare, 'rev-parse', 'refs/heads/feature/login') : expect.any(String)
    })
    await cleanup.locator('button:has-text("Clean up")').click()
    await expect
      .poll(() => git(repo, 'branch', '--format=%(refname:short)').split('\n'), { timeout: 20000 })
      .not.toContain('feature/login')
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    await view.locator('.center-message:has-text("was merged")').waitFor()
    await win.keyboard.press('Escape')
  })

  it('offers to open a pull request after pushing a branch without one', async () => {
    const { win } = gitdom
    git(repo, 'checkout', '-q', '-b', 'feature/profile')
    commitFile(repo, 'profile.js', 'export const profile = {}\n', 'Add the profile page')
    // Made outside GitDom: it shows once the watcher sees it
    await win.locator('.toolbar:has-text("feature/profile")').waitFor()
    await win.locator('.tool:has-text("Push")').click()
    const toast = win.locator('.toast:has-text("Pushed")')
    await toast.locator('.toast-action:has-text("Create pull request")').click()
    const dialog = win.locator('.create-pull')
    await dialog.locator('.create-commit:has-text("Add the profile page")').waitFor()
    await expect(dialog.locator('select').first().inputValue()).resolves.toBe('feature/profile')
    // Already pushed: nothing to push first
    await expect(dialog.locator('.create-note').count()).resolves.toBe(0)
    await dialog.locator('button:has-text("Cancel")').click()
  })

  it('marks a draft ready, closes it and opens it again', async () => {
    const { win } = gitdom
    await palette(win, 'Open #8 Dark mode')
    const view = win.locator('.pull-view')
    await view.locator('.pull-state:has-text("Draft")').waitFor()
    await view.locator('.pull-actions button:has-text("More")').click()
    await win.locator('.menu-item:has-text("Ready for review")').click()
    await win.locator('.toast:has-text("#8 is ready for review")').waitFor()
    await view.locator('.pull-state:has-text("Open")').waitFor()
    expect(
      requests.some((r) => String(r.body.query).includes('markPullRequestReadyForReview'))
    ).toBe(true)

    await view.locator('.pull-actions button:has-text("More")').click()
    await win.locator('.menu-item:has-text("Close without merging")').click()
    await win.locator('.modal button:has-text("Close")').last().click()
    await view.locator('.center-message:has-text("is closed")').waitFor()
    expect(sent('PATCH', '/api/v3/repos/acme/widgets/pulls/8')).toEqual({ state: 'closed' })
    await view.locator('.center-message button:has-text("Reopen")').click()
    await view.locator('.pull-title:has-text("Dark mode")').waitFor()
    await win.keyboard.press('Escape')
  })

  it('asks where to push a new branch when no remote is origin, above the dialog', async () => {
    const { win } = gitdom
    const fork = join(dir, 'fork.git')
    git(dir, 'init', '-q', '--bare', '-b', 'main', fork)
    git(repo, 'remote', 'rename', 'origin', 'upstream')
    git(repo, 'remote', 'add', 'fork', fork)
    git(repo, 'checkout', '-q', '-b', 'feature/search', 'main')
    commitFile(repo, 'search.js', 'export const search = () => []\n', 'Add search')
    await win.locator('.toolbar:has-text("feature/search")').waitFor()
    await win
      .locator('.section-header:has-text("Pull Requests") .section-add[title="New pull request"]')
      .click()
    const dialog = win.locator('.create-pull')
    await dialog.locator('.create-commit:has-text("Add search")').waitFor()
    await dialog.locator('button[type=submit]:has-text("Push and open")').click()
    // Clicks fail on a form hidden under the pull request dialog
    const choose = win.locator('.modal:has-text("Choose the remote")')
    await choose.locator('select').selectOption('upstream')
    await choose.locator('button[type=submit]:has-text("Push")').click()
    await win.locator('.pull-view .pull-title:has-text("Add search")').waitFor()
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'feature/search@{upstream}')).toBe(
      'upstream/feature/search'
    )
    expect(git(fork, 'branch')).toBe('')
    await win.keyboard.press('Escape')
  })
})
