import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ActivityEntry,
  type ChangeScope,
  type CloneProgress,
  type GitDomApi,
  type MenuCommand,
  type OpProgress,
  type ThemeChoice,
  type UpdateProgress
} from '../shared/api'
import type { AskpassRequest } from '../shared/askpass'
import type { StoredSettings } from '../shared/storedSettings'
import type { StatisticsProgress } from '../shared/types'

// Once, before the renderer's modules read their settings
const stored = ipcRenderer.sendSync(IPC.settingsLoad) as StoredSettings
const settings = new Map(Object.entries(stored.values))

const api: GitDomApi = {
  platform: process.platform,
  pickRepository: () => ipcRenderer.invoke(IPC.pickRepository),
  openRepository: (path, filter, limit) =>
    ipcRenderer.invoke(IPC.openRepository, path, filter, limit),
  op: (repoPath, name, ...args) => ipcRenderer.invoke(IPC.op, repoPath, name, args),
  watch: (repoPaths) => ipcRenderer.send(IPC.watch, repoPaths),
  onRepoChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, repoPath: string, scope: ChangeScope): void =>
      listener(repoPath, scope)
    ipcRenderer.on(IPC.changed, handler)
    return () => ipcRenderer.removeListener(IPC.changed, handler)
  },
  onOpProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, repoPath: string, progress: OpProgress): void =>
      listener(repoPath, progress)
    ipcRenderer.on(IPC.opProgress, handler)
    return () => ipcRenderer.removeListener(IPC.opProgress, handler)
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
  tools: {
    configure: (settings) => ipcRenderer.send(IPC.toolsConfigure, settings),
    checkGit: (gitPath) => ipcRenderer.invoke(IPC.toolsCheckGit, gitPath),
    mergeTools: () => ipcRenderer.invoke(IPC.toolsMergeTools),
    openInEditor: (repo, path) => ipcRenderer.invoke(IPC.toolsOpenInEditor, repo, path),
    showInFolder: (repo, path) => ipcRenderer.send(IPC.toolsShowInFolder, repo, path),
    pickSavePath: (title, name) => ipcRenderer.invoke(IPC.toolsPickSavePath, title, name),
    pickPatchFile: () => ipcRenderer.invoke(IPC.toolsPickPatchFile),
    pathForFile: (file) => webUtils.getPathForFile(file),
    setZoom: (factor) => webFrame.setZoomFactor(factor),
    configList: (scope, repo) => ipcRenderer.invoke(IPC.toolsConfigList, scope, repo),
    configSet: (scope, repo, key, value, old) =>
      ipcRenderer.invoke(IPC.toolsConfigSet, scope, repo, key, value, old),
    configUnset: (scope, repo, key, value) =>
      ipcRenderer.invoke(IPC.toolsConfigUnset, scope, repo, key, value)
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
    setTheme: (theme, themes) => ipcRenderer.send(IPC.menuSetTheme, theme, themes),
    setShortcuts: (shortcuts) => ipcRenderer.send(IPC.menuSetShortcuts, shortcuts),
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
  },
  activity: {
    list: () => ipcRenderer.invoke(IPC.activityList),
    clear: () => ipcRenderer.send(IPC.activityClear),
    onEntry: (listener) => {
      const handler = (_event: IpcRendererEvent, entry: ActivityEntry): void => listener(entry)
      ipcRenderer.on(IPC.activityEntry, handler)
      return () => ipcRenderer.removeListener(IPC.activityEntry, handler)
    }
  },
  app: {
    latestRelease: () => ipcRenderer.invoke(IPC.appLatestRelease),
    openRepoPage: (url) => ipcRenderer.send(IPC.appOpenRepoPage, url),
    canSelfUpdate: () => ipcRenderer.invoke(IPC.appCanSelfUpdate),
    downloadUpdate: () => ipcRenderer.invoke(IPC.appDownloadUpdate),
    cancelUpdate: () => ipcRenderer.send(IPC.appCancelUpdate),
    onUpdateProgress: (listener) => {
      const handler = (_event: IpcRendererEvent, progress: UpdateProgress): void =>
        listener(progress)
      ipcRenderer.on(IPC.appUpdateProgress, handler)
      return () => ipcRenderer.removeListener(IPC.appUpdateProgress, handler)
    },
    installUpdate: () => ipcRenderer.invoke(IPC.appInstallUpdate)
  },
  statistics: {
    load: (repo, options) => ipcRenderer.invoke(IPC.statsLoad, repo, options),
    cancel: (repo) => ipcRenderer.send(IPC.statsCancel, repo),
    onProgress: (listener) => {
      const handler = (_event: IpcRendererEvent, progress: StatisticsProgress): void =>
        listener(progress)
      ipcRenderer.on(IPC.statsProgress, handler)
      return () => ipcRenderer.removeListener(IPC.statsProgress, handler)
    }
  },
  askpass: {
    onRequest: (listener) => {
      const handler = (_event: IpcRendererEvent, request: AskpassRequest): void => listener(request)
      ipcRenderer.on(IPC.askpassRequest, handler)
      return () => ipcRenderer.removeListener(IPC.askpassRequest, handler)
    },
    reply: (id, answer) => ipcRenderer.send(IPC.askpassReply, id, answer)
  },
  storage: {
    existed: stored.exists,
    getItem: (key) => settings.get(key) ?? null,
    setItem: (key, value) => {
      const text = String(value)
      if (settings.get(key) === text) return
      settings.set(key, text)
      ipcRenderer.send(IPC.settingsSet, key, text)
    },
    removeItem: (key) => {
      if (!settings.delete(key)) return
      ipcRenderer.send(IPC.settingsRemove, key)
    },
    exportFile: () => ipcRenderer.invoke(IPC.settingsExport),
    importFile: () => ipcRenderer.invoke(IPC.settingsImport)
  },
  forge: {
    configure: (hosts) => ipcRenderer.send(IPC.forgeConfigure, hosts),
    status: (repo, remotes) => ipcRenderer.invoke(IPC.forgeStatus, repo, remotes),
    detail: (repo, number) => ipcRenderer.invoke(IPC.forgeDetail, repo, number),
    fetchPull: (repo, number) => ipcRenderer.invoke(IPC.forgeFetchPull, repo, number),
    accounts: () => ipcRenderer.invoke(IPC.forgeAccounts),
    connectWithGit: (host, kind, path) => ipcRenderer.invoke(IPC.forgeConnectGit, host, kind, path),
    connectWithToken: (host, kind, token, username, path) =>
      ipcRenderer.invoke(IPC.forgeConnectToken, host, kind, token, username, path),
    startLogin: (host, kind) => ipcRenderer.invoke(IPC.forgeStartLogin, host, kind),
    finishLogin: (id) => ipcRenderer.invoke(IPC.forgeFinishLogin, id),
    cancelLogin: (id) => ipcRenderer.send(IPC.forgeCancelLogin, id),
    disconnect: (host) => ipcRenderer.invoke(IPC.forgeDisconnect, host),
    canSaveTokens: () => ipcRenderer.invoke(IPC.forgeCanSave),
    avatar: (url) => ipcRenderer.invoke(IPC.forgeAvatar, url),
    openUrl: (url) => ipcRenderer.send(IPC.forgeOpenUrl, url),
    tokenPage: (host, kind, path) => ipcRenderer.invoke(IPC.forgeTokenPage, host, kind, path)
  }
}

contextBridge.exposeInMainWorld('api', api)
