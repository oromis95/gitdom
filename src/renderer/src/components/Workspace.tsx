// The panels of an open repository, arranged by the layout of the theme: the sidebar, the graph
// or a view taking its place (diff, file, recovery, statistics) and the detail of the selection.
import { Fragment, Suspense, lazy, useEffect } from 'react'
import type { RepoSnapshot } from '../../../shared/types'
import type { RepoTab } from '../store'
import { useApp } from '../store'
import { toggleSidebarDrawer, useTheme } from '../theme'
import { updateSettings } from '../settings'
import Sidebar from './Sidebar'
import GraphView from './GraphView'
import DetailPanel from './DetailPanel'
import ResizeHandle from './ResizeHandle'

// Loaded on first use, to keep the startup bundle small (NFR-02)
const DiffView = lazy(() => import('./DiffView'))
const ConflictView = lazy(() => import('./ConflictView'))
const FileInspector = lazy(() => import('./FileInspector'))
const RecoveryView = lazy(() => import('./RecoveryView'))
const StatisticsView = lazy(() => import('./StatisticsView'))

/** The IDE panel keeps this much room above it for the graph */
const ABOVE_PANEL = 160

const loading = <div className="center-message">Loading…</div>

export default function Workspace({
  tab,
  snapshot
}: {
  tab: RepoTab
  snapshot: RepoSnapshot
}): React.JSX.Element {
  const loadMoreCommits = useApp((s) => s.loadMoreCommits)
  const layout = useTheme((s) => s.layout)
  const detailHidden = useTheme((s) => s.detailHidden)
  const sidebarOpen = useTheme((s) => s.sidebarOpen)
  const detailClosedFor = useTheme((s) => s.detailClosedFor)

  // Focus: Escape closes the drawer, unless a dialog or a menu has it
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.modal, .menu, .palette'))
        toggleSidebarDrawer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  const diff =
    tab.diff && !tab.diff.merge ? <DiffView snapshot={snapshot} target={tab.diff} /> : null
  // What takes the place of the graph, other than a diff
  const page = tab.diff?.merge ? (
    <ConflictView snapshot={snapshot} target={tab.diff} />
  ) : tab.inspect ? (
    <FileInspector snapshot={snapshot} inspect={tab.inspect} />
  ) : tab.recovery ? (
    <RecoveryView snapshot={snapshot} view={tab.recovery} />
  ) : tab.statistics ? (
    <StatisticsView snapshot={snapshot} />
  ) : null
  const view = page ?? diff
  const graph = (
    <GraphView
      snapshot={snapshot}
      selected={tab.selected}
      loadingMore={!!tab.loadingMore}
      onLoadMore={() => void loadMoreCommits(tab.path)}
    />
  )
  const detail = (edge?: 'left' | 'right' | null): React.JSX.Element => (
    <DetailPanel snapshot={snapshot} selected={tab.selected} compare={tab.compare} edge={edge} />
  )
  const sidebar = <Sidebar snapshot={snapshot} />

  if (layout === 'mail') {
    // Folders, the list of commits, the reading pane. A diff or a file is read in the reading
    // pane, with the files of the commit in the middle. Keyed, so the detail moving keeps its state
    const reading = <Fragment key="detail">{detail(view ? 'right' : null)}</Fragment>
    return (
      <div className={`workspace${view ? ' reading' : ''}`}>
        {sidebar}
        {view
          ? [
              reading,
              <Suspense key="view" fallback={loading}>
                {view}
              </Suspense>
            ]
          : [<Fragment key="graph">{graph}</Fragment>, reading]}
      </div>
    )
  }

  if (layout === 'ide') {
    // The graph on top, the detail and the diff side by side in the panel at the bottom
    return (
      <div className="workspace">
        {sidebar}
        <div className="ide-main">
          <div className="ide-top">
            <Suspense fallback={loading}>{page ?? graph}</Suspense>
          </div>
          <div className="ide-panel">
            <ResizeHandle
              edge="top"
              min={180}
              max={() => (document.querySelector('.ide-main')?.clientHeight ?? 600) - ABOVE_PANEL}
              onResize={(height) => updateSettings({ panelHeight: height })}
            />
            {detail('right')}
            <Suspense fallback={loading}>
              {diff ?? (
                <div className="ide-placeholder center-message">
                  Choose a file in the detail to see its changes here
                </div>
              )}
            </Suspense>
          </div>
        </div>
      </div>
    )
  }

  if (layout === 'focus') {
    // Only the graph: the sidebar slides in over it, the detail opens beside it on a selection
    const detailOpen = !!tab.selected && tab.selected !== detailClosedFor
    const classes = ['workspace']
    if (sidebarOpen) classes.push('sidebar-open')
    if (!detailOpen) classes.push('detail-hidden')
    return (
      <div className={classes.join(' ')}>
        {sidebar}
        <div className="drawer-scrim" onMouseDown={() => toggleSidebarDrawer(false)} />
        <Suspense fallback={loading}>{view ?? graph}</Suspense>
        {detail()}
      </div>
    )
  }

  return (
    <div className={`workspace${layout === 'studio' && detailHidden ? ' detail-hidden' : ''}`}>
      {sidebar}
      <Suspense fallback={loading}>{view ?? graph}</Suspense>
      {detail()}
    </div>
  )
}
