import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC, type Result } from '../shared/api'
import { parseStoredValues } from '../shared/storedSettings'
import { SettingsFile } from './settingsFile'

let file: SettingsFile | null = null

/** Reads settings.json and answers the renderer; call once userData is final. */
export function registerSettings(): void {
  file = new SettingsFile(join(app.getPath('userData'), 'settings.json'))
  file.load()
  const settings = file
  // Synchronous: the renderer reads its settings while its modules load, before the first paint
  ipcMain.on(IPC.settingsLoad, (event) => {
    event.returnValue = settings.snapshot()
  })
  ipcMain.on(IPC.settingsSet, (_event, key: unknown, value: unknown) => {
    if (typeof key === 'string' && typeof value === 'string') settings.set(key, value)
  })
  ipcMain.on(IPC.settingsRemove, (_event, key: unknown) => {
    if (typeof key === 'string') settings.remove(key)
  })
  ipcMain.handle(IPC.settingsExport, (event) => exportSettings(event.sender, settings))
  ipcMain.handle(IPC.settingsImport, (event) => importSettings(event.sender, settings))
  app.on('before-quit', () => settings.flushPending())
}

const DIALOG_FILTERS = [{ name: 'GitDom settings', extensions: ['json'] }]

async function exportSettings(
  sender: Electron.WebContents,
  settings: SettingsFile
): Promise<Result<string | null>> {
  const window = BrowserWindow.fromWebContents(sender)
  const options: Electron.SaveDialogOptions = {
    title: 'Export settings',
    defaultPath: 'gitdom-settings.json',
    filters: DIALOG_FILTERS
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: true, value: null }
  try {
    await writeFile(result.filePath, `${JSON.stringify(settings.snapshot().values, null, 2)}\n`)
    return { ok: true, value: result.filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Replaces every setting with those of a chosen file, and reloads the window to use them. */
async function importSettings(
  sender: Electron.WebContents,
  settings: SettingsFile
): Promise<Result<string | null>> {
  const window = BrowserWindow.fromWebContents(sender)
  const options: Electron.OpenDialogOptions = {
    title: 'Import settings',
    properties: ['openFile'],
    filters: DIALOG_FILTERS
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  const path = result.canceled ? undefined : result.filePaths[0]
  if (!path) return { ok: true, value: null }
  try {
    const values = parseStoredValues(await readFile(path, 'utf8'))
    if (!values) return { ok: false, error: "This file doesn't hold GitDom settings" }
    settings.replace(values)
    // From here: the window blocks the navigations it starts itself (main/index.ts)
    setImmediate(() => sender.reload())
    return { ok: true, value: path }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
