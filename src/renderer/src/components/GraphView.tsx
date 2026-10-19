import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { Commit, RepoSnapshot } from '../../../shared/types'
import { computeLayout, type LayoutInput } from '../graph/layout'
import { ROW_HEIGHT, graphWidth, type NodeInfo } from '../graph/draw'
import { buildRows } from '../graph/rows'
import { nextMatch } from '../graph/search'
import { firstParentChain } from '../graph/highlight'
import { primaryKey } from '../keys'
import { useShortcut } from '../shortcuts'
import { focusPanel } from '../focus'
import { buildRefLabels } from '../graph/refLabels'
import { WIP_HASH, useApp } from '../store'
import { openMenu, openMenuAt } from '../ui'
import { useSettings } from '../settings'
import * as actions from '../actions'
import GraphMinimap, { type MinimapMarker } from './GraphMinimap'
import { ColumnHeader } from './graph/cells'
import GraphRow from './graph/GraphRow'
import GraphToolbar from './graph/GraphToolbar'
import { useCommitReorder, useGraphCanvas, useGraphSearch } from './graph/hooks'
import { columnsMenu, rowKey } from './graph/shared'

const OVERSCAN = 6
/** Rows before the end of the loaded commits at which the next page is requested (GRAPH-08) */
const LOAD_AHEAD = 400

