import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Columns3,
  EyeOff,
  Laptop,
  Pencil,
  Search,
  Tag,
  X
} from 'lucide-react'
import type { Commit, RepoSnapshot } from '../../../shared/types'
import { computeLayout, type LayoutInput } from '../graph/layout'
import { ROW_HEIGHT, drawGraph, graphWidth, laneX, type NodeInfo } from '../graph/draw'
import { laneColor } from '../graph/colors'
import { buildRows, type GraphItem } from '../graph/rows'
import { markMatches, matchesCommit, nextMatch, searchKey, type SearchMode } from '../graph/search'
import { firstParentChain } from '../graph/highlight'
import { avatarImage, onAvatarLoaded } from '../graph/avatars'
import { useTheme } from '../theme'
import { buildRefLabels, type RefLabel } from '../graph/refLabels'
import { NO_GRAPH_FILTER, WIP_HASH, useApp } from '../store'
import { openMenu, openMenuAt, type MenuItem } from '../ui'
import {
  DEFAULT_SETTINGS,
  GRAPH_COLUMN_WIDTH,
  updateSettings,
  useSettings,
  type Settings
} from '../settings'
import * as actions from '../actions'
import ResizeHandle from './ResizeHandle'
import GraphMinimap, { type MinimapMarker } from './GraphMinimap'

const OVERSCAN = 6
/** Drag and drop payload: the full name of the dragged branch */
const REF_MIME = 'application/x-gitdom-ref'
/** Pause in typing before git searches messages or files */
const SEARCH_DELAY = 250

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })

const rowKey = (row: GraphItem): string =>
  row.kind === 'wip' ? WIP_HASH : row.kind === 'commit' ? row.commit.hash : row.stash.hash

/** Branch name without its refs/heads/ or refs/remotes/ prefix. */
const branchName = (fullName: string): string => fullName.replace(/^refs\/(heads|remotes)\//, '')

type WidthKey = 'graphRefsWidth' | 'graphShaWidth' | 'graphAuthorWidth' | 'graphDateWidth'
type ShowKey = 'graphShowRefs' | 'graphShowSha' | 'graphShowAuthor' | 'graphShowDate'

/** Optional columns (GRAPH-03); the graph and the message always show. */
const COLUMNS: { title: string; width: WidthKey; show: ShowKey }[] = [
  { title: 'Branch / Tag', width: 'graphRefsWidth', show: 'graphShowRefs' },
  { title: 'SHA', width: 'graphShaWidth', show: 'graphShowSha' },
  { title: 'Author', width: 'graphAuthorWidth', show: 'graphShowAuthor' },
  { title: 'Date', width: 'graphDateWidth', show: 'graphShowDate' }
]

function columnsMenu(e: React.MouseEvent, s: Settings): void {
  openMenu(e, [
    ...COLUMNS.map((c): MenuItem => ({
      label: `${s[c.show] ? 'Hide' : 'Show'} ${c.title} column`,
      onClick: () => updateSettings({ [c.show]: !s[c.show] })
    })),
    'separator',
    {
      label: 'Reset column widths',
      onClick: () =>
        updateSettings(Object.fromEntries(COLUMNS.map((c) => [c.width, DEFAULT_SETTINGS[c.width]])))
    }
  ])
}

/** Header cell of an optional column, resized from its edge next to the message. */
function ColumnHeader({
  title,
  width,
  edge
}: {
  title: string
  width: WidthKey
  edge: 'left' | 'right'
}): React.JSX.Element {
  const value = useSettings((s) => s[width])
  return (
    <div className="graph-col" style={{ width: value }}>
      {title}
      <ResizeHandle
        edge={edge}
        min={GRAPH_COLUMN_WIDTH.min}
        max={() => GRAPH_COLUMN_WIDTH.max}
        onResize={(w) => updateSettings({ [width]: w ?? DEFAULT_SETTINGS[width] })}
      />
    </div>
  )
}

/** Text with every occurrence of the search marked. */
function Marked({ text, mark }: { text: string; mark: string }): React.JSX.Element {
  return (
    <>
      {markMatches(text, mark).map((part, i) =>
        part.mark ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>
      )}
    </>
  )
}

function RefPill({
  label,
  color,
  snapshot,
  onHover
}: {
  label: RefLabel
  color: string
  snapshot: RepoSnapshot
  /** The mouse entered or left the pill: its branch lights up (GRAPH-15) */
  onHover(on: boolean): void
}): React.JSX.Element {
  const ref = snapshot.refs.find((r) => r.fullName === label.key)
  const [over, setOver] = useState(false)
  const isBranch = ref?.type === 'local' || ref?.type === 'remote'
  const dragging = (e: React.DragEvent): boolean =>
    isBranch && e.dataTransfer.types.includes(REF_MIME)

  return (
    <div
      className={`ref-pill${over ? ' drop-target' : ''}`}
      style={{ background: color }}
      title={isBranch ? `${label.name}\nDrag onto another branch to merge or rebase` : label.name}
      draggable={isBranch}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onDragStart={(e) => {
        if (!ref) return
        e.dataTransfer.setData(REF_MIME, ref.fullName)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!dragging(e)) return
        e.preventDefault()
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        const source = snapshot.refs.find((r) => r.fullName === e.dataTransfer.getData(REF_MIME))
        if (!ref || !source || !dragging(e)) return
        e.preventDefault()
        void actions.dropBranch(e.clientX, e.clientY, snapshot, source, ref)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (ref?.type === 'local' && !label.current)
          void actions.checkoutBranch(snapshot.path, ref.name)
        else if (ref?.type === 'remote')
          void actions.checkoutRemoteBranch(snapshot.path, snapshot, ref)
      }}
      onContextMenu={(e) => ref && openMenu(e, actions.refMenu(snapshot, ref))}
    >
      {label.current && <Check size={13} />}
      {label.tag && <Tag size={12} />}
      <span>{label.name}</span>
      {label.local && <Laptop size={13} />}
      {label.remote && <Cloud size={13} />}
    </div>
  )
}

