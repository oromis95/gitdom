import { create } from 'zustand'
import { notify } from './ui'
import { tipAfter } from './tips'
import type { DiffSource, GraphFilter, RepoSnapshot } from '../../shared/types'
import type { OpProgress } from '../../shared/api'
import { storage } from './storage'
import { samePath } from './worktrees'

export const WIP_HASH = 'WIP'

export interface RepoTab {
  path: string
  name: string
  snapshot?: RepoSnapshot
  loading: boolean
  /**
   * Shown while a repository is being opened, before its root is known: its path is the folder
   * picked, which may be a subfolder or another repository's already open tab
   */
  opening?: boolean
  error?: string
  /** Selected commit hash, or WIP_HASH for the working tree */
  selected: string | null
  /** Two revisions whose changed files replace the commit detail (DIFF-08) */
  compare?: CompareTarget
  /** File whose diff replaces the graph, when open */
  diff?: DiffTarget
  /** File whose history or blame replaces the graph; an open diff still takes precedence */
  inspect?: FileInspect
  /** Reflog or backups listed instead of the graph (ADV-05, NFR-04) */
  recovery?: RecoveryView
  /** Repository statistics shown instead of the graph */
  statistics?: boolean
  /** Label of the long-running operation in progress (fetch, push…) */
  busy?: string
  /** What git reported of that operation's progress, when it reports any (push) */
  progress?: OpProgress
  /** The next page of commits is being loaded (GRAPH-08) */
  loadingMore?: boolean
  draft: CommitDraft
}

export interface DiffTarget {
  source: DiffSource
  path: string
  oldPath?: string
  /** Conflicted file shown in the merge tool instead of the diff */
  merge?: boolean
}

export interface CompareTarget {
  /** Revisions as the user picked them: hashes, branch or tag names */
  from: string
  to: string
}

export interface FileInspect {
  /** Path in the working tree, or in the commit the file was opened from */
  path: string
  /**
   * The file, commits that changed it, who last changed each line, the history of some lines, or
   * every version of the file to drag through
   */
  mode: 'file' | 'history' | 'blame' | 'lines' | 'timelapse'
  /** Commit to show or blame at, and the revision selected in the history; null for the working tree */
  rev: string | null
  /** Path of the file at `rev`, when it was renamed since */
  revPath?: string
  /** Lines followed in 'lines' mode: "start,end" or ":function", numbered as in `rev` */
  range?: string
  /** Line to show in the blame, numbered as in `rev` */
  line?: number
  /** Versions the blame went back in time from, the latest last, to return to them */
  back?: BlameStep[]
}

/** A version of a file the blame was showing, and the line it was at */
export interface BlameStep {
  rev: string | null
  revPath?: string
  line?: number
}

export type RecoveryView = 'reflog' | 'backups'

export interface CommitDraft {
  summary: string
  description: string
  amend: boolean
  /** Skip the commit hooks (COMMIT-09) */
  noVerify: boolean
  /** Sign or not; null follows commit.gpgsign */
  sign: boolean | null
  /** Another author, as "Name <email>"; empty for the identity */
  author: string
}

export const EMPTY_DRAFT: CommitDraft = {
  summary: '',
  description: '',
  amend: false,
  noVerify: false,
  sign: null,
  author: ''
}

export const NO_GRAPH_FILTER: GraphFilter = { hidden: [], solo: null }

interface ScrollRequest {
  hash: string
  nonce: number
}

interface AppState {
  tabs: RepoTab[]
  active: number
  recent: string[]
  /** Pinned repositories, shown before the recent ones (REPO-05) */
  favorites: string[]
  scrollRequest: ScrollRequest | null
  /** Branches hidden from the graph, or shown alone, per repository path (GRAPH-14) */
  graphFilters: Record<string, GraphFilter>

