import { execFileSync } from 'child_process'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanUp, launch, makeRepo, scratch, type Running } from './helpers'
import type { Page } from 'playwright-core'

/** Runs a command of the palette, found by the start of its title. */
async function palette(win: Page, title: string): Promise<void> {
  await win.keyboard.press('ControlOrMeta+Shift+P')
  await win.locator('.palette input').fill(title)
  await win.keyboard.press('Enter')
}

/**
 * Adds `count` commits that each rewrite a tenth of the lines of big.txt, in one `git fast-import`:
 * the time-lapse then has thousands of line diffs to compute.
 */
function addBigHistory(repo: string, count: number, lines: number): void {
  let seed = 7
  const random = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  const text = Array.from({ length: lines }, (_, i) => `line ${i} of the big file`)
  let stream = ''
  for (let c = 0; c < count; c++) {
    for (let k = 0; k < lines / 10; k++) text[random(lines)] = `changed ${c}.${k} ${random(1e6)}`
    const content = text.join('\n') + '\n'
    const message = `Big ${c + 1}\n`
    stream +=
      `commit refs/heads/main\ncommitter E2E Tester <e2e@gitdom.invalid> ${1790000000 + c * 60} +0000\n` +
      `data ${Buffer.byteLength(message)}\n${message}` +
      (c === 0 ? 'from refs/heads/main^0\n' : '') +
      `M 100644 inline big.txt\ndata ${Buffer.byteLength(content)}\n${content}\n`
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, input: stream })
  execFileSync('git', ['reset', '-q', '--hard', 'main'], { cwd: repo })
}

describe('Long computations', () => {
  let dir: string
  let repo: string
  let gitdom: Running

  beforeAll(async () => {
    dir = scratch('workers')
    repo = makeRepo(dir)
    execFileSync('git', ['checkout', '-q', '--', 'README.md'], { cwd: repo })
    addBigHistory(repo, 400, 4000)
    gitdom = await launch([repo])
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    cleanUp(dir)
  })

  it('show the statistics of the repository', async () => {
    const { win } = gitdom
    await palette(win, 'Statistics: authors')
    const commits = win.locator('.stats-figure:has-text("Commits") .stats-figure-value')
    await expect(commits.innerText({ timeout: 60000 })).resolves.toBe('402')
    await expect(
      win.locator('.stats-figure:has-text("Authors") .stats-figure-value').innerText()
    ).resolves.toBe('1')
    await win.keyboard.press('Escape')
  })

  it('leave the main process free while a time-lapse is computed', async () => {
    const { revisions, took, slowest } = await gitdom.win.evaluate(async (path) => {
      const started = performance.now()
      let done = false
      const loading = window.api.op(path, 'timelapse', 'big.txt').finally(() => (done = true))
      // How long the main process takes to answer the interface, again and again, meanwhile
      let slowest = 0
      while (!done) {
        const asked = performance.now()
        await window.api.activity.list()
        slowest = Math.max(slowest, performance.now() - asked)
      }
      const result = await loading
      return {
        revisions: result.ok ? result.value.revisions.length : result.error,
        took: performance.now() - started,
        slowest
      }
    }, repo)
    expect(revisions).toBe(400)
    // Without the worker, the main process would be stuck for the whole computation
    if (took > 1000) expect(slowest).toBeLessThan(took / 2)
  })
})
