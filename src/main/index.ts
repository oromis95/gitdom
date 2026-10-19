import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerAskpass } from './askpassDialog'
import { registerIpcHandlers } from './ipc'
import { registerMenu } from './menu'
import { registerSettings } from './settingsIpc'
import { adoptShellEnv } from './shellEnv'
import { closeAllTerminals } from './terminal'
import { registerUpdateLifecycle } from './updates'

// Development runs keep their own tabs, recent repositories and settings: on Windows
// %APPDATA%\gitdom is otherwise the same folder as the packaged GitDom's %APPDATA%\GitDom
if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')}-dev`)
// The end-to-end tests start each run with empty settings, in a folder of their own
if (process.env.GITDOM_USER_DATA) app.setPath('userData', process.env.GITDOM_USER_DATA)

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    title: 'GitDom',
    backgroundColor: '#1b1d23',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // The window only ever shows GitDom: a link or a dropped file must not replace it
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.gitdom.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Before any git command: on macOS and Linux git may only be on the login shell's PATH
  await adoptShellEnv()
  registerSettings()
  registerIpcHandlers()
  registerAskpass()
  registerUpdateLifecycle()
  registerMenu()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', closeAllTerminals)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
