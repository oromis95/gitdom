import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanUp, contextMenu, git, launch, makeRepo, scratch, type Running } from './helpers'

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

  it('keeps the commit messages readable in the smallest window', async () => {
    const { win } = gitdom
    const box = async (selector: string): Promise<{ x: number; width: number }> => {
      const { x, width } = (await win.locator(selector).first().boundingBox())!
      return { x: Math.round(x), width: Math.round(width) }
    }
    const cell = '.graph-row:has-text("Initial commit") .cell-message'
    const message = await box(cell)
    // MESSAGE_MIN: the other columns make room for it
    expect(message.width).toBeGreaterThanOrEqual(200)
    // The header stays over the cells
    await expect(box('.graph-header > div:has-text("COMMIT MESSAGE")')).resolves.toEqual(message)

    // Dragged narrower, the branch labels the window narrows give the message more room; a
    // double-click on their edge gives them back the width the window allows
    const refs = await box('.col-graphRefsWidth')
    const handle = (await win.locator('.col-graphRefsWidth .resize-handle').boundingBox())!
    const y = handle.y + handle.height / 2
    await win.mouse.move(handle.x + handle.width / 2, y)
    await win.mouse.down()
    await win.mouse.move(handle.x + handle.width / 2 - 30, y, { steps: 5 })
    await win.mouse.up()
    await expect.poll(async () => (await box('.col-graphRefsWidth')).width).toBe(refs.width - 30)
    await expect.poll(async () => (await box(cell)).width).toBe(message.width + 30)
    await win.locator('.col-graphRefsWidth .resize-handle').dblclick()
    await expect.poll(async () => (await box('.col-graphRefsWidth')).width).toBe(refs.width)
  })

  it('writes dates day first, with times on 24 hours', async () => {
    const { win } = gitdom
    const when = git(
      repo,
      'log',
      '-1',
      '--date=format-local:%d/%m/%Y, %H:%M',
      '--format=%ad',
      'HEAD~1'
    )
    const row = win.locator('.graph-row:has-text("Initial commit")')
    // The smallest window has room for the date beside the message only without the branch labels
    await contextMenu(win, '.graph-header', 'Hide Branch / Tag column')
    await expect(row.locator('.cell-date').innerText()).resolves.toBe(when)
    await contextMenu(win, '.graph-header', 'Show Branch / Tag column')
    await row.click()
    await expect(win.locator('dt:has-text("authored") + dd').innerText()).resolves.toBe(when)
  })

  it('shows deep folders whole in the folder view, scrolling sideways', async () => {
    const { win } = gitdom
    const base = 'src/main/java/com/example/accounting/foundation'
    for (const file of ['service/CapitalBudgetFoundationServiceImpl.java', 'dto/RequestDto.java']) {
      mkdirSync(dirname(join(repo, base, file)), { recursive: true })
      writeFileSync(join(repo, base, file), 'class Example {}\n')
    }
    git(repo, 'add', 'src')
    git(repo, 'commit', '-q', '-m', 'Add the services')
    await win.locator('.graph-row:has-text("Add the services")').click()
    await win.locator('.view-toggle button[title="Tree view"]').click()
    const rows = win.locator('.file-tree .file-row')
    await expect
      .poll(() => rows.allInnerTexts())
      .toEqual([
        base,
        'dto',
        'A\nRequestDto.java',
        'service',
        'A\nCapitalBudgetFoundationServiceImpl.java'
      ])
    await expect(rows.first().getAttribute('title')).resolves.toBe(base)
    // No name is cut: the panel scrolls sideways instead
    const cut = await win
      .locator('.file-tree .file-path')
      .evaluateAll((names) => names.filter((n) => n.scrollWidth > n.clientWidth).length)
    expect(cut).toBe(0)
    const panel = await win
      .locator('.detail-scroll')
      .evaluate((p) => ({ width: p.scrollWidth, visible: p.clientWidth }))
    expect(panel.width).toBeGreaterThan(panel.visible)
    await win.locator('.view-toggle button[title="Path view"]').click()
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