export default function GraphView({
  snapshot,
  selected,
  loadingMore,
  onLoadMore
}: {
  snapshot: RepoSnapshot
  selected: string | null
  loadingMore: boolean
  /** Loads the next page of older commits */
  onLoadMore: () => void
}): React.JSX.Element {
  const select = useApp((s) => s.select)
  const compare = useApp((s) => s.compare)
  const scrollRequest = useApp((s) => s.scrollRequest)
  const graphFilter = useApp((s) => s.graphFilters[snapshot.path])
  const settings = useSettings()

  const scrollerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  /** Commits selected with Ctrl+click (Command+click on macOS), for actions on several commits */
  const [picked, setPicked] = useState<string[]>([])
  /** Row whose branch pill is under the mouse (GRAPH-15) */
  const [hoverRow, setHoverRow] = useState<number | null>(null)
  /** List only the matches, without the graph lines */
  const [onlyMatches, setOnlyMatches] = useState(false)

  const changes = snapshot.status.staged.length + snapshot.status.unstaged.length

  const allRows = useMemo(
    () => buildRows(snapshot.commits, snapshot.stashes, changes),
    [snapshot.commits, snapshot.stashes, changes]
  )

  const search = useGraphSearch(snapshot.path, snapshot.commits, graphFilter, allRows)
  const { matched } = search

  const filtering = onlyMatches && matched !== null
  const rows = useMemo(
    () => (filtering ? allRows.filter((r) => matched?.has(rowKey(r))) : allRows),
    [allRows, filtering, matched]
  )

  // Hidden or solo branches may leave HEAD out of the graph: the WIP row then hangs from nothing
  const headHash = snapshot.head.hash
  const headShown = useMemo(
    () => !!headHash && snapshot.commits.some((c) => c.hash === headHash),
    [snapshot.commits, headHash]
  )

  const layout = useMemo(() => {
    const inputs = rows.map((r): LayoutInput => {
      // Only matches are listed: their lines would lead nowhere
      if (filtering) return { hash: rowKey(r), parents: [], dashed: r.kind === 'stash' }
      if (r.kind === 'wip')
        return { hash: WIP_HASH, parents: headShown ? [headHash!] : [], dashed: true }
      if (r.kind === 'stash') return { hash: r.stash.hash, parents: [r.stash.base], dashed: true }
      return { hash: r.commit.hash, parents: r.commit.parents }
    })
    return computeLayout(inputs)
  }, [rows, filtering, headShown, headHash])

  const nodes = useMemo(
    () =>
      rows.map((r): NodeInfo | null =>
        r.kind === 'commit'
          ? { kind: 'commit', authorName: r.commit.authorName, authorEmail: r.commit.authorEmail }
          : r.kind === 'stash'
            ? { kind: 'stash' }
            : null
      ),
    [rows]
  )

  const labels = useMemo(
    () => buildRefLabels(snapshot.refs, snapshot.head),
    [snapshot.refs, snapshot.head]
  )

  // The commits marked in a bisect in progress
  const bisectMarks = useMemo(() => {
    const marks = new Map<string, 'good' | 'bad' | 'skipped' | 'testing'>()
    const b = snapshot.bisect
    if (!b) return marks
    for (const hash of b.good) marks.set(hash, 'good')
    for (const hash of b.skipped) marks.set(hash, 'skipped')
    if (b.bad) marks.set(b.bad, 'bad')
    // What git checked out for the user to test
    const head = snapshot.head.hash
    if (head && b.bad && b.good.length && !b.culprit && !marks.has(head)) marks.set(head, 'testing')
    return marks
  }, [snapshot.bisect, snapshot.head.hash])

  const rowIndex = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((r, i) => map.set(rowKey(r), i))
    return map
  }, [rows])

  const matchRows = useMemo(
    () => (matched ? rows.flatMap((r, i) => (matched.has(rowKey(r)) ? [i] : [])) : []),
    [rows, matched]
  )

  const chain = useMemo(() => {
    if (hoverRow === null || filtering) return null
    const firstParents = rows.map((r) =>
      r.kind === 'commit' ? r.commit.parents[0] : r.kind === 'stash' ? r.stash.base : undefined
    )
    return firstParentChain(layout, firstParents, rowIndex, hoverRow)
  }, [hoverRow, filtering, rows, layout, rowIndex])

  const reorder = useCommitReorder(snapshot, headShown, filtering)

  // Commits that disappeared after a reload can't stay picked
  const pickedNow = picked.filter((h) => rowIndex.has(h))
  const clearPicked = (): void => setPicked([])

  const clickRow = (e: React.MouseEvent, hash: string): void => {
    if (e.button !== 0) return
    if (primaryKey(e) && hash !== WIP_HASH) {
      const start = pickedNow.length
        ? pickedNow
        : selected && selected !== WIP_HASH
          ? [selected]
          : []
      const next = start.includes(hash) ? start.filter((h) => h !== hash) : [...start, hash]
      setPicked(next)
      select(hash)
      // Two commits picked: show what changed from the older to the newer one
      if (next.length === 2) {
        const [newer, older] = [...next].sort((a, b) => rowIndex.get(a)! - rowIndex.get(b)!)
        compare({ from: older, to: newer })
      }
      return
    }
    clearPicked()
    select(hash)
  }

  const commitContextMenu = (e: React.MouseEvent, commit: Commit): void => {
    if (pickedNow.length > 1 && pickedNow.includes(commit.hash)) {
      // Oldest first: the graph lists newest commits at the top
      const hashes = [...pickedNow].sort((a, b) => rowIndex.get(b)! - rowIndex.get(a)!)
      openMenu(e, actions.commitsMenu(snapshot, hashes, clearPicked))
      return
    }
    clearPicked()
    select(commit.hash)
    openMenu(e, actions.commitMenu(snapshot, commit.hash, commit.subject))
  }

  const selectedRow = selected ? (rowIndex.get(selected) ?? -1) : -1
  const width = graphWidth(layout.laneCount)
  const refsWidth = settings.graphShowRefs ? settings.graphRefsWidth : 0

  const { canvasRef, viewportHeight } = useGraphCanvas(scrollerRef, {
    layout,
    nodes,
    rows,
    scrollTop,
    selectedRow,
    chain,
    matched,
    filtering,
    avatars: settings.graphAvatars
  })

  useEffect(() => {
    const el = scrollerRef.current
    if (!scrollRequest || !el) return
    const index = rowIndex.get(scrollRequest.hash)
    if (index === undefined) return
    const top = index * ROW_HEIGHT
    if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top - el.clientHeight / 2
    }
  }, [scrollRequest, rowIndex])

  // Ctrl+F jumps to the search box (not from the terminal, which has its own use for it)
  useShortcut('search', () => {
    searchRef.current?.focus()
    searchRef.current?.select()
  })

  const goToMatch = (backwards: boolean): void => {
    const row = nextMatch(matchRows, selectedRow, backwards)
    if (row >= 0) select(rowKey(rows[row]), true)
  }

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      goToMatch(e.shiftKey)
    } else if (e.key === 'Escape') {
      search.setText('')
      scrollerRef.current?.focus()
    }
  }

  // Keyboard (NFR-09): arrows, pages, Home and End move the selection; the menu key or Shift+F10
  // opens the commit's menu; Enter goes on to its details
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1)
    const steps: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: page,
      PageUp: -page,
      Home: -Infinity,
      End: Infinity
    }
    if (e.key in steps && !e.shiftKey) {
      e.preventDefault()
      const from = selectedRow < 0 ? -1 : selectedRow
      const next = Math.min(rows.length - 1, Math.max(0, from + steps[e.key]))
      const row = rows[next]
      if (row) select(rowKey(row), true)
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      const row = rows[selectedRow]
      if (!row) return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = rect.left + refsWidth + 24
      const y = rect.top + (selectedRow + 1) * ROW_HEIGHT - e.currentTarget.scrollTop
      if (row.kind === 'commit')
        openMenuAt(x, y, actions.commitMenu(snapshot, row.commit.hash, row.commit.subject))
      else if (row.kind === 'stash') openMenuAt(x, y, actions.stashMenu(snapshot, row.stash))
    } else if (e.key === 'Enter' && !e.shiftKey && selectedRow >= 0) {
      e.preventDefault()
      focusPanel('detail')
    }
  }

  const markers = useMemo(() => {
    const list: MinimapMarker[] = matchRows.map((row) => ({ row, color: '--orange' }))
    const head = headHash ? rowIndex.get(headHash) : undefined
    if (head !== undefined) list.push({ row: head, color: '--green' })
    if (selectedRow >= 0) list.push({ row: selectedRow, color: '--accent' })
    return list
  }, [matchRows, headHash, rowIndex, selectedRow])

  const commitKey = search.mode === 'commit' ? search.key : ''
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  )
  const visible: React.JSX.Element[] = []
  // Older commits load before the end comes into view; not while only matches are listed
  const loadsMore = snapshot.truncated && !filtering
  const nearEnd = last >= rows.length - LOAD_AHEAD
  useEffect(() => {
    if (loadsMore && nearEnd && !loadingMore) onLoadMore()
  }, [loadsMore, nearEnd, loadingMore, onLoadMore])

  for (let i = first; i < last; i++) {
    const row = rows[i]
    const hash = rowKey(row)
    const faded = chain ? !chain.rows.has(i) : !!matched && !filtering && !matched.has(hash)
    const classes = ['graph-row']
    if (i === selectedRow) classes.push('selected')
    if (pickedNow.includes(hash)) classes.push('picked')
    if (faded) classes.push('faded')
    if (reorder.dragged === hash) classes.push('dragged')
    if (reorder.dropAt?.hash === hash)
      classes.push(reorder.dropAt.after ? 'drop-after' : 'drop-before')

    visible.push(
      <GraphRow
        key={hash}
        snapshot={snapshot}
        row={row}
        index={i}
        lane={layout.rows[i].lane}
        labels={row.kind === 'commit' ? labels.get(row.commit.hash) : undefined}
        className={classes.join(' ')}
        refsWidth={refsWidth}
        width={width}
        settings={settings}
        commitKey={commitKey}
        bisectMark={bisectMarks.get(hash)}
        reorder={reorder}
        onMouseDown={(e) => clickRow(e, hash)}
        onContextMenu={(e) => {
          if (row.kind === 'commit') commitContextMenu(e, row.commit)
          else if (row.kind === 'stash') {
            select(hash)
            openMenu(e, actions.stashMenu(snapshot, row.stash))
          }
        }}
        onHoverRef={(on) => setHoverRow(on ? i : null)}
      />
    )
  }

  return (
    <div className="graph">
      <GraphToolbar
        repo={snapshot.path}
        graphFilter={graphFilter}
        search={search}
        searchRef={searchRef}
        matches={matchRows.length}
        position={matchRows.indexOf(selectedRow)}
        onlyMatches={onlyMatches}
        setOnlyMatches={setOnlyMatches}
        goToMatch={goToMatch}
        onSearchKey={onSearchKey}
      />
      <div className="graph-header" onContextMenu={(e) => columnsMenu(e, settings)}>
        {settings.graphShowRefs && (
          <ColumnHeader title="BRANCH / TAG" width="graphRefsWidth" edge="right" />
        )}
        <div style={{ width }}>GRAPH</div>
        <div style={{ flex: 1 }}>COMMIT MESSAGE</div>
        {settings.graphShowSha && <ColumnHeader title="SHA" width="graphShaWidth" edge="left" />}
        {settings.graphShowAuthor && (
          <ColumnHeader title="AUTHOR" width="graphAuthorWidth" edge="left" />
        )}
        {settings.graphShowDate && <ColumnHeader title="DATE" width="graphDateWidth" edge="left" />}
      </div>
      <div className="graph-body">
        <div
          ref={scrollerRef}
          className="graph-scroller"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            setScrollTop(e.currentTarget.scrollTop)
            // The hovered pill may scroll out of view without a mouseleave
            setHoverRow(null)
          }}
        >
          <div
            style={{
              position: 'relative',
              height: (rows.length + (loadsMore ? 1 : 0)) * ROW_HEIGHT
            }}
          >
            {visible}
            {loadsMore && (
              <div
                className="graph-more"
                style={{ top: rows.length * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <LoaderCircle size={14} className="spin" /> Loading older commits…
              </div>
            )}
          </div>
          {filtering && rows.length === 0 && (
            <div className="graph-empty">
              {search.searching ? 'Searching…' : 'No matching commits'}
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="graph-canvas" style={{ left: refsWidth }} />
        <GraphMinimap
          rows={rows.length}
          rowHeight={ROW_HEIGHT}
          scrollTop={scrollTop}
          viewportHeight={viewportHeight}
          markers={markers}
          onScroll={(top) => {
            if (scrollerRef.current) scrollerRef.current.scrollTop = top
          }}
        />
      </div>
    </div>
  )
}
