import { useEffect, useState } from 'react'
import { FolderOpen, TriangleAlert, User } from 'lucide-react'
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
import { openMenu } from './ui'
import { splashEnabled, useTheme } from './theme'

const AUTO_FETCH_MS = 10 * 60 * 1000

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

function Welcome(): React.JSX.Element {
  const { recent, openRepo, pickAndOpen } = useApp()
  return (
    <div className="welcome">
      <HighwayLogo size={220} />
      <h1>GitDom</h1>
      <button className="primary" onClick={() => void pickAndOpen()}>
        <FolderOpen size={18} /> Open repository
      </button>
      {recent.length > 0 && (
        <div className="recent">
          <div className="muted" style={{ padding: '0 10px 6px' }}>
            Recent
          </div>
          {recent.map((path) => (
            <button key={path} className="recent-item" onClick={() => void openRepo(path)}>
              <span>{path.split(/[\\/]/).pop()}</span>
              <span className="muted">{path}</span>
            </button>
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
  useEffect(() => {
    const timer = setInterval(() => {
      for (const t of useApp.getState().tabs) {
        if (t.snapshot?.remotes.length && !t.busy) void fetchAll(t.path, true)
      }
    }, AUTO_FETCH_MS)
    return () => clearInterval(timer)
  }, [])

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
              <DetailPanel snapshot={snapshot} selected={tab.selected} />
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
        <span>GitDom 0.1.0</span>
      </div>
      <Overlays />
      {splash && <Splash onDone={() => setSplash(false)} />}
    </div>
  )
}

export default App
