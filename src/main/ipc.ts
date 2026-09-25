import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  IPC,
  type CloneOptions,
  type InitOptions,
  type OpArgs,
  type OpName,
  type Result
} from '../shared/api'
import { activityEntries, clearActivity, inAction, onActivity, redact } from './git/activity'
import { cancelClone, cloneRepository, initRepository } from './git/clone'
import { GitError } from './git/exec'
import { runOp } from './git/operations'
import type { GraphFilter } from '../shared/types'
import { loadSnapshot, resolveRepoRoot } from './git/repository'
import { setWatchedRepos } from './watcher'
import { registerTerminalHandlers } from './terminal'
import { registerToolHandlers } from './tools'
import { isRepoUrl, latestRelease } from './updates'

async function toResult<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    const details = e instanceof GitError && e.stderr.trim() ? e.stderr.trim() : undefined
    return { ok: false, error, details }
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.pickRepository, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Open repository',
      properties: ['openDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.pickFolder, async (event, title: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.clone, (event, id: number, options: CloneOptions) =>
    toResult(() =>
      inAction(`Clone ${redact(String(options.url))}`, () =>
        cloneRepository(id, options, (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.cloneProgress, id, progress)
        })
      )
    )
  )

  ipcMain.on(IPC.cloneCancel, (_event, id: number) => cancelClone(id))

  ipcMain.handle(IPC.init, (_event, options: InitOptions) =>
    toResult(() => inAction('New repository', () => initRepository(options)))
  )

  ipcMain.handle(IPC.openRepository, (_event, path: string, filter?: GraphFilter) =>
    toResult(async () => loadSnapshot(await resolveRepoRoot(path), filter))
  )

  ipcMain.handle(IPC.op, (_event, repoPath: string, name: OpName, args: OpArgs<OpName>) =>
    toResult(() => runOp(repoPath, name, args))
  )

  ipcMain.on(IPC.watch, (event, repoPaths: string[]) => {
    const sender = event.sender
    setWatchedRepos(repoPaths, (repoPath, scope) => {
      if (!sender.isDestroyed()) sender.send(IPC.changed, repoPath, scope)
    })
  })

  ipcMain.handle(IPC.activityList, () => activityEntries())
  ipcMain.on(IPC.activityClear, () => clearActivity())
  onActivity((entry) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send(IPC.activityEntry, entry)
    }
  })

  ipcMain.handle(IPC.appLatestRelease, () => toResult(latestRelease))
  ipcMain.on(IPC.appOpenRepoPage, (_event, url: unknown) => {
    if (isRepoUrl(url)) void shell.openExternal(url)
  })

  registerTerminalHandlers()
  registerToolHandlers()
}
