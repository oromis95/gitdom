import { useEffect, useState } from 'react'
import {
  Download,
  FolderOpen,
  FolderPlus,
  LayoutDashboard,
  ScrollText,
  Star,
  TriangleAlert,
  User,
  X
} from 'lucide-react'
import type { RepoSnapshot } from '../../shared/types'
import TabBar from './components/TabBar'
import Toolbar from './components/Toolbar'
import Workspace from './components/Workspace'
import BisectBar from './components/BisectBar'
import MatrixRain from './components/MatrixRain'
import Overlays from './components/Overlays'
import { HoverLayer } from './components/HoverCards'
import TerminalDock from './components/TerminalDock'
import ActivityDock from './components/ActivityDock'
import Updates from './components/Updates'
import Tips from './components/Tips'
import Splash, { HighwayLogo } from './components/Splash'
import { restoreSession, useActiveTab, useApp } from './store'
import {
  fetchAll,
  showBranchOverview,
  showCleanUp,
  showIgnoredFiles,
  openPatch,
  showHooks,
  showRepoHealth
} from './actions'
import { identityMenu } from './identity'
import { openMenu, openPreferences, openRepoDialog, useUi } from './ui'
import { stepZoom, useSettings } from './settings'
import { splashEnabled, toggleSidebarDrawer, useTheme } from './theme'
import { startActivityLog, toggleActivity, useActivity } from './activity'
import { checkForUpdates, showWhatsNew, startupChecks } from './updates'
import { showTip, startupTip } from './tips'
import { useShortcut, useShortcutLabel } from './shortcuts'
import { focusPanel, type Panel } from './focus'

function IdentityButton({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const { name, email, scope } = snapshot.identity
  const set = name && email
  return (
    <button
      className={`status-identity${set ? '' : ' missing'}`}
      title={
        set
          ? `Committing as ${name} <${email}>, from the ${scope} configuration`
          : 'No author identity: commits will fail until you set one'
      }
      onClick={(e) => openMenu(e, identityMenu(snapshot))}
    >
      {set ? <User size={13} /> : <TriangleAlert size={13} />}
      {set ? (
        <>
          {name} <span className="muted">&lt;{email}&gt;</span>
          {scope === 'local' && <span className="identity-scope">this repo</span>}
        </>
      ) : (
        'Set your identity'
      )}
    </button>
  )
}

function RecentItem({ path }: { path: string }): React.JSX.Element {
  const { favorites, openRepo, toggleFavorite, forgetRepo } = useApp()
  const favorite = favorites.includes(path)
  return (
    <div className="recent-item">
      <button className="recent-open" onClick={() => void openRepo(path)}>
        <span>{path.split(/[\\/]/).pop()}</span>
        <span className="muted">{path}</span>
      </button>
      <button
        className={`recent-action${favorite ? ' favorite' : ''}`}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => toggleFavorite(path)}
      >
        <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
      </button>
      <button
        className="recent-action"
        title="Remove from the list (the folder isn't touched)"
        onClick={() => forgetRepo(path)}
      >
        <X size={15} />
      </button>
    </div>
  )
}

function Welcome(): React.JSX.Element {
  const { recent, favorites, pickAndOpen } = useApp()
  const others = recent.filter((p) => !favorites.includes(p))
  const matrix = useTheme((s) => s.base === 'matrix')
  return (
    <div className="welcome">
      {matrix && <MatrixRain />}
      <HighwayLogo size={220} />
      <h1>GitDom</h1>
      <div className="welcome-actions">
        <button className="primary" onClick={() => void pickAndOpen()}>
          <FolderOpen size={18} /> Open
        </button>
        <button className="primary" onClick={() => openRepoDialog('clone')}>
          <Download size={18} /> Clone
        </button>
        <button className="primary" onClick={() => openRepoDialog('init')}>
          <FolderPlus size={18} /> New
        </button>
        {recent.length + favorites.length > 1 && (
          <button
            className="primary"
            title="All your repositories in one look, and fetch them all"
            onClick={() => useUi.setState({ dashboard: true })}
          >
            <LayoutDashboard size={18} /> Dashboard
          </button>
        )}
      </div>
      {(favorites.length > 0 || others.length > 0) && (
        <div className="recent">
          {favorites.length > 0 && <div className="recent-heading muted">Favorites</div>}
          {favorites.map((path) => (
            <RecentItem key={path} path={path} />
          ))}
          {others.length > 0 && <div className="recent-heading muted">Recent</div>}
          {others.map((path) => (
            <RecentItem key={path} path={path} />
          ))}
        </div>
      )}
    </div>
  )
}

