// Tabs and waiting: opening a repository shows it loading at once, a tab's menu closes several
// tabs, a push shows its progress and asks where to go when git can't tell or would refuse, a pull
// follows git's settings. They run in order on the same window.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanUp, commitFile, git, launch, makeRepo, scratch, type Running } from './helpers'

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

  it('asks where to push a new branch when there are several remotes and none is origin', async () => {
    const { win } = gitdom
    const gamma = repos[2]
    git(dir, 'init', '-q', '--bare', '-b', 'main', 'fork.git')
    git(gamma, 'remote', 'rename', 'origin', 'company')
    git(gamma, 'remote', 'add', 'fork', `${dir}/fork.git`)
    git(gamma, 'checkout', '-q', '-b', 'feature')
    await win.locator('.toolbar:has-text("feature")').waitFor()
    await win.locator('.tool:has-text("Push")').click()
    const choose = win.locator('.modal:has-text("Choose the remote")')
    await choose.waitFor()
    await expect(choose.locator('select option').allInnerTexts()).resolves.toEqual([
      'company',
      'fork'
    ])
    await choose.locator('select').selectOption('fork')
    await choose.locator('button[type=submit]:has-text("Push")').click()
    await win.waitForSelector('.toast:has-text("Pushed")', { timeout: 30000 })
    expect(git(gamma, 'rev-parse', '--abbrev-ref', 'feature@{u}')).toBe('fork/feature')
    expect(git(`${dir}/fork.git`, 'branch', '--format=%(refname:short)')).toBe('feature')

    // Now it follows the branch there: the next push asks nothing
    commitFile(gamma, 'next.txt', 'next\n', 'Next change')
    await win.locator('.graph-row:has-text("Next change")').waitFor()
    await win.locator('.tool:has-text("Push")').click()
    await expect
      .poll(() => git(`${dir}/fork.git`, 'rev-parse', 'feature'), { timeout: 30000 })
      .toBe(git(gamma, 'rev-parse', 'HEAD'))
    await expect(choose.count()).resolves.toBe(0)
  })

  it('asks before pushing to an upstream with another name, which git refuses', async () => {
    const { win } = gitdom
    const gamma = repos[2]
    const company = `${dir}/gamma.git`
    // Made from company/main, it follows company/main
    git(gamma, 'checkout', '-q', '-b', 'hotfix', 'company/main')
    commitFile(gamma, 'fix.txt', 'fix\n', 'Fix it')
    await win.locator('.graph-row:has-text("Fix it")').waitFor()
    await win.locator('.tool:has-text("Push")').click()
    const choose = win.locator('.modal:has-text("Push where?")')
    await choose.waitFor()
    await expect(choose.locator('select option').allInnerTexts()).resolves.toEqual([
      'company/hotfix, which it then follows',
      'company/main'
    ])
    await choose.locator('button[type=submit]:has-text("Push")').click()
    await expect
      .poll(() => git(gamma, 'rev-parse', '--abbrev-ref', 'hotfix@{u}'), { timeout: 30000 })
      .toBe('company/hotfix')
    expect(git(company, 'log', '-1', '--format=%s', 'hotfix')).toBe('Fix it')
    expect(git(company, 'log', '-1', '--format=%s', 'main')).toBe('Add the app')
  })

  it('pulls as set in git unless another way is picked', async () => {
    const { win } = gitdom
    await win.locator('.tool-arrow[aria-label="Pull options"]').click()
    await expect(win.locator('.menu-item:has-text("✓")').innerText()).resolves.toContain(
      'Pull (as set in git)'
    )
    await win.keyboard.press('Escape')
  })

  it('closes every tab', async () => {
    const { win } = gitdom
    await win.locator('.tab:has-text("gamma")').click({ button: 'right' })
    await win.locator('.menu-item:has-text("Close all")').click()
    await win.waitForSelector('.welcome')
    expect(await tabNames(gitdom)).toEqual([])
  })
})
