import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Cloud, Laptop, Pencil, Tag } from 'lucide-react'
import type { Commit, RepoSnapshot } from '../../../shared/types'
import { computeLayout, type LayoutInput } from '../graph/layout'
import { ROW_HEIGHT, drawGraph, graphWidth, laneX, type NodeInfo } from '../graph/draw'
import { laneColor } from '../graph/colors'
import { useTheme } from '../theme'
import { buildRefLabels, type RefLabel } from '../graph/refLabels'
import { WIP_HASH, useApp } from '../store'
import { openMenu, openMenuAt } from '../ui'
import * as actions from '../actions'

const REFS_WIDTH = 220
const OVERSCAN = 6
/** Drag and drop payload: the full name of the dragged branch */
const REF_MIME = 'application/x-gitdom-ref'

type Row = { kind: 'wip'; changes: number } | { kind: 'commit'; commit: Commit }

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })

function RefPill({
  label,
  color,
  snapshot
}: {
  label: RefLabel
  color: string
  snapshot: RepoSnapshot
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

  const scrollerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const theme = useTheme((s) => s.applied)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  /** Commits selected with Ctrl+click, for actions on several commits */
  const [picked, setPicked] = useState<string[]>([])

  const changes = snapshot.status.staged.length + snapshot.status.unstaged.length

  const rows = useMemo<Row[]>(() => {
    const commitRows: Row[] = snapshot.commits.map((commit) => ({ kind: 'commit', commit }))
    return changes > 0 ? [{ kind: 'wip', changes }, ...commitRows] : commitRows
  }, [snapshot.commits, changes])

  const layout = useMemo(() => {
    const inputs: LayoutInput[] = rows.map((r) =>
      r.kind === 'wip'
        ? { hash: WIP_HASH, parents: snapshot.head.hash ? [snapshot.head.hash] : [], dashed: true }
        : { hash: r.commit.hash, parents: r.commit.parents }
    )
    return computeLayout(inputs)
  }, [rows, snapshot.head.hash])

  const nodes = useMemo<(NodeInfo | null)[]>(
    () => rows.map((r) => (r.kind === 'commit' ? r.commit : null)),
    [rows]
  )

  const labels = useMemo(
    () => buildRefLabels(snapshot.refs, snapshot.head),
    [snapshot.refs, snapshot.head]
  )

  const rowIndex = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((r, i) => map.set(r.kind === 'wip' ? WIP_HASH : r.commit.hash, i))
    return map
  }, [rows])

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
    drawGraph(ctx, { layout, nodes, scrollTop, width, height: viewportHeight, selectedRow })
    // The lane colours depend on the theme
  }, [layout, nodes, scrollTop, width, viewportHeight, selectedRow, theme])

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

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.min(
      rows.length - 1,
      Math.max(0, selectedRow + (e.key === 'ArrowDown' ? 1 : -1))
    )
    const row = rows[next]
    if (row) select(row.kind === 'wip' ? WIP_HASH : row.commit.hash, true)
  }

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
    const hash = row.kind === 'wip' ? WIP_HASH : row.commit.hash
    const rowLabels = row.kind === 'commit' ? labels.get(row.commit.hash) : undefined

    visible.push(
      <div
        key={hash}
        className={`graph-row${i === selectedRow ? ' selected' : ''}${
          pickedNow.includes(hash) ? ' picked' : ''
        }`}
        style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
        onMouseDown={(e) => clickRow(e, hash)}
        onContextMenu={(e) => row.kind === 'commit' && commitContextMenu(e, row.commit)}
      >
        <div className="cell-refs" style={{ width: REFS_WIDTH + laneX(lane) }}>
          {rowLabels && (
            <>
              <RefPill label={rowLabels[0]} color={color} snapshot={snapshot} />
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
        </div>
        <div style={{ width: width - laneX(lane), flexShrink: 0 }} />
        {row.kind === 'wip' ? (
          <div className="cell-message wip-message">
            {'// WIP'} &nbsp;
            <Pencil size={12} color="var(--orange)" /> {row.changes}
          </div>
        ) : (
          <>
            <div className="cell-message" title={row.commit.subject}>
              {row.commit.subject}
            </div>
            <div className="cell-author">{row.commit.authorName}</div>
            <div className="cell-date">{dateFormat.format(row.commit.authorDate * 1000)}</div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="graph">
      <div className="graph-header">
        <div style={{ width: REFS_WIDTH }}>BRANCH / TAG</div>
        <div style={{ width }}>GRAPH</div>
        <div style={{ flex: 1 }}>COMMIT MESSAGE</div>
        <div style={{ width: 150 }}>AUTHOR</div>
        <div style={{ width: 140 }}>DATE</div>
      </div>
      <div className="graph-body">
        <div
          ref={scrollerRef}
          className="graph-scroller"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div style={{ position: 'relative', height: rows.length * ROW_HEIGHT }}>{visible}</div>
        </div>
        <canvas ref={canvasRef} className="graph-canvas" style={{ left: REFS_WIDTH }} />
      </div>
    </div>
  )
}
