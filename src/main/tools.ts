// External programs: the editor (DIFF-12), the file manager, and checks on the git executable (SET-04).
import { execFile, spawn } from 'child_process'
import { homedir } from 'os'
import { basename, relative, resolve } from 'path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  IPC,
  type ConfigEntry,
  type ConfigScope,
  type MergeToolInfo,
  type Result,
  type ToolSettings
} from '../shared/api'
import { parseMergeTools } from './git/parsers'
import { gitBinary, setToolSettings, toolSettings } from './settings'

/** Absolute path of a file of the repository, refusing paths that leave it. */
function repoPath(repo: string, path: string | null): string {
  const root = resolve(repo)
  if (path === null) return root
  const full = resolve(root, path)
  const rel = relative(root, full)
  if (rel.startsWith('..') || resolve(rel) === rel)
    throw new Error(`Path outside the repository: ${path}`)
  return full
}

function execText(file: string, args: string[], timeout = 15000, cwd?: string): Promise<string> {
  return new Promise((done, fail) =>
    execFile(file, args, { windowsHide: true, timeout, cwd }, (error, stdout, stderr) =>
      error ? fail(new Error(stderr.trim() || error.message)) : done(stdout)
    )
  )
}

/**
 * Starts the editor on `target`, detached so it outlives GitDom.
 * The command runs in a shell, so it may be a PATH command (`code`) or a quoted path with options;
 * a command that fails right away (not found) is reported, a running editor is left alone.
 */
function launchEditor(command: string, target: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(`${command} "${target}"`, {
      shell: true,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    const timer = setTimeout(() => {
      child.stderr.destroy()
      child.unref()
      done()
    }, 1500)
    child.on('error', (e) => {
      clearTimeout(timer)
      fail(e)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0 || code === null) done()
      else fail(new Error(stderr.trim() || `The editor command exited with code ${code}`))
    })
  })
}

// `git mergetool --tool-help` tries every tool through shell scripts, which can take more than a
// minute on Windows: asked once per git executable, and the answer kept
let mergeToolsProbe: { git: string; tools: Promise<MergeToolInfo[]> } | null = null

function mergeTools(): Promise<MergeToolInfo[]> {
  const git = gitBinary()
  if (mergeToolsProbe?.git !== git) {
    const probe = {
      git,
      tools: execText(git, ['mergetool', '--tool-help'], 300000).then(parseMergeTools, () => {
        // Failed or timed out: ask again next time
        if (mergeToolsProbe === probe) mergeToolsProbe = null
        return []
      })
    }
    mergeToolsProbe = probe
  }
  return mergeToolsProbe.tools
}

/** Runs `git config` on one scope; the local one needs a repository, the global one does not. */
function gitConfig(scope: ConfigScope, repo: string | null, args: string[]): Promise<string> {
  if (scope !== 'global' && scope !== 'local') throw new Error(`Invalid scope: ${String(scope)}`)
  if (scope === 'local' && !repo) throw new Error('Open a repository to edit its configuration')
  return execText(gitBinary(), ['config', `--${scope}`, ...args], 15000, repo ?? homedir())
}

/** section[.subsection].name: the subsection may hold anything but a line break. */
function assertConfigKey(key: string): void {
  if (typeof key !== 'string' || !/^[A-Za-z0-9-]+(\.[^\0\n]+)?\.[A-Za-z][A-Za-z0-9-]*$/.test(key)) {
    throw new Error(`Invalid configuration key: ${key}`)
  }
}

function assertConfigValue(value: string): void {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid value')
}

/** Output of `git config --list --null`: "key\nvalue" records ended by NUL. */
export function parseConfigList(out: string): ConfigEntry[] {
  return out
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const at = record.indexOf('\n')
      return at < 0
        ? { key: record, value: '' }
        : { key: record.slice(0, at), value: record.slice(at + 1) }
    })
}

async function toResult<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerToolHandlers(): void {
  ipcMain.on(IPC.toolsConfigure, (_event, settings: ToolSettings) => setToolSettings(settings))

  ipcMain.handle(IPC.toolsCheckGit, (_event, gitPath: string) =>
    toResult(async () => (await execText(gitPath.trim() || 'git', ['--version'])).trim())
  )

  ipcMain.handle(IPC.toolsMergeTools, () => mergeTools())

  ipcMain.handle(IPC.toolsOpenInEditor, (_event, repo: string, path: string | null) =>
    toResult(async () => {
      const target = repoPath(repo, path)
      const editor = toolSettings().editor
      if (editor) return launchEditor(editor, target)
      const error = await shell.openPath(target)
      if (error) throw new Error(error)
    })
  )

  ipcMain.handle(IPC.toolsConfigList, (_event, scope: ConfigScope, repo: string | null) =>
    toResult(async () => {
      try {
        return parseConfigList(await gitConfig(scope, repo, ['--list', '--null']))
      } catch (e) {
        // No ~/.gitconfig yet: an empty configuration, the first change creates the file
        if (scope === 'global') return []
        throw e
      }
    })
  )

  ipcMain.handle(
    IPC.toolsConfigSet,
    (
      _event,
      scope: ConfigScope,
      repo: string | null,
      key: string,
      value: string,
      old: string | null
    ) =>
      toResult(async () => {
        assertConfigKey(key)
        assertConfigValue(value)
        if (old !== null) assertConfigValue(old)
        // --end-of-options: a value may start with a dash; --fixed-value: `old` is not a regex
        await gitConfig(
          scope,
          repo,
          old === null
            ? ['--add', '--end-of-options', key, value]
            : ['--fixed-value', '--replace-all', '--end-of-options', key, value, old]
        )
      })
  )

  ipcMain.handle(
    IPC.toolsConfigUnset,
    (_event, scope: ConfigScope, repo: string | null, key: string, value: string) =>
      toResult(async () => {
        assertConfigKey(key)
        assertConfigValue(value)
        await gitConfig(scope, repo, [
          '--fixed-value',
          '--unset-all',
          '--end-of-options',
          key,
          value
        ])
      })
  )

  ipcMain.handle(IPC.toolsPickSavePath, async (event, title: string, name: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = { title, defaultPath: basename(String(name)) }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  })

  ipcMain.on(IPC.toolsShowInFolder, (_event, repo: string, path: string | null) => {
    try {
      const target = repoPath(repo, path)
      if (path === null) void shell.openPath(target)
      else shell.showItemInFolder(target)
    } catch {
      // A path outside the repository: nothing to show
    }
  })
}