/** Lists the refs hidden behind "+N"; choosing one opens its own menu at the same spot. */
function openRefsMenu(e: React.MouseEvent, snapshot: RepoSnapshot, labels: RefLabel[]): void {
  const { clientX: x, clientY: y } = e
  const items = labels.flatMap((label) => {
    const ref = snapshot.refs.find((r) => r.fullName === label.key)
    return ref
      ? [{ label: label.name, onClick: () => openMenuAt(x, y, actions.refMenu(snapshot, ref)) }]
      : []
  })
  openMenu(e, items)
}

export default function GraphView({
  snapshot,
  selected
}: {
  snapshot: RepoSnapshot
  selected: string | null
}): React.JSX.Element {
  const select = useApp((s) => s.select)
  const scrollRequest = useApp((s) => s.scrollRequest)
  const graphFilter = useApp((s) => s.graphFilters[snapshot.path])
  const setGraphFilter = useApp((s) => s.setGraphFilter)
  const settings = useSettings()

  const scrollerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const theme = useTheme((s) => s.applied)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  /** Commits selected with Ctrl+click, for actions on several commits */
  const [picked, setPicked] = useState<string[]>([])
  /** Row whose branch pill is under the mouse (GRAPH-15) */
  const [hoverRow, setHoverRow] = useState<number | null>(null)
  const [searchText, setSearchText] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('commit')
  /** List only the matches, without the graph lines */
  const [onlyMatches, setOnlyMatches] = useState(false)
  /** What git found for a query: full messages or changed files */
  const [found, setFound] = useState<{ query: string; hashes: Set<string> } | null>(null)
  /** Bumped when an author picture arrives, to redraw the nodes */
  const [avatarTick, setAvatarTick] = useState(0)

  const changes = snapshot.status.staged.length + snapshot.status.unstaged.length

  const allRows = useMemo(
    () => buildRows(snapshot.commits, snapshot.stashes, changes),
    [snapshot.commits, snapshot.stashes, changes]
  )

  // --- Search (GRAPH-17) ---
  const key = searchKey(searchText)
  const query = `${searchMode}:${key}`
  // Single letters are matched here only: every message has some
  const asksGit = key !== '' && (searchMode === 'file' || key.length > 1)

  useEffect(() => {
    if (!asksGit) return
    let stale = false
    const timer = setTimeout(async () => {
      const field = searchMode === 'commit' ? 'message' : 'file'
      const result = await window.api.op(snapshot.path, 'searchCommits', field, key, graphFilter)
      if (!stale) setFound({ query, hashes: new Set(result.ok ? result.value : []) })
    }, SEARCH_DELAY)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [asksGit, snapshot.path, snapshot.commits, graphFilter, key, searchMode, query])

  const matched = useMemo<Set<string> | null>(() => {
    if (!key) return null
    const fromGit = found?.query === query ? found.hashes : undefined
    const hits = new Set<string>()
    for (const row of allRows) {
      if (row.kind === 'commit') {
        if (
          (searchMode === 'commit' && matchesCommit(row.commit, key)) ||
          fromGit?.has(row.commit.hash)
        )
          hits.add(row.commit.hash)
      } else if (row.kind === 'stash' && searchMode === 'commit') {
        if (row.stash.message.toLowerCase().includes(key)) hits.add(row.stash.hash)
      }
    }
    return hits
  }, [allRows, key, query, searchMode, found])
  const searching = asksGit && found?.query !== query

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

  // Commits that disappeared after a reload can't stay picked
  const pickedNow = picked.filter((h) => rowIndex.has(h))
  const clearPicked = (): void => setPicked([])

  const clickRow = (e: React.MouseEvent, hash: string): void => {
    if (e.button !== 0) return
    if (e.ctrlKey && hash !== WIP_HASH) {
      const start = pickedNow.length
        ? pickedNow
        : selected && selected !== WIP_HASH
          ? [selected]
          : []
      setPicked(start.includes(hash) ? start.filter((h) => h !== hash) : [...start, hash])
    } else {
      clearPicked()
    }
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

  const avatars = settings.graphAvatars
  useEffect(() => {
    if (!avatars) return
    return onAvatarLoaded(() => setAvatarTick((tick) => tick + 1))
  }, [avatars])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || viewportHeight === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = viewportHeight * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${viewportHeight}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawGraph(ctx, {
      layout,
      nodes,
      scrollTop,
      width,
      height: viewportHeight,
      selectedRow,
      chain,
      dimmed: matched && !filtering ? (i) => !matched.has(rowKey(rows[i])) : undefined,
      avatar: avatars ? avatarImage : undefined
    })
    // The lane colours depend on the theme; avatarTick redraws once a picture arrives
  }, [
    layout,
    nodes,
    scrollTop,
    width,
    viewportHeight,
    selectedRow,
    chain,
    matched,
    filtering,
    rows,
    avatars,
    avatarTick,
    theme
  ])

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

  // Ctrl+F jumps to the search box, except in the terminal, which has its own use for it
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      if ((e.target as HTMLElement | null)?.closest?.('.xterm')) return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goToMatch = (backwards: boolean): void => {
    const row = nextMatch(matchRows, selectedRow, backwards)
    if (row >= 0) select(rowKey(rows[row]), true)
  }

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      goToMatch(e.shiftKey)
    } else if (e.key === 'Escape') {
      setSearchText('')
      scrollerRef.current?.focus()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.min(
      rows.length - 1,
      Math.max(0, selectedRow + (e.key === 'ArrowDown' ? 1 : -1))
    )
    const row = rows[next]
    if (row) select(rowKey(row), true)
  }

  const markers = useMemo(() => {
    const list: MinimapMarker[] = matchRows.map((row) => ({ row, color: '--orange' }))
    const head = headHash ? rowIndex.get(headHash) : undefined
    if (head !== undefined) list.push({ row: head, color: '--green' })
    if (selectedRow >= 0) list.push({ row: selectedRow, color: '--accent' })
    return list
  }, [matchRows, headHash, rowIndex, selectedRow])

  const filter = graphFilter ?? NO_GRAPH_FILTER
  const hiddenMenu = (e: React.MouseEvent): void =>
    openMenu(e, [
      ...filter.hidden.map((name) => ({
        label: `Show ${branchName(name)}`,
        onClick: () =>
          setGraphFilter(snapshot.path, {
            ...filter,
            hidden: filter.hidden.filter((h) => h !== name)
          })
      })),
      'separator',
      { label: 'Show all branches', onClick: () => setGraphFilter(snapshot.path, NO_GRAPH_FILTER) }
    ])

  const commitKey = searchMode === 'commit' ? key : ''
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  )
  const visible: React.JSX.Element[] = []

  for (let i = first; i < last; i++) {
    const row = rows[i]
    const lane = layout.rows[i].lane
    const color = laneColor(lane)
    const hash = rowKey(row)
    const rowLabels = row.kind === 'commit' ? labels.get(row.commit.hash) : undefined
    const faded = chain ? !chain.rows.has(i) : !!matched && !filtering && !matched.has(hash)
    const classes = ['graph-row']
    if (i === selectedRow) classes.push('selected')
    if (pickedNow.includes(hash)) classes.push('picked')
    if (faded) classes.push('faded')

    visible.push(
      <div
        key={hash}
        className={classes.join(' ')}
        style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
        onMouseDown={(e) => clickRow(e, hash)}
        onContextMenu={(e) => {
          if (row.kind === 'commit') commitContextMenu(e, row.commit)
          else if (row.kind === 'stash') {
            select(hash)
            openMenu(e, actions.stashMenu(snapshot, row.stash))
          }
        }}
      >
        <div className="cell-refs" style={{ width: refsWidth + laneX(lane) }}>
          {settings.graphShowRefs && rowLabels && (
            <>
              <RefPill
                label={rowLabels[0]}
                color={color}
                snapshot={snapshot}
                onHover={(on) => setHoverRow(on ? i : null)}
              />
              {rowLabels.length > 1 && (
                <span
                  className="ref-more"
                  title={rowLabels.map((l) => l.name).join('\n')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => openRefsMenu(e, snapshot, rowLabels.slice(1))}
                  onContextMenu={(e) => openRefsMenu(e, snapshot, rowLabels.slice(1))}
                >
                  +{rowLabels.length - 1}
                </span>
              )}
              <div className="ref-connector" style={{ background: color }} />
            </>
          )}
          {settings.graphShowRefs && row.kind === 'stash' && (
            <>
              <div className="ref-pill stash-pill" title={row.stash.message}>
                <Archive size={12} />
                <span>{row.stash.selector}</span>
              </div>
              <div className="ref-connector stash-connector" />
            </>
          )}
        </div>
        <div style={{ width: width - laneX(lane), flexShrink: 0 }} />
        {row.kind === 'wip' ? (
          <div className="cell-message wip-message">
            {'// WIP'} &nbsp;
            <Pencil size={12} color="var(--orange)" /> {row.changes}
          </div>
        ) : (
          <>
            <div
              className={`cell-message${row.kind === 'stash' ? ' stash-message' : ''}`}
              title={row.kind === 'commit' ? row.commit.subject : row.stash.message}
            >
              <Marked
                text={row.kind === 'commit' ? row.commit.subject : row.stash.message}
                mark={commitKey}
              />
            </div>
            {settings.graphShowSha && (
              <div className="cell-sha" style={{ width: settings.graphShaWidth }}>
                <Marked
                  text={hash.slice(0, 7)}
                  mark={commitKey && hash.startsWith(commitKey) ? commitKey : ''}
                />
              </div>
            )}
            {settings.graphShowAuthor && (
              <div className="cell-author" style={{ width: settings.graphAuthorWidth }}>
                {row.kind === 'commit' && <Marked text={row.commit.authorName} mark={commitKey} />}
              </div>
            )}
            {settings.graphShowDate && (
              <div className="cell-date" style={{ width: settings.graphDateWidth }}>
                {dateFormat.format(
                  (row.kind === 'commit' ? row.commit.authorDate : row.stash.date) * 1000
                )}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const position = matchRows.indexOf(selectedRow)
  const counter = searching
    ? 'Searching…'
    : matchRows.length === 0
      ? 'No results'
      : `${position >= 0 ? position + 1 : '–'} / ${matchRows.length}`

  return (
    <div className="graph">
      <div className="graph-toolbar">
        <div className={`graph-search${key ? ' active' : ''}`}>
          <Search size={14} className="muted" />
          <input
            ref={searchRef}
            placeholder={
              searchMode === 'commit'
                ? 'Search messages, authors, SHA (Ctrl+F)'
                : 'Search changed files (Ctrl+F)'
            }
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {key && (
            <>
              <span className="graph-search-count">{counter}</span>
              <button
                className="graph-tool"
                title="Previous match (Shift+Enter)"
                disabled={matchRows.length === 0}
                onClick={() => goToMatch(true)}
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="graph-tool"
                title="Next match (Enter)"
                disabled={matchRows.length === 0}
                onClick={() => goToMatch(false)}
              >
                <ChevronDown size={14} />
              </button>
              <button className="graph-tool" title="Clear (Esc)" onClick={() => setSearchText('')}>
                <X size={14} />
              </button>
            </>
          )}
        </div>
        <span className="segmented">
          {(['commit', 'file'] as const).map((mode) => (
            <button
              key={mode}
              className={searchMode === mode ? 'active' : ''}
              title={
                mode === 'commit'
                  ? 'Search commit messages, authors and SHA'
                  : 'Search the paths of the changed files'
              }
              onClick={() => setSearchMode(mode)}
            >
              {mode === 'commit' ? 'Commits' : 'Files'}
            </button>
          ))}
        </span>
        <label className="graph-only" title="List only the matching commits">
          <input
            type="checkbox"
            checked={onlyMatches}
            onChange={(e) => setOnlyMatches(e.target.checked)}
          />
          Only matches
        </label>
        <span className="graph-toolbar-gap" />
        {filter.solo ? (
          <span className="graph-filter-chip" title={filter.solo}>
            Only {branchName(filter.solo)}
            <button onClick={() => setGraphFilter(snapshot.path, { ...filter, solo: null })}>
              Show all
            </button>
          </span>
        ) : (
          filter.hidden.length > 0 && (
            <button
              className="graph-filter-chip"
              title={filter.hidden.map(branchName).join('\n')}
              onClick={hiddenMenu}
            >
              <EyeOff size={13} />
              {filter.hidden.length} hidden
            </button>
          )
        )}
        <button className="graph-tool" title="Columns" onClick={(e) => columnsMenu(e, settings)}>
          <Columns3 size={15} />
        </button>
      </div>
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
          <div style={{ position: 'relative', height: rows.length * ROW_HEIGHT }}>{visible}</div>
          {filtering && rows.length === 0 && (
            <div className="graph-empty">{searching ? 'Searching…' : 'No matching commits'}</div>
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