function App(): React.JSX.Element {
  const tab = useActiveTab()
  const refresh = useApp((s) => s.refresh)
  const layout = useTheme((s) => s.layout)
  const [splash, setSplash] = useState(splashEnabled)

  useEffect(() => restoreSession(), [])

  useEffect(() => {
    startActivityLog()
    startupChecks()
  }, [])

  useEffect(() => {
    if (!splash) startupTip()
  }, [splash])

  useEffect(
    () =>
      window.api.menu.onCommand((command) => {
        if (command === 'open') void useApp.getState().pickAndOpen()
        else if (command === 'clone' || command === 'init') openRepoDialog(command)
        else if (command === 'preferences') openPreferences()
        else if (command === 'activity') toggleActivity()
        else if (command === 'reflog' || command === 'backups') {
          useApp.getState().openRecovery(command)
        } else if (command === 'statistics') useApp.getState().openStatistics(true)
        else if (command === 'ignored') {
          const repo = useApp.getState().tabs[useApp.getState().active]?.path
          if (repo) showIgnoredFiles(repo, '')
        } else if (command === 'clean') {
          const repo = useApp.getState().tabs[useApp.getState().active]?.path
          if (repo) showCleanUp(repo)
        } else if (command === 'branches') {
          const repo = useApp.getState().tabs[useApp.getState().active]?.path
          if (repo) showBranchOverview(repo)
        } else if (command === 'health') {
          const repo = useApp.getState().tabs[useApp.getState().active]?.path
          if (repo) showRepoHealth(repo)
        } else if (command === 'dashboard') useUi.setState({ dashboard: true })
        else if (command === 'applyPatch') {
          const repo = useApp.getState().tabs[useApp.getState().active]?.path
          if (repo) void openPatch(repo)
        } else if (command === 'hooks') {
          const repo = useApp.getState().tabs[useApp.getState().active]?.path
          if (repo) showHooks(repo)
        } else if (command === 'whatsNew') showWhatsNew()
        else if (command === 'tips') showTip()
        else if (command === 'checkUpdates') void checkForUpdates(true)
        else stepZoom(command === 'zoomIn' ? 1 : command === 'zoomOut' ? -1 : 0)
      }),
    []
  )

  // Watch the open repositories so changes made elsewhere (terminal, IDE) show up by themselves
  // Joined into a string so the selector result is stable; '|' cannot appear in Windows paths
  const openPaths = useApp((s) => s.tabs.map((t) => t.path).join('|'))
  useEffect(() => window.api.watch(openPaths ? openPaths.split('|') : []), [openPaths])

  useEffect(
    () =>
      window.api.onRepoChanged((path, scope) => {
        const { refreshPath, refreshStatus } = useApp.getState()
        void (scope === 'git' ? refreshPath(path) : refreshStatus(path))
      }),
    []
  )

  // Keep remote branches current with a periodic background fetch
  const autoFetchMinutes = useSettings((s) => s.autoFetchMinutes)
  useEffect(() => {
    if (autoFetchMinutes <= 0) return
    const timer = setInterval(
      () => {
        for (const t of useApp.getState().tabs) {
          if (t.snapshot?.remotes.length && !t.busy) void fetchAll(t.path, true)
        }
      },
      autoFetchMinutes * 60 * 1000
    )
    return () => clearInterval(timer)
  }, [autoFetchMinutes])

  // The menu's keys: it only shows them, so that the user's own keys work too
  useShortcut('openRepo', () => void useApp.getState().pickAndOpen())
  useShortcut('preferences', () => openPreferences())
  useShortcut('zoomIn', () => stepZoom(1))
  useShortcut('zoomOut', () => stepZoom(-1))
  useShortcut('zoomReset', () => stepZoom(0))
  // Moving between the panels (NFR-09), not from behind a dialog
  const focusKey = (panel: Panel) => (): boolean => {
    if (document.querySelector('.modal, .palette')) return false
    const { layout, detailClosedFor } = useTheme.getState()
    if (layout !== 'focus' || panel === 'graph') return focusPanel(panel)
    // Focus: the drawer opens first, and takes the focus once shown
    if (panel === 'sidebar') toggleSidebarDrawer(true)
    else if (detailClosedFor) useTheme.setState({ detailClosedFor: null })
    setTimeout(() => focusPanel(panel), 50)
    return true
  }
  useShortcut('focusSidebar', focusKey('sidebar'))
  useShortcut('focusGraph', focusKey('graph'))
  useShortcut('focusDetail', focusKey('detail'))
  const activityKey = useShortcutLabel('activity')
  const zoomResetKey = useShortcutLabel('zoomReset')

  // Ctrl+wheel zooms too
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      stepZoom(e.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])
  const zoom = useSettings((s) => s.zoom)
  const activityShown = useActivity((s) => s.shown)

  // A patch file dropped on the window: shown, to apply it to the open repository
  useEffect(() => {
    const patchFile = (e: DragEvent): File | undefined =>
      [...(e.dataTransfer?.files ?? [])].find((f) => /\.(patch|diff|mbox|eml)$/i.test(f.name))
    const onOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent): void => {
      const file = patchFile(e)
      const repo = useApp.getState().tabs[useApp.getState().active]?.path
      if (!file || !repo) return
      e.preventDefault()
      void openPatch(repo, window.api.tools.pathForFile(file))
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // Pick up changes made outside the app (terminal, IDE) when the window regains focus
  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const snapshot = tab?.snapshot

  return (
    <div className={`app${layout === 'classic' ? '' : ` ${layout}`}`}>
      <TabBar />
      {!tab ? (
        <Welcome />
      ) : (
        <>
          <Toolbar tab={tab} />
          {tab.error && <div className="banner-error">{tab.error}</div>}
          {snapshot && <BisectBar snapshot={snapshot} busy={!!tab.busy} />}
          {snapshot ? (
            <Workspace key={tab.path} tab={tab} snapshot={snapshot} />
          ) : (
            <div className="center-message">{tab.loading ? 'Loading repository…' : ''}</div>
          )}
        </>
      )}
      <div className="dock-area">
        <TerminalDock />
        <ActivityDock />
      </div>
      <div className="statusbar">
        {snapshot && (
          <>
            <span>{snapshot.path}</span>
            <span>
              {snapshot.commits.length.toLocaleString('en-US')} commits
              {snapshot.truncated ? ', older ones load as you scroll' : ''}
            </span>
          </>
        )}
        {tab?.busy && <span className="status-busy">{tab.busy}…</span>}
        <span style={{ marginLeft: 'auto' }} />
        {snapshot && <IdentityButton snapshot={snapshot} />}
        <button
          className={`status-activity${activityShown ? ' active' : ''}`}
          title={`Activity log: the git commands GitDom runs${activityKey ? ` (${activityKey})` : ''}`}
          onClick={() => toggleActivity()}
        >
          <ScrollText size={13} /> Activity
        </button>
        <button
          className="status-zoom"
          title={zoomResetKey ? `Reset zoom (${zoomResetKey})` : 'Reset zoom'}
          onClick={() => stepZoom(0)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <span>GitDom {__APP_VERSION__}</span>
      </div>
      <Overlays />
      <HoverLayer />
      <Updates />
      <Tips />
      {splash && <Splash onDone={() => setSplash(false)} />}
    </div>
  )
}

export default App
