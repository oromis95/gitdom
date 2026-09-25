import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ChangeScope, type GitDomApi, type ThemeChoice } from '../shared/api'

const api: GitDomApi = {
  pickRepository: () => ipcRenderer.invoke(IPC.pickRepository),
  openRepository: (path) => ipcRenderer.invoke(IPC.openRepository, path),
  op: (repoPath, name, ...args) => ipcRenderer.invoke(IPC.op, repoPath, name, args),
  watch: (repoPaths) => ipcRenderer.send(IPC.watch, repoPaths),
  onRepoChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, repoPath: string, scope: ChangeScope): void =>
      listener(repoPath, scope)
    ipcRenderer.on(IPC.changed, handler)
    return () => ipcRenderer.removeListener(IPC.changed, handler)
  },
  terminal: {
    shells: () => ipcRenderer.invoke(IPC.terminalShells),
    open: (cwd, shell, cols, rows) => ipcRenderer.invoke(IPC.terminalOpen, cwd, shell, cols, rows),
    write: (id, data) => ipcRenderer.send(IPC.terminalWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.terminalResize, id, cols, rows),
    close: (id) => ipcRenderer.send(IPC.terminalClose, id),
    onData: (listener) => {
      const handler = (_event: IpcRendererEvent, id: number, data: string): void =>
        listener(id, data)
      ipcRenderer.on(IPC.terminalData, handler)
      return () => ipcRenderer.removeListener(IPC.terminalData, handler)
    },
    onExit: (listener) => {
      const handler = (_event: IpcRendererEvent, id: number, exitCode: number): void =>
        listener(id, exitCode)
      ipcRenderer.on(IPC.terminalExit, handler)
      return () => ipcRenderer.removeListener(IPC.terminalExit, handler)
    }
  },
  menu: {
    setTheme: (theme) => ipcRenderer.send(IPC.menuSetTheme, theme),
    onTheme: (listener) => {
      const handler = (_event: IpcRendererEvent, theme: ThemeChoice): void => listener(theme)
      ipcRenderer.on(IPC.menuTheme, handler)
      return () => ipcRenderer.removeListener(IPC.menuTheme, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
