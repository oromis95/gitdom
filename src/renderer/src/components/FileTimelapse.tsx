// The time-lapse of a file: drag the timeline and watch it change version by version, with who
// changed each line, the recent changes standing out and the removed lines still in sight.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Flame,
  Ghost,
  GitCompare,
  MessageSquare,
  Minus,
  Plus,
  Search,
  Tag
} from 'lucide-react'
import type { RepoSnapshot, Timelapse, TimelapseRevision } from '../../../shared/types'
import { WIP_HASH, useApp, type FileInspect } from '../store'
import { fromTerminal, openMenu, type MenuItem } from '../ui'
import { highlightLines } from '../highlight'
import { useShortcut, withShortcut } from '../shortcuts'
import { openDiffTool } from '../actions'
import {
  frameRows,
  nextStep,
  recency,
  searchSteps,
  stepsWith,
  type TimelapseRow,
  type TimelapseFilters
} from '../timelapse'
import TimelapseTrack from './TimelapseTrack'
import { copyHash, dayFormat, formatDate, showInGraph, useLoaded } from './inspect'

const VIEW_KEY = 'gitdom.timelapse'

/** What the time-lapse shows, kept between sessions */
interface View {
  recency: boolean
  ghosts: boolean
  tags: boolean
  filters: TimelapseFilters
}

const DEFAULT_VIEW: View = {
  recency: true,
  ghosts: true,
  tags: true,
  filters: { added: true, removed: true, commits: true }
}

function savedView(): View {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<View>
    return {
      ...DEFAULT_VIEW,
      ...saved,
      filters: { ...DEFAULT_VIEW.filters, ...saved.filters }
    }
  } catch {
    return DEFAULT_VIEW
  }
}

/** Highlighted lines of each time-lapse: one by one, so each is done once for all versions */
const highlighted = new WeakMap<Timelapse, Map<number, string>>()

function htmlOf(t: Timelapse, id: number): string {
  let lines = highlighted.get(t)
  if (!lines) highlighted.set(t, (lines = new Map()))
  let html = lines.get(id)
  if (html === undefined) {
    html = highlightLines(t.path, [t.text[id]])[0]
    lines.set(id, html)
  }
  return html
}

const revisionTitle = (r: TimelapseRevision): string =>
  r.hash
    ? `${r.subject}\n${r.authorName} · ${formatDate(r.authorDate)} · ${r.hash.slice(0, 7)}`
    : 'Uncommitted changes'

interface RowProps {
  id: number
  ghost: boolean
  /** The first row of a run of lines from the same commit: it shows the commit */
  commit: TimelapseRevision | null
  lineNo: number | null
  html: string
  recent: number
  anchored: boolean
  /** Contains the search text; 'here' when this step added or removed it */
  hit: '' | 'any' | 'here'
  onGutter(id: number): void
  onGutterMenu(e: React.MouseEvent, id: number): void
  onLine(id: number): void
}

const Row = memo(function Row(p: RowProps): React.JSX.Element {
  return (
    <div
      data-id={p.id}
      className={`blame-line tl-line${p.commit ? ' first' : ''}${p.ghost ? ' ghost' : ''}${
        p.anchored ? ' anchored' : ''
      }${p.hit ? ` hit${p.hit === 'here' ? ' hit-here' : ''}` : ''}`}
      style={{ '--recency': p.recent } as React.CSSProperties}
    >
      <span
        className="blame-gutter"
        style={{
          borderLeftColor: p.ghost
            ? 'transparent'
            : `color-mix(in srgb, var(--accent) ${Math.round(p.recent * 100)}%, transparent)`
        }}
        title={p.ghost ? 'Removed by this commit' : 'Click to go to the commit of this line'}
        onClick={() => !p.ghost && p.onGutter(p.id)}
        onContextMenu={(e) => !p.ghost && p.onGutterMenu(e, p.id)}
      >
        {p.commit &&
          (p.commit.hash ? (
            <>
              <span className="blame-summary">{p.commit.subject}</span>
              <span className="blame-meta">
                {p.commit.authorName} · {formatDate(p.commit.authorDate, dayFormat)}
              </span>
            </>
          ) : (
            <span className="blame-summary muted">Uncommitted changes</span>
          ))}
      </span>
      <span
        className="diff-no blame-no"
        title={p.ghost ? undefined : 'Click to anchor this line while you scrub'}
        onClick={() => !p.ghost && p.onLine(p.id)}
      >
        {p.lineNo ?? ''}
      </span>
      <span
        className="diff-code"
        onClick={() => !p.ghost && window.getSelection()?.isCollapsed && p.onLine(p.id)}
        dangerouslySetInnerHTML={{ __html: p.html || ' ' }}
      />
    </div>
  )
})

