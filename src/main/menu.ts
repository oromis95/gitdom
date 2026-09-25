// The native menu bar: File (repositories, preferences), Electron's standard Edit menu, View with the
// zoom, and Window with the themes. Commands go to the renderer, which owns the state.
import { BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand, type ThemeChoice } from '../shared/api'

const THEMES: { theme: ThemeChoice; label: string }[] = [
  { theme: 'dark', label: 'Dark' },
  { theme: 'light', label: 'Light' },
  { theme: 'studio', label: 'Studio' },
  { theme: 'system', label: 'Follow the system' }
]

/** Theme applied in the renderer, checked in Window > Theme; the renderer reports it at startup. */
let current: ThemeChoice | null = null

const send = (command: MenuCommand) => (_item: unknown, win: unknown) =>
  (win as BrowserWindow | undefined)?.webContents.send(IPC.menuCommand, command)

function build(): void {
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Clone Repository…', click: send('clone') },
      { label: 'New Repository…', click: send('init') },
      { type: 'separator' },
      { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: send('preferences') },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoomIn') },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoomOut') },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: send('zoomReset') },
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
        submenu: THEMES.map(({ theme, label }) => ({
          label,
          type: 'radio',
          checked: theme === current,
          click: (_item, win) =>
            (win as BrowserWindow | undefined)?.webContents.send(IPC.menuTheme, theme)
        }))
      },
      { type: 'separator' },
      { role: 'minimize' },
      { role: 'close' }
    ]
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([file, { role: 'editMenu' }, view, window]))
}

export function registerMenu(): void {
  build()
  ipcMain.on(IPC.menuSetTheme, (_event, theme: ThemeChoice) => {
    if (theme === current || !THEMES.some((t) => t.theme === theme)) return
    current = theme
    build()
  })
}
