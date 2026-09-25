import { useEffect, useState } from 'react'
import { Download, FolderOpen, FolderPlus, Star, TriangleAlert, User, X } from 'lucide-react'
import type { RepoSnapshot } from '../../shared/types'
import TabBar from './components/TabBar'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import GraphView from './components/GraphView'
import DetailPanel from './components/DetailPanel'
import DiffView from './components/DiffView'
import ConflictView from './components/ConflictView'
import FileInspector from './components/FileInspector'
import Overlays from './components/Overlays'
import TerminalDock from './components/TerminalDock'
import Splash, { HighwayLogo } from './components/Splash'
import { restoreSession, useActiveTab, useApp } from './store'
import { fetchAll } from './actions'
import { identityMenu } from './identity'
import { openMenu, openPreferences, openRepoDialog } from './ui'
import { stepZoom, useSettings } from './settings'
import { splashEnabled, useTheme } from './theme'

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
  return (
    <div className="welcome">
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
  const studio = useTheme((s) => s.studio)
  const detailHidden = useTheme((s) => s.detailHidden)
  const [splash, setSplash] = useState(splashEnabled)

  useEffect(() => restoreSession(), [])

  useEffect(
    () =>
      window.api.menu.onCommand((command) => {
        if (command === 'open') void useApp.getState().pickAndOpen()
        else if (command === 'clone' || command === 'init') openRepoDialog(command)
        else if (command === 'preferences') openPreferences()
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

  // Ctrl+Shift+= types "+" on most layouts: the menu only binds Ctrl+=. Ctrl+wheel zooms too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && e.key === '+') {
        e.preventDefault()
        stepZoom(1)
      }
    }
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      stepZoom(e.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])
  const zoom = useSettings((s) => s.zoom)

  // Pick up changes made outside the app (terminal, IDE) when the window regains focus
  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const snapshot = tab?.snapshot

  return (
    <div className={`app${studio ? ' studio' : ''}`}>
      <TabBar />
      {!tab ? (
        <Welcome />
      ) : (
        <>
          <Toolbar tab={tab} />
          {tab.error && <div className="banner-error">{tab.error}</div>}
          {snapshot ? (
            <div
              key={tab.path}
              className={`workspace${studio && detailHidden ? ' detail-hidden' : ''}`}
            >
              <Sidebar snapshot={snapshot} />
              {tab.diff?.merge ? (
                <ConflictView snapshot={snapshot} target={tab.diff} />
              ) : tab.diff ? (
                <DiffView snapshot={snapshot} target={tab.diff} />
              ) : tab.inspect ? (
                <FileInspector snapshot={snapshot} inspect={tab.inspect} />
              ) : (
                <GraphView snapshot={snapshot} selected={tab.selected} />
              )}
              <DetailPanel snapshot={snapshot} selected={tab.selected} compare={tab.compare} />
            </div>
          ) : (
            <div className="center-message">{tab.loading ? 'Loading repository…' : ''}</div>
          )}
        </>
      )}
      <TerminalDock />
      <div className="statusbar">
        {snapshot && (
          <>
            <span>{snapshot.path}</span>
            <span>
              {snapshot.commits.length} commits{snapshot.truncated ? ' (truncated)' : ''}
            </span>
          </>
        )}
        {tab?.busy && <span className="status-busy">{tab.busy}…</span>}
        <span style={{ marginLeft: 'auto' }} />
        {snapshot && <IdentityButton snapshot={snapshot} />}
        {zoom !== 1 && (
          <button className="status-zoom" title="Reset zoom (Ctrl+0)" onClick={() => stepZoom(0)}>
            {Math.round(zoom * 100)}%
          </button>
        )}
        <span>GitDom {__APP_VERSION__}</span>
      </div>
      <Overlays />
      {splash && <Splash onDone={() => setSplash(false)} />}
    </div>
  )
}

export default App
