// Starts the built GitDom (out/, from `electron-vite build`) with Playwright, in empty settings,
// on repositories made for each test.
import { execFileSync, spawn } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import type { IncomingMessage, ServerResponse } from 'http'
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
    // A window Windows thinks hidden behind others stops drawing frames, and Playwright then waits
    // forever for the elements to be still before clicking them
    args: [
      ...(packaged ? [] : [ROOT]),
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling'
    ],
    env: { ...process.env, GITDOM_USER_DATA: userData, ...env } as Record<string, string>
  })
  const win = await app.firstWindow()
  // GitDom's smallest window, narrower than the CI runners' screens (1024×768, with wider fonts
  // on Linux): what fits here fits there
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setSize(1000, 700)
    window?.focus()
  })
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

/** Right-clicks `target` and picks `item` in its menu. */
export async function contextMenu(win: Page, target: string, item: string): Promise<void> {
  await win.locator(target).first().click({ button: 'right' })
  await win.locator(`.menu-item:has-text("${item}")`).first().click()
}

/** Runs a command of the palette, found by the start of its title. */
export async function palette(win: Page, title: string): Promise<void> {
  const input = win.locator('.palette input')
  // Not while the last command's palette is still closing, nor before the window has the keys
  await win.locator('.palette').waitFor({ state: 'detached' })
  await win.keyboard.press('ControlOrMeta+Shift+P')
  if (
    !(await input.waitFor({ timeout: 3000 }).then(
      () => true,
      () => false
    ))
  )
    await win.keyboard.press('ControlOrMeta+Shift+P')
  await input.fill(title)
  await win.keyboard.press('Enter')
}

/** Commits files with git, as if made outside GitDom. */
export function commitFile(repo: string, path: string, text: string, message: string): void {
  writeFileSync(join(repo, path), text)
  git(repo, 'add', path)
  git(repo, 'commit', '-q', '-m', message)
}

/**
 * Drags `source` onto `target` by steps, as a hand would: the drag only starts once the pointer
 * has gone a few pixels. `y` is where in the target to drop, from its top (its middle by default).
 */
export async function drag(win: Page, source: string, target: string, y?: number): Promise<void> {
  const from = (await win.locator(source).first().boundingBox())!
  const to = (await win.locator(target).first().boundingBox())!
  await win.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await win.mouse.down()
  // Pressing selects the row: the drag starts after it has redrawn
  await win.waitForTimeout(150)
  await win.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8, { steps: 4 })
  await win.mouse.move(to.x + to.width / 2, to.y + (y ?? to.height / 2), { steps: 8 })
  await win.waitForTimeout(150)
  await win.mouse.up()
}

// A tiny PNG, the avatar fake services serve
export const AVATAR = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

/** Serves the bare repositories of `root` over HTTP, as git's own http-backend does. */
export function gitBackend(root: string, req: IncomingMessage, res: ServerResponse): void {
  const [path, query = ''] = (req.url ?? '').split('?')
  const child = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: path,
      QUERY_STRING: query,
      REQUEST_METHOD: req.method ?? 'GET',
      CONTENT_TYPE: String(req.headers['content-type'] ?? ''),
      HTTP_CONTENT_ENCODING: String(req.headers['content-encoding'] ?? ''),
      GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
      REMOTE_ADDR: '127.0.0.1'
    }
  })
  req.pipe(child.stdin)
  const out: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
  child.on('close', () => {
    const all = Buffer.concat(out)
    const end = all.indexOf('\r\n\r\n')
    const headers: Record<string, string> = {}
    let status = 200
    for (const line of all.subarray(0, end).toString().split('\r\n')) {
      const [key, ...value] = line.split(':')
      if (key.toLowerCase() === 'status') status = Number.parseInt(value.join(':'), 10)
      else headers[key] = value.join(':').trim()
    }
    res.writeHead(status, headers)
    res.end(all.subarray(end + 4))
  })
}
