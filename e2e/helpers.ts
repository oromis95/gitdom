// Starts the built GitDom (out/, from `electron-vite build`) with Playwright, in empty settings,
// on repositories made for each test.
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { _electron, type ElectronApplication, type Page } from 'playwright-core'
import { version } from '../package.json'

const ROOT = resolve(__dirname, '..')

export interface Running {
  app: ElectronApplication
  win: Page
  /** JavaScript errors of the interface: a test fails if there are any */
  errors: string[]
  close(): Promise<void>
}

/** A scratch folder removed by `cleanUp`. */
export function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `gitdom-e2e-${prefix}-`))
}

export function cleanUp(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/**
 * A repository with two commits on main and one changed file. Its path is git's, as GitDom keeps it
 * in its tabs: the Windows temp folder can be a short 8.3 name (DTROPE~1), the macOS one a link.
 */
export function makeRepo(parent: string, name = 'demo'): string {
  const repo = join(parent, name)
  git(parent, 'init', '-q', '-b', 'main', name)
  git(repo, 'config', 'user.name', 'E2E Tester')
  git(repo, 'config', 'user.email', 'e2e@gitdom.invalid')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'README.md'), '# Demo\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Initial commit')
  writeFileSync(join(repo, 'app.js'), 'console.info("hello")\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Add the app')
  writeFileSync(join(repo, 'README.md'), '# Demo\n\nA changed line.\n')
  return git(repo, 'rev-parse', '--show-toplevel')
}

/**
 * Starts GitDom with `repos` open in tabs. The welcome splash, the tips and the update check are
 * off, so the first thing shown is the graph of the first repository.
 */
export async function launch(repos: string[], env: Record<string, string> = {}): Promise<Running> {
  const userData = scratch('profile')
  // GITDOM_E2E_EXE runs the tests on a packaged GitDom instead, e.g. dist/win-unpacked/gitdom.exe
  const packaged = process.env.GITDOM_E2E_EXE
  const app = await _electron.launch({
    executablePath: packaged || (electronPath as unknown as string),
    args: packaged ? [] : [ROOT],
    env: { ...process.env, GITDOM_USER_DATA: userData, ...env } as Record<string, string>
  })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(
    ([v, tabs]) => {
      localStorage.setItem(
        'gitdom.settings',
        JSON.stringify({ showTips: false, checkUpdates: false, autoFetchMinutes: 0 })
      )
      localStorage.setItem('gitdom.splash', 'off')
      localStorage.setItem('gitdom.lastVersion', v)
      localStorage.setItem('gitdom.theme', 'dark')
      localStorage.setItem('gitdom.tabs', JSON.stringify({ paths: tabs, active: 0 }))
    },
    [version, repos] as const
  )
  await win.reload()
  if (repos.length > 0) await win.waitForSelector('.graph-row', { timeout: 60000 })
  return {
    app,
    win,
    errors,
    close: async () => {
      await app.close()
      cleanUp(userData)
    }
  }
}
