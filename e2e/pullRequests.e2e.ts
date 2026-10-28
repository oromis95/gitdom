import { readFileSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AVATAR,
  cleanUp,
  commitFile,
  gitBackend,
  git,
  launch,
  makeRepo,
  palette,
  scratch,
  seedProfile,
  type Running
} from './helpers'

const user = (login: string): { login: string; name: string; avatarUrl: string } => ({
  login,
  name: login[0].toUpperCase() + login.slice(1),
  avatarUrl: `https://127.0.0.1/avatars/${login}.png`
})

function pull(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    title: 'A pull request',
    url: 'https://127.0.0.1/acme/widgets/pull/0',
    isDraft: false,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-21T10:00:00Z',
    baseRefName: 'main',
    headRepository: { nameWithOwner: 'acme/widgets' },
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    totalCommentsCount: 0,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    ...fields
  }
}

describe('pull requests', () => {
  let dir: string
  let repo: string
  let profile: string
  let server: Server
  let gitdom: Running
  let head: string
  const tokens: string[] = []

  beforeAll(async () => {
    dir = scratch('pulls')
    repo = makeRepo(dir)
    git(repo, 'commit', '-q', '-am', 'Change the readme')
    const bare = join(dir, 'served', 'acme', 'widgets.git')
    git(dir, 'init', '-q', '--bare', '-b', 'main', bare)
    git(repo, 'push', '-q', bare, 'main')
    // The pull request: a branch on the server, and GitHub's ref for it
    git(repo, 'checkout', '-q', '-b', 'feature/login')
    commitFile(repo, 'login.js', 'export const login = () => true\n', 'Add the login')
    commitFile(repo, 'app.js', 'console.info("hello, login")\n', 'Greet on login')
    head = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'push', '-q', bare, 'feature/login', 'feature/login:refs/pull/7/head')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'branch', '-q', '-D', 'feature/login')

    const answers = {
      pulls: {
        data: {
          viewer: user('ann'),
          repository: {
            pullRequests: {
              nodes: [
                pull({
                  number: 7,
                  title: 'Log in with a password',
                  url: 'https://127.0.0.1/acme/widgets/pull/7',
                  author: user('bob'),
                  headRefName: 'feature/login',
                  headRefOid: head,
                  totalCommentsCount: 2,
                  labels: { nodes: [{ name: 'feature', color: '0e8a16' }] },
                  reviewRequests: { nodes: [{ requestedReviewer: user('ann') }] },
                  latestOpinionatedReviews: {
                    nodes: [{ state: 'APPROVED', author: user('cy') }]
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
                                  name: 'unit tests',
                                  status: 'COMPLETED',
                                  conclusion: 'FAILURE',
                                  detailsUrl: 'https://127.0.0.1/acme/widgets/runs/1'
                                },
                                {
                                  __typename: 'CheckRun',
                                  name: 'lint',
                                  status: 'COMPLETED',
                                  conclusion: 'SUCCESS',
                                  detailsUrl: null
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }),
                pull({
                  number: 8,
                  title: 'Dark mode',
                  isDraft: true,
                  author: user('ann'),
                  headRefName: 'dark-mode',
                  headRefOid: '0'.repeat(40)
                })
              ]
            }
          }
        }
      },
      detail: {
        data: {
          repository: {
            pullRequest: {
              number: 7,
              isDraft: false,
              reviewDecision: 'REVIEW_REQUIRED',
              mergeable: 'MERGEABLE',
              mergeStateStatus: 'BEHIND',
              last: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
              body: '## Why\nUsers asked for it.\n\n- [x] Tests\n- [ ] Docs\n\n```js\nlogin()\n```',
              comments: {
                nodes: [
                  {
                    body: 'Looks **good**',
                    createdAt: '2026-10-21T09:00:00Z',
                    author: user('cy')
                  }
                ]
              },
              reviews: { nodes: [] },
              commits: { nodes: [] }
            }
          }
        }
      }
    }

    const served = join(dir, 'served')
    server = createServer((req, res) => {
      const url = req.url ?? ''
      if (url.startsWith('/127.0.0.1/avatars/')) {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(AVATAR)
        return
      }
      if (url === '/127.0.0.1/api/graphql') {
        tokens.push(String(req.headers.authorization))
        let body = ''
        req.on('data', (chunk: Buffer) => (body += chunk.toString()))
        req.on('end', () => {
          const { query } = JSON.parse(body) as { query: string }
          const answer = query.includes('pullRequests(')
            ? answers.pulls
            : query.includes('pullRequest(')
              ? answers.detail
              : { data: { viewer: user('ann') } }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(answer))
        })
        return
      }
      gitBackend(served, req, res)
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    git(repo, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/acme/widgets.git`)
    // From the folder: a synchronous git over HTTP would wait on this very process's server
    git(repo, 'fetch', '-q', bare, '+refs/heads/*:refs/remotes/origin/*')

    // The fake service is a server of one's own, of the GitHub kind
    profile = scratch('pulls-profile')
    seedProfile(profile, [repo])
    const settingsFile = join(profile, 'settings.json')
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, string>
    settings['gitdom.settings'] = JSON.stringify({
      ...JSON.parse(settings['gitdom.settings']),
      forgeHosts: '127.0.0.1 github'
    })
    writeFileSync(settingsFile, JSON.stringify(settings))
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
    // Waiting without blocking: the repository is released a moment after GitDom closes
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    cleanUp(profile)
  })

  it("connects with Git Credential Manager's token and lists the pull requests", async () => {
    const { win } = gitdom
    await win.locator('.pull-connect').click()
    await win.locator('.toast:has-text("Connected to GitHub as ann")').waitFor()
    await win.locator('.pull-row:has-text("Log in with a password")').waitFor()
    expect(tokens.every((t) => t === 'Bearer gcm-token')).toBe(true)
    const groups = await win.locator('.pull-group').allInnerTexts()
    expect(groups.map((g) => g.split('\n')[0].trim())).toEqual(['MINE', 'REVIEW REQUESTED'])
    // Git Credential Manager's token is never written down
    expect(readFileSync(join(profile, 'accounts.json'), 'utf8')).not.toContain('gcm-token')
  })

  it('shows a badge on the branch of a pull request, with its card', async () => {
    const { win } = gitdom
    const badge = win.locator('.ref-pill:has-text("origin/feature/login") .pull-badge')
    await expect(badge.innerText()).resolves.toBe('#7')
    await expect(badge.getAttribute('class')).resolves.toContain('tone-open')
    // The card shows after the mouse rests: once more if the graph redrew meanwhile
    const card = win.locator('.hover-pull')
    for (let tries = 0; tries < 4 && !(await card.isVisible()); tries++) {
      await win.mouse.move(5, 5)
      await win.locator('.ref-pill:has-text("origin/feature/login") > span').first().hover()
      await card.waitFor({ timeout: 3000 }).catch(() => undefined)
    }
    await expect(card.innerText()).resolves.toContain('unit tests')
  })

  it('opens a pull request with its conversation, checks and changes', async () => {
    const { win } = gitdom
    await win.locator('.ref-pill:has-text("origin/feature/login") .pull-badge').click()
    const view = win.locator('.pull-view')
    await view.locator('.pull-title:has-text("Log in with a password")').waitFor()
    await view.locator('.pull-description .md-heading:has-text("Why")').waitFor()
    await expect(view.locator('.pull-description .md-code').innerText()).resolves.toBe('login()')
    await view.locator('.pull-comment:has-text("Looks good")').waitFor()
    // GitHub's verdict for this one pull request, more exact than the list's
    await view.locator('.pull-merge:has-text("Behind the target branch")').waitFor()
    await expect(view.locator('.pull-check').first().innerText()).resolves.toContain('unit tests')
    // Fetched into the repository, its changes listed in the detail panel
    await view.locator('.pull-commit:has-text("Greet on login")').waitFor()
    await win.locator('.detail-title:has-text("Changes of #7")').waitFor()
    await win.locator('.detail .file-row:has-text("login.js")').waitFor()
    // A file's diff shows over the pull request, which comes back when it's closed
    await win.locator('.detail .file-row:has-text("app.js")').click()
    await win.locator('.diff-view:not(.pull-view)').waitFor()
    await win.keyboard.press('Escape')
    await view.waitFor()
    await win.keyboard.press('Escape')
    await view.waitFor({ state: 'detached' })
  })

  it('lists the pull requests in the palette', async () => {
    const { win } = gitdom
    await palette(win, 'Open #8 Dark mode')
    await win.locator('.pull-view .pull-title:has-text("Dark mode")').waitFor()
    await win.locator('.pull-view .pull-state:has-text("Draft")').waitFor()
    await win.keyboard.press('Escape')
  })

  it('disconnects from the preferences', async () => {
    const { win } = gitdom
    await palette(win, 'Preferences…')
    await win.locator('.pref-nav button:has-text("Accounts")').click()
    await win.locator('.account-row:has-text("ann")').waitFor()
    await win.locator('.account-row button:has-text("Disconnect")').click()
    await win.locator('.pref-content:has-text("No account yet")').waitFor()
    await win.keyboard.press('Escape')
    await win.locator('.pull-connect').waitFor()
  })
})
