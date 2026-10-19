// State of the graph that lives apart from its rows: the search, the commits being dragged to
// reorder them, and the canvas the lanes are drawn on.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Commit, GraphFilter, RepoSnapshot } from '../../../../shared/types'
import type { GraphLayout } from '../../graph/layout'
import { drawGraph, graphWidth, type NodeInfo } from '../../graph/draw'
import type { GraphItem } from '../../graph/rows'
import { matchesCommit, searchKey, type SearchMode } from '../../graph/search'
import type { ChainHighlight } from '../../graph/highlight'
import { avatarImage, onAvatarLoaded } from '../../graph/avatars'
import { useTheme } from '../../theme'
import { rowKey } from './shared'

/** Pause in typing before git searches messages or files */
const SEARCH_DELAY = 250
/** Searching the code diffs every commit: wait for a pause in the typing */
const CODE_SEARCH_DELAY = 600

export interface GraphSearch {
  text: string
  setText(text: string): void
  mode: SearchMode
  setMode(mode: SearchMode): void
  /** In the code: changed lines matching a regular expression, instead of the text coming or going */
  regex: boolean
  setRegex(regex: boolean): void
  /** What is searched, as typed for the code and normalized otherwise; '' for no search */
  key: string
  /** The rows found, null without a search */
  matched: Set<string> | null
  /** Git is still looking */
  searching: boolean
  error?: string
}

/** The search of the graph (GRAPH-17): commits matched here, and those git finds. */
export function useGraphSearch(
  repo: string,
  commits: Commit[],
  graphFilter: GraphFilter | undefined,
  allRows: GraphItem[]
): GraphSearch {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<SearchMode>('commit')
  const [regex, setRegex] = useState(false)
  /** What git found for a query: full messages or changed files */
  const [found, setFound] = useState<{
    query: string
    hashes: Set<string>
    error?: string
  } | null>(null)

  // Code keeps its case: git ignores it anyway, and a regex like \S depends on it
  const key = mode === 'code' ? text.trim() : searchKey(text)
  const codeField = regex ? 'regex' : 'code'
  const query = `${mode === 'code' ? codeField : mode}:${key}`
  // Single letters are matched here only: every message has some
  const asksGit = key !== '' && (mode === 'file' || key.length > 1)

  useEffect(() => {
    if (!asksGit) return
    let stale = false
    const timer = setTimeout(
      async () => {
        const field = mode === 'commit' ? 'message' : mode === 'file' ? 'file' : codeField
        const result = await window.api.op(repo, 'searchCommits', field, key, graphFilter)
        if (stale) return
        setFound(
          result.ok
            ? { query, hashes: new Set(result.value) }
            : { query, hashes: new Set(), error: result.error }
        )
      },
      mode === 'code' ? CODE_SEARCH_DELAY : SEARCH_DELAY
    )
    return () => {
      stale = true
      clearTimeout(timer)
      if (mode === 'code') void window.api.op(repo, 'cancelSearch')
    }
  }, [asksGit, repo, commits, graphFilter, key, mode, codeField, query])

  const matched = useMemo<Set<string> | null>(() => {
    if (!key) return null
    const fromGit = found?.query === query ? found.hashes : undefined
    const hits = new Set<string>()
    for (const row of allRows) {
      if (row.kind === 'commit') {
        if ((mode === 'commit' && matchesCommit(row.commit, key)) || fromGit?.has(row.commit.hash))
          hits.add(row.commit.hash)
      } else if (row.kind === 'stash' && mode === 'commit') {
        if (row.stash.message.toLowerCase().includes(key)) hits.add(row.stash.hash)
      }
    }
    return hits
  }, [allRows, key, query, mode, found])

  return {
    text,
    setText,
    mode,
    setMode,
    regex,
    setRegex,
    key,
    matched,
    searching: asksGit && found?.query !== query,
    error: found?.query === query ? found.error : undefined
  }
}

export interface CommitReorder {
  /** The commits that can be moved, from HEAD back */
  movable: Commit[]
  movableIndex: Map<string, number>
  dragged: string | null
  setDragged(hash: string | null): void
  dropAt: { hash: string; after: boolean } | null
  setDropAt(at: { hash: string; after: boolean } | null): void
  endDrag(): void
}

/**
 * The commits that can be dragged to reorder them: the current branch from HEAD back to its last
 * merge, which a rebase would flatten.
 */
export function useCommitReorder(
  snapshot: RepoSnapshot,
  headShown: boolean,
  filtering: boolean
): CommitReorder {
  const headHash = snapshot.head.hash
  const movable = useMemo(() => {
    if (!snapshot.head.branch || !headShown || filtering || snapshot.operation) return []
    const byHash = new Map(snapshot.commits.map((c) => [c.hash, c]))
    const chain: Commit[] = []
    for (let c = byHash.get(headHash!); c && c.parents.length <= 1;) {
      chain.push(c)
      c = c.parents[0] ? byHash.get(c.parents[0]) : undefined
    }
    return chain.length > 1 ? chain : []
  }, [snapshot.head.branch, snapshot.operation, snapshot.commits, headShown, headHash, filtering])
  const movableIndex = useMemo(() => new Map(movable.map((c, i) => [c.hash, i])), [movable])
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ hash: string; after: boolean } | null>(null)
  const endDrag = (): void => {
    setDragged(null)
    setDropAt(null)
  }
  return { movable, movableIndex, dragged, setDragged, dropAt, setDropAt, endDrag }
}

/**
 * Draws the lanes and the nodes of the rows in view, again when anything they show changes; the
 * height of the scroller is followed for it.
 */
export function useGraphCanvas(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  options: {
    layout: GraphLayout
    nodes: (NodeInfo | null)[]
    rows: GraphItem[]
    scrollTop: number
    selectedRow: number
    chain: ChainHighlight | null
    matched: Set<string> | null
    filtering: boolean
    avatars: boolean
  }
): { canvasRef: React.RefObject<HTMLCanvasElement | null>; viewportHeight: number } {
  const { layout, nodes, rows, scrollTop, selectedRow, chain, matched, filtering, avatars } =
    options
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const theme = useTheme((s) => s.revision)
  const [viewportHeight, setViewportHeight] = useState(0)
  /** Bumped when an author picture arrives, to redraw the nodes */
  const [avatarTick, setAvatarTick] = useState(0)
  const width = graphWidth(layout.laneCount)

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
  }, [scrollerRef])

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

  return { canvasRef, viewportHeight }
}
