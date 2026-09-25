import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ChangeScope,
  type CloneProgress,
  type GitDomApi,
  type MenuCommand,
  type ThemeChoice
} from '../shared/api'

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
  repos: {
    pickFolder: (title) => ipcRenderer.invoke(IPC.pickFolder, title),
    clone: (id, options) => ipcRenderer.invoke(IPC.clone, id, options),
    cancelClone: (id) => ipcRenderer.send(IPC.cloneCancel, id),
    onCloneProgress: (listener) => {
      const handler = (_event: IpcRendererEvent, id: number, progress: CloneProgress): void =>
        listener(id, progress)
      ipcRenderer.on(IPC.cloneProgress, handler)
      return () => ipcRenderer.removeListener(IPC.cloneProgress, handler)
    },
    init: (options) => ipcRenderer.invoke(IPC.init, options)
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
    },
    onCommand: (listener) => {
      const handler = (_event: IpcRendererEvent, command: MenuCommand): void => listener(command)
      ipcRenderer.on(IPC.menuCommand, handler)
      return () => ipcRenderer.removeListener(IPC.menuCommand, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