  pickAndOpen(): Promise<void>
  openRepo(path: string): Promise<void>
  closeTab(index: number): void
  /** Closes the tabs of these repositories, keeping the active one if it stays open */
  closeTabs(paths: string[]): void
  /** Opens several repositories at once, e.g. a workspace; `replace` closes the other tabs. */
  openTabs(paths: string[], replace: boolean): void
  toggleFavorite(path: string): void
  /** Forgets a repository from the recent and favorite lists, e.g. once it's deleted. */
  forgetRepo(path: string): void
  setActive(index: number): void
  refresh(index?: number): Promise<void>
  /** Reloads the snapshot of the repository at `path`, if open. */
  refreshPath(path: string): Promise<void>
  /** Reloads only the working tree status: cheap, for file edits. */
  refreshStatus(path: string): Promise<void>
  /** Appends the next page of commits to the graph, when there are older ones (GRAPH-08). */
  loadMoreCommits(path: string): Promise<void>
  select(hash: string | null, scrollIntoView?: boolean): void
  openDiff(target: DiffTarget | null): void
  /** Lists the files changed between two revisions in the detail panel; selecting a commit ends it. */
  compare(target: CompareTarget | null): void
  /** Shows the history or blame of a file, closing the diff. */
  inspectFile(inspect: FileInspect | null): void
  /** Lists the reflog or the backups in place of the graph, closing the diff and the inspector. */
  openRecovery(view: RecoveryView | null): void
  /** Shows or hides the repository statistics in place of the graph. */
  openStatistics(open: boolean): void
  setDraft(path: string, draft: Partial<CommitDraft>): void
  setBusy(path: string, busy: string | undefined): void
  /** Progress of the running operation, ignored once it has finished */
  setProgress(path: string, progress: OpProgress): void
  /** Changes the branches the graph shows and reloads it. */
  setGraphFilter(path: string, filter: GraphFilter): void
}

