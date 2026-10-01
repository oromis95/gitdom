// The native menu bar: File (repositories, preferences), Electron's standard Edit menu, View with the
// zoom and the recovery tools, Window with the themes, and Help. Commands go to the renderer,
// which owns the state.
import { BrowserWindow, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import {
  IPC,
  type MenuCommand,
  type MenuShortcuts,
  type ThemeChoice,
  type ThemeOption
} from '../shared/api'
import { REPO_URL } from './updates'

/** Themes listed in Window > Theme: the renderer owns them (built-in and custom) and sends them. */
let themes: ThemeOption[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'studio', label: 'Studio' },
  { id: 'system', label: 'Follow the system' }
]

/** Theme applied in the renderer, checked in Window > Theme; the renderer reports it at startup. */
let current: ThemeChoice | null = null

/** Keys shown in the menu: the renderer handles them, with the user's changes (UI-03). */
let keys: MenuShortcuts = {
  open: 'Ctrl+O',
  preferences: 'Ctrl+,',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0',
  activity: 'Ctrl+Shift+L'
}

const shown = (key: keyof MenuShortcuts): Partial<MenuItemConstructorOptions> =>
  keys[key] ? { accelerator: keys[key], registerAccelerator: false } : {}

const send = (command: MenuCommand) => (_item: unknown, win: unknown) =>
  (win as BrowserWindow | undefined)?.webContents.send(IPC.menuCommand, command)

function build(): void {
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'Open Repository…', ...shown('open'), click: send('open') },
      { label: 'Clone Repository…', click: send('clone') },
      { label: 'New Repository…', click: send('init') },
      { type: 'separator' },
      { label: 'Preferences…', ...shown('preferences'), click: send('preferences') },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { label: 'Zoom In', ...shown('zoomIn'), click: send('zoomIn') },
      { label: 'Zoom Out', ...shown('zoomOut'), click: send('zoomOut') },
      { label: 'Actual Size', ...shown('zoomReset'), click: send('zoomReset') },
      { type: 'separator' },
      { label: 'Activity Log', ...shown('activity'), click: send('activity') },
      { label: 'Reflog', click: send('reflog') },
      { label: 'Backups', click: send('backups') },
      { label: 'Statistics', click: send('statistics') },
      { label: 'Ignored Files', click: send('ignored') },
      { label: 'Clean Up Untracked Files…', click: send('clean') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'reload' },
      { role: 'toggleDevTools' }
    ]
  }
  const window: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      {
        label: 'Theme',
        submenu: themes.map(({ id, label }) => ({
          label,
          type: 'radio',
          checked: id === current,
          click: (_item, win) =>
            (win as BrowserWindow | undefined)?.webContents.send(IPC.menuTheme, id)
        }))
      },
      { type: 'separator' },
      { role: 'minimize' },
      { role: 'close' }
    ]
  }
  const help: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      { label: 'Tips', click: send('tips') },
      { label: "What's New", click: send('whatsNew') },
      { label: 'Check for Updates…', click: send('checkUpdates') },
      { type: 'separator' },
      { label: 'GitDom on GitHub', click: () => void shell.openExternal(REPO_URL) }
    ]
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([file, { role: 'editMenu' }, view, window, help]))
}

export function registerMenu(): void {
  build()
  ipcMain.on(IPC.menuSetTheme, (_event, theme: ThemeChoice, list: ThemeOption[]) => {
    if (typeof theme !== 'string' || !Array.isArray(list)) return
    const next = list
      .filter((t) => typeof t?.id === 'string' && typeof t.label === 'string')
      .map(({ id, label }) => ({ id, label }))
    if (theme === current && JSON.stringify(next) === JSON.stringify(themes)) return
    current = theme
    themes = next
    build()
  })
  ipcMain.on(IPC.menuSetShortcuts, (_event, next: MenuShortcuts) => {
    if (!next || typeof next !== 'object') return
    const clean = { ...keys }
    for (const key of Object.keys(keys) as (keyof MenuShortcuts)[]) {
      const value = next[key]
      clean[key] = typeof value === 'string' && value.length < 40 ? value : null
    }
    if (JSON.stringify(clean) === JSON.stringify(keys)) return
    keys = clean
    try {
      build()
    } catch {
      // A key Electron can't show: the menu goes without the keys, which still work
      keys = {
        open: null,
        preferences: null,
        zoomIn: null,
        zoomOut: null,
        zoomReset: null,
        activity: null
      }
      build()
    }
  })
}
