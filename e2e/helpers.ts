// Starts the built GitDom (out/, from `electron-vite build`) with Playwright, in empty settings,
// on repositories made for each test.
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
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

export interface LaunchOptions {
  env?: Record<string, string>
  /** The userData folder, kept after close(); a new one by default */
  profile?: string
  seed?: boolean
}

/** The settings of a new profile: no splash, tips or update check, and `repos` open in tabs. */
export function seedProfile(userData: string, repos: string[]): void {
  const settings = {
    'gitdom.settings': JSON.stringify({
      showTips: false,
      checkUpdates: false,
      autoFetchMinutes: 0
    }),
    'gitdom.splash': 'off',
    'gitdom.lastVersion': version,
    'gitdom.theme': 'dark',
    'gitdom.tabs': JSON.stringify({ paths: repos, active: 0 })
  }
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
}

/**
 * Starts GitDom with `repos` open in tabs. The welcome splash, the tips and the update check are
 * off, so the first thing shown is the graph of the first repository. A `profile` folder given
 * is kept, so a test can start GitDom again on it; it's seeded only if it has no settings yet,
 * and not at all with `seed: false`.
 */
export async function launch(
  repos: string[],
  { env = {}, profile, seed = true }: LaunchOptions = {}
): Promise<Running> {
  const userData = profile ?? scratch('profile')
  if (seed && !existsSync(join(userData, 'settings.json'))) seedProfile(userData, repos)
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
  if (repos.length > 0) await win.waitForSelector('.graph-row', { timeout: 60000 })
  else await win.waitForLoadState('domcontentloaded')
  return {
    app,
    win,
    errors,
    close: async () => {
      await app.close()
      if (!profile) cleanUp(userData)
    }
  }
}
