import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanUp, git, launch, makeRepo, scratch, type Running } from './helpers'

// A server that wants a username and password: git asks GitDom's dialog for them
describe('credentials', () => {
  let dir: string
  let repo: string
  let server: Server
  let gitdom: Running
  const received: string[] = []

  const fetchAll = async (): Promise<void> => {
    await gitdom.win.locator('.tool-arrow[aria-label="Pull options"]').click()
    await gitdom.win.locator('.menu-item:has-text("Fetch all")').click()
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      const auth = req.headers.authorization
      if (!auth) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="e2e"' })
        res.end()
        return
      }
      received.push(Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString('utf8'))
      // Wrong on purpose: git gives up instead of fetching
      res.writeHead(403)
      res.end()
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    dir = scratch('credentials')
    repo = makeRepo(dir)
    git(repo, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/demo.git`)
    // No credential helper: the system's one would answer instead of the dialog
    git(repo, 'config', 'credential.helper', '')
    gitdom = await launch([repo], { env: { NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' } })
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    await new Promise((done) => server?.close(done))
    cleanUp(dir)
  })

  it('asks for the username and password once, and gives them to git', async () => {
    const { win } = gitdom
    await fetchAll()
    const dialog = win.locator('.credential-dialog')
    await dialog.waitFor()
    await expect(dialog.locator('.modal-title').innerText()).resolves.toContain(
      'Sign in — http://127.0.0.1'
    )
    await dialog.locator('input').first().fill('me')
    await dialog.locator('input[type=password]').fill('s3cret')
    await dialog.locator('button[type=submit]').click()
    await win.waitForSelector('.toast')
    expect(received).toEqual(['me:s3cret'])
    await expect(win.locator('.credential-dialog').count()).resolves.toBe(0)
  })

  it('makes the fetch fail when the dialog is cancelled', async () => {
    const { win } = gitdom
    received.length = 0
    await win.locator('.toast button[aria-label=Dismiss]').first().click()
    await fetchAll()
    await win.locator('.credential-dialog').waitFor()
    await win.keyboard.press('Escape')
    await win.waitForSelector('.toast')
    expect(received).toEqual([])
    await expect(win.locator('.credential-dialog').count()).resolves.toBe(0)
  })
})