function Toggle({
  on,
  icon,
  label,
  title,
  onClick
}: {
  on: boolean
  icon: React.ReactNode
  label: string
  title: string
  onClick(): void
}): React.JSX.Element {
  return (
    <button
      className={`btn btn-small${on ? ' active' : ''}`}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {icon} {label}
    </button>
  )
}

export default function FileTimelapse({
  snapshot,
  inspect
}: {
  snapshot: RepoSnapshot
  inspect: FileInspect
}): React.JSX.Element {
  const repo = snapshot.path
  const path = inspect.path
  // Read again after a commit, a change to the file or a new tag
  const tags = snapshot.refs.filter((r) => r.type === 'tag').map((r) => `${r.name}:${r.hash}`)
  const result = useLoaded(
    `${path}\0${snapshot.head.hash}\0${JSON.stringify(snapshot.status)}\0${tags.join()}`,
    () => window.api.op(repo, 'timelapse', path)
  )

  if (!result) return <div className="center-message">Reading every version of the file…</div>
  if (!result.ok) return <div className="banner-error">{result.error}</div>
  return <TimelapseView snapshot={snapshot} inspect={inspect} t={result.value} />
}

function TimelapseView({
  snapshot,
  inspect,
  t
}: {
  snapshot: RepoSnapshot
  inspect: FileInspect
  t: Timelapse
}): React.JSX.Element {
  const { inspectFile, select } = useApp()
  const repo = snapshot.path
  const last = t.revisions.length - 1
  const indexOf = (hash: string | null): number => {
    const found = hash === null ? -1 : t.revisions.findIndex((r) => r.hash === hash)
    return found >= 0 ? found : last
  }

  // The version shown and the bookmark, by hash: they stay put when the file is read again
  const [at, setAt] = useState<string | null>(inspect.rev)
  const [bookmarkAt, setBookmark] = useState<string | null>(null)
  const [anchorId, setAnchor] = useState<number | null>(null)
  const [view, setViewState] = useState(savedView)
  const [term, setTerm] = useState('')
  const step = indexOf(at)
  const shown = t.revisions[step]
  const bookmark = bookmarkAt === null ? null : indexOf(bookmarkAt)
  const anchor = anchorId !== null && anchorId < t.text.length ? anchorId : null

  const setView = (change: Partial<View>): void => {
    const next = { ...view, ...change }
    setViewState(next)
    localStorage.setItem(VIEW_KEY, JSON.stringify(next))
  }

  const lower = useMemo(() => t.text.map((s) => s.toLowerCase()), [t])
  // Each row with its line number, and the commit beside the first line of each run
  const rows = useMemo(() => {
    const numbered: (TimelapseRow & { born: number; first: boolean; lineNo: number | null })[] = []
    let lineNo = 0
    let previous = -1
    for (const row of frameRows(t, step, view.ghosts)) {
      const born = row.ghost ? -1 : t.born[row.id]
      numbered.push({
        ...row,
        born,
        first: !row.ghost && born !== previous,
        lineNo: row.ghost ? null : ++lineNo
      })
      previous = born
    }
    return numbered
  }, [t, step, view.ghosts])
  const matches = useMemo(
    () => searchSteps(t, lower, term, view.filters),
    [t, lower, term, view.filters]
  )
  const anchorSteps = useMemo(() => (anchor === null ? null : stepsWith(t, anchor)), [t, anchor])
  const tagsByStep = useMemo(() => {
    const steps = new Map<number, string[]>()
    for (const tag of t.tags) {
      const s = t.revisions.findIndex((r) => r.hash === tag.hash)
      if (s >= 0) steps.set(s, [...(steps.get(s) ?? []), tag.name])
    }
    return steps
  }, [t])

  // Moving to another version keeps a line where it was on screen: the anchored one, else the
  // first one in view
  const body = useRef<HTMLDivElement>(null)
  const keep = useRef<{ id: number; offset: number } | null>(null)
  const reveal = useRef(false)
  const capture = (): void => {
    const el = body.current
    if (!el) return
    const lineRow = (id: number): HTMLElement | null =>
      el.querySelector(`.tl-line[data-id="${id}"]:not(.ghost)`)
    let row = anchor !== null ? lineRow(anchor) : null
    if (!row) {
      const all = el.querySelectorAll<HTMLElement>('.tl-line:not(.ghost)')
      row = [...all].find((r) => r.offsetTop + r.offsetHeight > el.scrollTop) ?? null
    }
    keep.current = row ? { id: Number(row.dataset.id), offset: row.offsetTop - el.scrollTop } : null
  }
  useLayoutEffect(() => {
    const el = body.current
    const k = keep.current
    keep.current = null
    if (!el) return
    if (k) {
      const row = el.querySelector<HTMLElement>(`.tl-line[data-id="${k.id}"]:not(.ghost)`)
      if (row) el.scrollTop = row.offsetTop - k.offset
    }
    // After a jump to a search match: the change it found, if out of sight
    if (reveal.current) {
      reveal.current = false
      const hit = el.querySelector<HTMLElement>('.tl-line.hit-here')
      if (hit && (hit.offsetTop < el.scrollTop || hit.offsetTop > el.scrollTop + el.clientHeight))
        el.scrollTop = hit.offsetTop - el.clientHeight / 3
    }
  }, [step, view.ghosts])

  const go = (to: number, toMatch = false): void => {
    const target = Math.max(0, Math.min(last, to))
    if (target === step) return
    capture()
    reveal.current = toMatch
    setAt(t.revisions[target].hash)
  }

  // The detail panel and the other views follow, once the timeline stops
  useEffect(() => {
    const timer = setTimeout(() => {
      select(shown.hash || WIP_HASH)
      const rev = shown.hash && !shown.deleted ? shown.hash : null
      if (rev !== inspect.rev) inspectFile({ ...inspect, rev, revPath: undefined, line: undefined })
    }, 300)
    return () => clearTimeout(timer)
    // Only when the version changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.hash])

  const goToMatch = (back: boolean): void => {
    if (!matches.length) return
    const next = nextStep(matches, step, back) ?? (back ? matches[matches.length - 1] : matches[0])
    go(next, true)
  }
  const toggleBookmark = (): void => setBookmark(bookmark === step ? null : shown.hash)
  const swapBookmark = (): void => {
    if (bookmark === null || bookmark === step) return
    setBookmark(shown.hash)
    go(bookmark)
  }
  // The bookmark against the version shown, else the version before it
  const otherSide = bookmark !== null && bookmark !== step ? bookmark : step - 1
  const [older, newer] = [Math.min(otherSide, step), Math.max(otherSide, step)]
  const comparable = older >= 0 && t.revisions[older].hash !== '' && t.revisions[newer].hash !== ''
  const compare = (): void => {
    if (!comparable) return
    void openDiffTool(
      repo,
      { kind: 'compare', from: t.revisions[older].hash, to: t.revisions[newer].hash },
      t.path
    )
  }

  const toggleAnchor = (id: number): void => setAnchor(anchor === id ? null : id)
  const goToLine = (id: number): void => go(t.born[id])
  const lineMenu = (e: React.MouseEvent, id: number): void => {
    const r = t.revisions[t.born[id]]
    const items: MenuItem[] = [{ label: 'Go to this commit', onClick: () => goToLine(id) }]
    if (r.hash)
      items.push(
        {
          label: 'Blame at this commit',
          onClick: () => inspectFile({ path: t.path, mode: 'blame', rev: r.hash })
        },
        { label: 'Show commit in graph', onClick: () => showInGraph(r.hash) },
        'separator',
        { label: 'Copy commit hash', onClick: () => copyHash(r.hash) }
      )
    openMenu(e, items)
  }

  // Keys, while the time-lapse has the focus or nothing has
  const root = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const onKey = (e: KeyboardEvent): boolean => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    switch (key) {
      case 'ArrowLeft':
        go(step - (e.shiftKey ? 10 : 1))
        return true
      case 'ArrowRight':
        go(step + (e.shiftKey ? 10 : 1))
        return true
      case 'Home':
        go(0)
        return true
      case 'End':
        go(last)
        return true
      case 'F3':
        goToMatch(e.shiftKey)
        return true
      case 'r':
        setView({ recency: !view.recency })
        return true
      case 'g':
        capture()
        setView({ ghosts: !view.ghosts })
        return true
      case 'x':
        setView({ tags: !view.tags })
        return true
      case 'm':
        toggleBookmark()
        return true
      case "'":
      case '`':
        swapBookmark()
        return true
      case '/':
        searchRef.current?.focus()
        return true
      case 'Escape':
        if (anchor === null) return false
        setAnchor(null)
        return true
    }
    return false
  }
  const keyHandler = useRef(onKey)
  useEffect(() => {
    keyHandler.current = onKey
  })
  useEffect(() => {
    // Before the window's other listeners, which would close the inspector on Escape
    const listener = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || fromTerminal(e)) return
      if (document.querySelector('.modal, .menu, .palette')) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (target && target !== document.body && !root.current?.contains(target)) return
      if (keyHandler.current(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])
  useShortcut('search', () => {
    searchRef.current?.focus()
    searchRef.current?.select()
  })

  const needle = term.trim().toLowerCase()
  const matchIndex = matches.indexOf(step)
  const stepTags = view.tags ? tagsByStep.get(step) : undefined
  const filterButton = (
    key: keyof TimelapseFilters,
    icon: React.ReactNode,
    title: string
  ): React.ReactNode => (
    <button
      className={`graph-tool${view.filters[key] ? ' active' : ''}`}
      aria-pressed={view.filters[key]}
      title={title}
      onClick={() => setView({ filters: { ...view.filters, [key]: !view.filters[key] } })}
    >
      {icon}
    </button>
  )

  return (
    <div className="timelapse" ref={root}>
      <div className="diff-hint timelapse-bar">
        <div className={`graph-search${needle ? ' active' : ''}`}>
          <Search size={14} className="muted" />
          <input
            ref={searchRef}
            placeholder="Search the history of the file (/)"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'F3') {
                e.preventDefault()
                goToMatch(e.shiftKey)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setTerm('')
                e.currentTarget.blur()
              }
            }}
          />
          {filterButton(
            'added',
            <Plus size={14} />,
            'Search the lines each commit added or changed'
          )}
          {filterButton('removed', <Minus size={14} />, 'Search the lines each commit removed')}
          {filterButton(
            'commits',
            <MessageSquare size={14} />,
            'Search the message, author and hash of each commit'
          )}
          {needle && (
            <>
              <span className="graph-search-count">
                {matches.length
                  ? `${matchIndex >= 0 ? matchIndex + 1 : '–'} of ${matches.length}`
                  : 'No commits'}
              </span>
              <button
                className="graph-tool"
                title="Previous matching commit (Shift+Enter, Shift+F3)"
                disabled={!matches.length}
                onClick={() => goToMatch(true)}
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="graph-tool"
                title="Next matching commit (Enter, F3)"
                disabled={!matches.length}
                onClick={() => goToMatch(false)}
              >
                <ChevronDown size={14} />
              </button>
            </>
          )}
        </div>
        <div className="timelapse-tools">
          <Toggle
            on={view.recency}
            icon={<Flame size={13} />}
            label="Recency"
            title="Tint the lines by how recently they changed (R)"
            onClick={() => setView({ recency: !view.recency })}
          />
          <Toggle
            on={view.ghosts}
            icon={<Ghost size={13} />}
            label="Removed"
            title="Show the lines each commit removed (G)"
            onClick={() => {
              capture()
              setView({ ghosts: !view.ghosts })
            }}
          />
          <Toggle
            on={view.tags}
            icon={<Tag size={13} />}
            label="Tags"
            title="Show the tags on the timeline (X)"
            onClick={() => setView({ tags: !view.tags })}
          />
          <Toggle
            on={bookmark === step}
            icon={<Bookmark size={13} />}
            label="Bookmark"
            title={
              bookmark === step
                ? 'Remove the bookmark (M)'
                : 'Bookmark this version, to come back to it (M)'
            }
            onClick={toggleBookmark}
          />
          <button
            className="btn btn-small"
            disabled={bookmark === null || bookmark === step}
            title="Go to the bookmark, and bookmark this version (')"
            onClick={swapBookmark}
          >
            <ArrowLeftRight size={13} />
          </button>
          <button
            className="btn btn-small"
            disabled={!comparable}
            title={
              comparable
                ? bookmark !== null && bookmark !== step
                  ? 'Open the bookmarked version and this one in the diff tool'
                  : 'Open this version and the one before it in the diff tool'
                : 'Uncommitted changes can’t be opened in the diff tool from here'
            }
            onClick={compare}
          >
            <GitCompare size={13} /> Diff tool
          </button>
        </div>
      </div>
      {t.truncated && (
        <div className="diff-hint">
          Showing the latest {t.revisions.length} versions: older lines count as added by the oldest
          one.
        </div>
      )}
      <div className="diff-body blame-body tl-body" ref={body}>
        {rows.length === 0 ? (
          <div className="center-message">
            {shown.deleted ? 'This commit deleted the file' : 'Empty file in this version'}
          </div>
        ) : (
          <div className="blame-lines">
            {rows.map((row) => {
              const contains = needle !== '' && lower[row.id].includes(needle)
              return (
                <Row
                  key={(row.ghost ? 'g' : '') + row.id}
                  id={row.id}
                  ghost={row.ghost}
                  commit={row.first ? t.revisions[row.born] : null}
                  lineNo={row.lineNo}
                  html={htmlOf(t, row.id)}
                  recent={view.recency && !row.ghost ? recency(step - row.born) : 0}
                  anchored={row.id === anchor && !row.ghost}
                  hit={contains ? (row.ghost || row.born === step ? 'here' : 'any') : ''}
                  onGutter={goToLine}
                  onGutterMenu={lineMenu}
                  onLine={toggleAnchor}
                />
              )
            })}
          </div>
        )}
      </div>
      <div className="timelapse-status">
        <span className="timelapse-position">
          {shown.hash ? `Commit ${step + 1} of ${t.revisions.length}` : 'Uncommitted changes'}
        </span>
        {shown.hash && (
          <>
            <span className="mono muted">{shown.hash.slice(0, 7)}</span>
            <span className="timelapse-subject" title={shown.subject}>
              {shown.subject}
            </span>
            <span className="muted">
              {shown.authorName} · {formatDate(shown.authorDate)}
            </span>
          </>
        )}
        {stepTags && (
          <span className="timelapse-tags">
            <Tag size={12} /> {stepTags.join(', ')}
          </span>
        )}
        {anchor !== null && anchorSteps && !anchorSteps[step] && (
          <span className="timelapse-note">The anchored line isn’t in this version</span>
        )}
      </div>
      <TimelapseTrack
        count={t.revisions.length}
        current={step}
        onChange={go}
        anchor={anchorSteps}
        matches={matches}
        tags={view.tags ? tagsByStep : null}
        bookmark={bookmark}
        titleOf={(s) => revisionTitle(t.revisions[s])}
      />
      <div className="diff-hint timelapse-keys">
        {withShortcut(
          '← → step (Shift: ten), Home / End · click a line to anchor it, a commit beside it to go there · search',
          'search'
        )}
      </div>
    </div>
  )
}