const TABS_KEY = 'gitdom.tabs'
const RECENT_KEY = 'gitdom.recent'
const FAVORITES_KEY = 'gitdom.favorites'
const GRAPH_FILTERS_KEY = 'gitdom.graphFilters'
const MAX_RECENT = 10

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function persist(tabs: RepoTab[], active: number): void {
  // A tab still opening may not be a repository at all: it is saved once it is
  const kept = tabs.filter((t) => !t.opening)
  const index = Math.max(0, kept.indexOf(tabs[active]))
  storage.setItem(TABS_KEY, JSON.stringify({ paths: kept.map((t) => t.path), active: index }))
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export const useApp = create<AppState>((set, get) => {
  const updateTab = (path: string, patch: Partial<RepoTab>): void =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, ...patch } : t)) }))

  // A reload requested while one is running is queued, not dropped: the running one may miss the change
  const loading = new Set<string>()
  const pending = new Set<string>()
  // Commits the graph has loaded per tab, beyond the first page: reloads keep them all
  const limits = new Map<string, number>()

  const load = async (path: string): Promise<void> => {
    // openRepo loads it, and replaces it with the repository's real tab
    if (get().tabs.find((t) => t.path === path)?.opening) return
    if (loading.has(path)) {
      pending.add(path)
      return
    }
    loading.add(path)
    updateTab(path, { loading: true })
    try {
      // Filters are saved under the repository root, which a tab's path may spell differently
      const root = get().tabs.find((t) => t.path === path)?.snapshot?.path ?? path
      const result = await window.api.openRepository(
        path,
        get().graphFilters[root],
        limits.get(path)
      )
      if (result.ok) {
        updateTab(path, { loading: false, error: undefined, snapshot: result.value })
      } else {
        updateTab(path, { loading: false, error: result.error })
      }
    } finally {
      loading.delete(path)
      if (pending.delete(path)) void load(path)
    }
  }

  return {
    tabs: [],
    active: 0,
    recent: readJson<string[]>(RECENT_KEY, []),
    favorites: readJson<string[]>(FAVORITES_KEY, []),
    scrollRequest: null,
    graphFilters: readJson<Record<string, GraphFilter>>(GRAPH_FILTERS_KEY, {}),

    async pickAndOpen() {
      const path = await window.api.pickRepository()
      if (path) await get().openRepo(path)
    },

    async openRepo(requested) {
      const open = get().tabs.findIndex((t) => samePath(t.path, requested))
      if (open >= 0) {
        get().setActive(open)
        if (!get().tabs[open].opening) await load(get().tabs[open].path)
        return
      }
      // A tab right away, loading: big histories take seconds to read
      const previous = get().tabs[get().active]
      const placeholder: RepoTab = {
        path: requested,
        name: baseName(requested),
        loading: true,
        opening: true,
        selected: null,
        draft: EMPTY_DRAFT
      }
      set((s) => ({ tabs: [...s.tabs, placeholder], active: s.tabs.length }))

      // Resolve to the repository root first so the same repo is never opened twice
      const result = await window.api.openRepository(requested, get().graphFilters[requested])
      const withoutPlaceholder = get().tabs.filter((t) => t !== placeholder)
      const focused = get().tabs[get().active]
      if (!result.ok) {
        notify('error', result.error)
        const back = focused === placeholder ? previous : focused
        set({ tabs: withoutPlaceholder, active: Math.max(0, withoutPlaceholder.indexOf(back!)) })
        return
      }
      if (!get().tabs.includes(placeholder)) return // closed while it was opening
      const snapshot = result.value
      const recent = [snapshot.path, ...get().recent.filter((p) => p !== snapshot.path)].slice(
        0,
        MAX_RECENT
      )
      storage.setItem(RECENT_KEY, JSON.stringify(recent))

      const existing = withoutPlaceholder.find((t) => t.path === snapshot.path)
      if (existing) {
        // A subfolder of a repository already open: its tab, refreshed
        set({ tabs: withoutPlaceholder, active: withoutPlaceholder.indexOf(existing), recent })
        updateTab(snapshot.path, { snapshot, error: undefined })
      } else {
        const tab: RepoTab = {
          path: snapshot.path,
          name: snapshot.name,
          snapshot,
          loading: false,
          selected: null,
          draft: EMPTY_DRAFT
        }
        const tabs = get().tabs.map((t) => (t === placeholder ? tab : t))
        set({ tabs, active: tabs.indexOf(focused === placeholder ? tab : focused), recent })
      }
      persist(get().tabs, get().active)
    },

    toggleFavorite(path) {
      const { favorites } = get()
      const next = favorites.includes(path)
        ? favorites.filter((p) => p !== path)
        : [...favorites, path]
      storage.setItem(FAVORITES_KEY, JSON.stringify(next))
      set({ favorites: next })
    },

    forgetRepo(path) {
      const recent = get().recent.filter((p) => p !== path)
      const favorites = get().favorites.filter((p) => p !== path)
      storage.setItem(RECENT_KEY, JSON.stringify(recent))
      storage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
      set({ recent, favorites })
    },

    openTabs(paths, replace) {
      if (!paths.length) return
      const kept = replace ? get().tabs.filter((t) => paths.includes(t.path)) : get().tabs
      const added: RepoTab[] = paths
        .filter((path) => !kept.some((t) => t.path === path))
        .map((path) => ({
          path,
          name: baseName(path),
          loading: false,
          selected: null,
          draft: EMPTY_DRAFT
        }))
      const tabs = [...kept, ...added]
      const active = tabs.findIndex((t) => t.path === paths[0])
      set({ tabs, active })
      persist(tabs, active)
      added.forEach((t) => void load(t.path))
    },

    closeTab(index) {
      const closed = get().tabs[index]
      if (closed) get().closeTabs([closed.path])
    },

    closeTabs(paths) {
      const before = get().tabs
      const current = get().active
      paths.forEach((p) => limits.delete(p))
      const tabs = before.filter((t) => !paths.includes(t.path))
      // The active tab if it stays, else the nearest one still open after it, else before it
      const after = before.slice(current).find((t) => tabs.includes(t))
      const prior = before
        .slice(0, current)
        .reverse()
        .find((t) => tabs.includes(t))
      const active = Math.max(0, tabs.indexOf((after ?? prior)!))
      set({ tabs, active })
      persist(tabs, active)
    },

    setActive(index) {
      set({ active: index })
      persist(get().tabs, index)
      // A restored tab not loaded yet
      const tab = get().tabs[index]
      if (tab && !tab.snapshot && !tab.loading && !tab.error) void load(tab.path)
    },

    async refresh(index) {
      const tab = get().tabs[index ?? get().active]
      if (tab) await load(tab.path)
    },

    async refreshPath(path) {
      if (get().tabs.some((t) => t.path === path)) await load(path)
    },

    async loadMoreCommits(path) {
      const tab = get().tabs.find((t) => t.path === path)
      const before = tab?.snapshot
      if (!tab || !before?.truncated || tab.loadingMore) return
      updateTab(path, { loadingMore: true })
      try {
        const filter = get().graphFilters[before.path]
        const result = await window.api.op(path, 'moreCommits', before.commits.length, filter)
        if (!result.ok) {
          notify('error', result.error, result.details)
          return
        }
        const current = get().tabs.find((t) => t.path === path)?.snapshot
        // A reload in the meantime may have brought these commits already
        if (!current || current.commits.length > before.commits.length) return
        const known = new Set(current.commits.map((c) => c.hash))
        const commits = [
          ...current.commits,
          ...result.value.commits.filter((c) => !known.has(c.hash))
        ]
        limits.set(path, commits.length)
        updateTab(path, { snapshot: { ...current, commits, truncated: result.value.more } })
      } finally {
        updateTab(path, { loadingMore: false })
      }
    },

    async refreshStatus(path) {
      // A full reload in progress already includes the status
      if (loading.has(path)) return
      const result = await window.api.op(path, 'status')
      const tab = get().tabs.find((t) => t.path === path)
      if (result.ok && tab?.snapshot && !loading.has(path)) {
        updateTab(path, { snapshot: { ...tab.snapshot, status: result.value } })
      }
    },

    select(hash, scrollIntoView = false) {
      const tab = get().tabs[get().active]
      if (!tab) return
      updateTab(tab.path, { selected: hash, compare: undefined })
      if (scrollIntoView && hash) set({ scrollRequest: { hash, nonce: Date.now() } })
    },

    openDiff(target) {
      const tab = get().tabs[get().active]
      if (tab) updateTab(tab.path, { diff: target ?? undefined })
      if (target?.source.kind === 'commit') tipAfter('commitDiff')
    },

    compare(target) {
      const tab = get().tabs[get().active]
      if (tab) updateTab(tab.path, { compare: target ?? undefined, diff: undefined })
    },

    inspectFile(inspect) {
      const tab = get().tabs[get().active]
      if (inspect) tipAfter(inspect.mode)
      if (tab) {
        updateTab(tab.path, {
          inspect: inspect ?? undefined,
          diff: undefined,
          recovery: undefined,
          statistics: undefined
        })
      }
    },

    openRecovery(view) {
      const tab = get().tabs[get().active]
      if (tab) {
        updateTab(tab.path, {
          recovery: view ?? undefined,
          diff: undefined,
          inspect: undefined,
          statistics: undefined
        })
      }
    },

    openStatistics(open) {
      const tab = get().tabs[get().active]
      if (tab) {
        updateTab(tab.path, {
          statistics: open || undefined,
          diff: undefined,
          inspect: undefined,
          recovery: undefined
        })
      }
    },

    setDraft(path, draft) {
      const tab = get().tabs.find((t) => t.path === path)
      if (tab) updateTab(path, { draft: { ...tab.draft, ...draft } })
    },

    setBusy(path, busy) {
      updateTab(path, { busy, progress: undefined })
    },

    setProgress(path, progress) {
      if (get().tabs.find((t) => t.path === path)?.busy) updateTab(path, { progress })
    },

    setGraphFilter(path, filter) {
      const graphFilters = { ...get().graphFilters }
      if (filter.solo || filter.hidden.length) graphFilters[path] = filter
      else delete graphFilters[path]
      storage.setItem(GRAPH_FILTERS_KEY, JSON.stringify(graphFilters))
      set({ graphFilters })
      for (const tab of get().tabs) {
        if (tab.path !== path && tab.snapshot?.path !== path) continue
        // Another set of branches starts again from the first page
        limits.delete(tab.path)
        void load(tab.path)
      }
    }
  }
})

/** Reopens the tabs of the previous session. */
export function restoreSession(): void {
  const saved = readJson<{ paths: string[]; active: number } | null>(TABS_KEY, null)
  if (!saved?.paths.length) return
  const tabs: RepoTab[] = saved.paths.map((path) => ({
    path,
    name: baseName(path),
    loading: false,
    selected: null,
    draft: EMPTY_DRAFT
  }))
  const active = Math.min(saved.active, tabs.length - 1)
  useApp.setState({ tabs, active })
  // The tab on screen first; then the others one at a time when the app is idle (a tab opened in
  // the meantime loads right away, see setActive): all at once would start dozens of git processes
  const { refresh } = useApp.getState()
  void refresh(active).finally(async () => {
    for (const { path } of tabs) {
      await new Promise((done) => requestIdleCallback(done, { timeout: 2000 }))
      const index = useApp.getState().tabs.findIndex((t) => t.path === path)
      const tab = useApp.getState().tabs[index]
      if (tab && !tab.snapshot && !tab.loading && !tab.error) await refresh(index)
    }
  })
}

export function useActiveTab(): RepoTab | undefined {
  return useApp((s) => s.tabs[s.active])
}
