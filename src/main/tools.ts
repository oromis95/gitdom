// External programs: the editor (DIFF-12), the file manager, and checks on the git executable (SET-04).
import { execFile, spawn } from 'child_process'
import { relative, resolve } from 'path'
import { ipcMain, shell } from 'electron'
import { IPC, type MergeToolInfo, type Result, type ToolSettings } from '../shared/api'
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

function execText(file: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((done, fail) =>
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) =>
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
