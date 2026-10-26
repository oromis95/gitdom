// Tabs and waiting: opening a repository shows it loading at once, a tab's menu closes several
// tabs, and a push shows its progress. They run in order on the same window.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanUp, git, launch, makeRepo, scratch, type Running } from './helpers'

/** Records whether an element matching `selector` ever appears, even briefly. */
function watchFor(gitdom: Running, selector: string): Promise<void> {
  return gitdom.win.evaluate((selector) => {
    const seen = window as unknown as { seen?: Record<string, boolean> }
    seen.seen = { ...seen.seen, [selector]: false }
    new MutationObserver((_, observer) => {
      if (!document.querySelector(selector)) return
      seen.seen![selector] = true
      observer.disconnect()
    }).observe(document.body, { childList: true, subtree: true })
  }, selector)
}

const wasSeen = (gitdom: Running, selector: string): Promise<boolean> =>
  gitdom.win.evaluate(
    (selector) => !!(window as unknown as { seen: Record<string, boolean> }).seen[selector],
    selector
  )

const tabNames = (gitdom: Running): Promise<string[]> =>
  gitdom.win.locator('.tab .tab-name').allInnerTexts()

describe('Tabs', () => {
  let dir: string
  let repos: string[]
  let gitdom: Running

  beforeAll(async () => {
    dir = scratch('tabs')
    repos = ['alpha', 'beta', 'gamma'].map((name) => makeRepo(dir, name))
    gitdom = await launch(repos)
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    cleanUp(dir)
  })

  it('shows a repository loading in its tab as soon as it is picked', async () => {
    const { app, win } = gitdom
    const delta = makeRepo(dir, 'delta')
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (() =>
        Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, delta)
    await watchFor(gitdom, '.repo-loading')
    await win.locator('.tab-add[title="Open repository"]').first().click()
    await win.waitForSelector('.tab.active:has-text("delta")')
    await win.waitForSelector('.graph-row:has-text("Add the app")')
    expect(await wasSeen(gitdom, '.repo-loading')).toBe(true)
    expect(await tabNames(gitdom)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })

  it('closes tabs from the menu of a tab', async () => {
    const { win } = gitdom
    const menu = async (tab: string, item: string): Promise<void> => {
      await win.locator(`.tab:has-text("${tab}")`).click({ button: 'right' })
      await win.locator(`.menu-item:has-text("${item}")`).click()
    }
    await menu('gamma', 'Close tabs to the right')
    await expect.poll(() => tabNames(gitdom)).toEqual(['alpha', 'beta', 'gamma'])
    await menu('beta', 'Close tabs to the left')
    await expect.poll(() => tabNames(gitdom)).toEqual(['beta', 'gamma'])
    await menu('gamma', 'Close others')
    await expect.poll(() => tabNames(gitdom)).toEqual(['gamma'])
    await win.waitForSelector('.tab.active:has-text("gamma")')
  })

  it('shows the progress of a push', async () => {
    const { win } = gitdom
    const gamma = repos[2]
    git(dir, 'init', '-q', '--bare', '-b', 'main', 'gamma.git')
    git(gamma, 'remote', 'add', 'origin', `${dir}/gamma.git`)
    await watchFor(gitdom, '.busy-bar')
    await win.locator('.tool:has-text("Push")').click()
    await win.waitForSelector('.toast:has-text("Pushed")', { timeout: 30000 })
    expect(await wasSeen(gitdom, '.busy-bar')).toBe(true)
    expect(git(gamma, 'rev-parse', '--abbrev-ref', 'main@{u}')).toBe('origin/main')
  })

  it('closes every tab', async () => {
    const { win } = gitdom
    await win.locator('.tab:has-text("gamma")').click({ button: 'right' })
    await win.locator('.menu-item:has-text("Close all")').click()
    await win.waitForSelector('.welcome')
    expect(await tabNames(gitdom)).toEqual([])
  })
})
