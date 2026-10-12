import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanUp, git, launch, makeRepo, scratch, type Running } from './helpers'

describe('GitDom', () => {
  let dir: string
  let repo: string
  let gitdom: Running

  beforeAll(async () => {
    dir = scratch('repos')
    repo = makeRepo(dir)
    gitdom = await launch([repo])
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    cleanUp(dir)
  })

  it('shows the graph of the open repository', async () => {
    const { win } = gitdom
    await win.waitForSelector('.graph-row:has-text("Add the app")')
    await expect(win.locator('.graph-row:has-text("Initial commit")').count()).resolves.toBe(1)
    await expect(win.locator('.tab.active').innerText()).resolves.toContain('demo')
  })

  it('runs the interface in a sandbox, with only the GitDom API', async () => {
    const page = await gitdom.win.evaluate(() => ({
      api: typeof window.api?.op,
      platform: window.api?.platform,
      process: typeof (globalThis as { process?: unknown }).process,
      require: typeof (globalThis as { require?: unknown }).require
    }))
    expect(page).toEqual({
      api: 'function',
      platform: process.platform,
      process: 'undefined',
      require: 'undefined'
    })
    // Electron reports the sandbox of each process on Windows and macOS only
    const renderers = await gitdom.app.evaluate(({ app }) =>
      app.getAppMetrics().filter((p) => p.type === 'Tab')
    )
    expect(renderers.length).toBeGreaterThan(0)
    for (const p of renderers) expect(p.sandboxed).not.toBe(false)
  })

  it('stages the changes and commits them', async () => {
    const { win } = gitdom
    await win.locator('.graph-row').first().click()
    await win.locator('button:has-text("Stage all changes")').click()
    await win.waitForFunction(() => !document.querySelector('.btn-stage'))
    await win.locator('.commit-box input[placeholder="Commit summary"]').fill('Change the readme')
    await win.locator('.commit-box .primary').click()
    await win.waitForSelector('.graph-row:has-text("Change the readme")')
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('Change the readme')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('creates a branch and checks it out', async () => {
    const { win } = gitdom
    await win.locator('.tool:has-text("Branch")').click()
    await win.locator('.modal input').first().fill('feature/e2e')
    await win.locator('.modal button[type=submit]').click()
    await win.waitForSelector('.toast:has-text("Created branch feature/e2e")')
    expect(git(repo, 'branch', '--show-current')).toBe('feature/e2e')
  })

  it('runs commands from the palette', async () => {
    const { win } = gitdom
    await win.keyboard.press('ControlOrMeta+Shift+P')
    await win.locator('.palette input').fill('Theme: Light')
    await win.keyboard.press('Enter')
    await win.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await expect(win.locator('.palette').count()).resolves.toBe(0)
  })
})
