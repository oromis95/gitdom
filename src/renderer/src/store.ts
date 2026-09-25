import { create } from 'zustand'
import { notify } from './ui'
import type { DiffSource, GraphFilter, RepoSnapshot } from '../../shared/types'

export const WIP_HASH = 'WIP'

export interface RepoTab {
  path: string
  name: string
  snapshot?: RepoSnapshot
  loading: boolean
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
  /** Label of the long-running operation in progress (fetch, push…) */
  busy?: string
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
  mode: 'history' | 'blame'
  /** Commit to blame at, and the revision selected in the history; null for the working tree */
  rev: string | null
  /** Path of the file at `rev`, when it was renamed since */
  revPath?: string
}

export type RecoveryView = 'reflog' | 'backups'

export interface CommitDraft {
  summary: string
  description: string
  amend: boolean
}

const EMPTY_DRAFT: CommitDraft = { summary: '', description: '', amend: false }

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
  toggleFavorite(path: string): void
  /** Forgets a repository from the recent and favorite lists, e.g. once it's deleted. */
  forgetRepo(path: string): void
  setActive(index: number): void
  refresh(index?: number): Promise<void>
  /** Reloads the snapshot of the repository at `path`, if open. */
  refreshPath(path: string): Promise<void>
  /** Reloads only the working tree status: cheap, for file edits. */
  refreshStatus(path: string): Promise<void>
  select(hash: string | null, scrollIntoView?: boolean): void
  openDiff(target: DiffTarget | null): void
  /** Lists the files changed between two revisions in the detail panel; selecting a commit ends it. */
  compare(target: CompareTarget | null): void
  /** Shows the history or blame of a file, closing the diff. */
  inspectFile(inspect: FileInspect | null): void
  /** Lists the reflog or the backups in place of the graph, closing the diff and the inspector. */
  openRecovery(view: RecoveryView | null): void
  setDraft(path: string, draft: Partial<CommitDraft>): void
  setBusy(path: string, busy: string | undefined): void
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
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function persist(tabs: RepoTab[], active: number): void {
  localStorage.setItem(TABS_KEY, JSON.stringify({ paths: tabs.map((t) => t.path), active }))
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

  const load = async (path: string): Promise<void> => {
    if (loading.has(path)) {
      pending.add(path)
      return
    }
    loading.add(path)
    updateTab(path, { loading: true })
    try {
      // Filters are saved under the repository root, which a tab's path may spell differently
      const root = get().tabs.find((t) => t.path === path)?.snapshot?.path ?? path
      const result = await window.api.openRepository(path, get().graphFilters[root])
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
      // Resolve to the repository root first so the same repo is never opened twice
      const result = await window.api.openRepository(requested, get().graphFilters[requested])
      if (!result.ok) {
        notify('error', result.error)
        return
      }
      const snapshot = result.value
      const { tabs } = get()
      const existing = tabs.findIndex((t) => t.path === snapshot.path)
      const recent = [snapshot.path, ...get().recent.filter((p) => p !== snapshot.path)].slice(
        0,
        MAX_RECENT
      )
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent))

      if (existing >= 0) {
        set({ active: existing, recent })
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
        set({ tabs: [...tabs, tab], active: tabs.length, recent })
      }
      persist(get().tabs, get().active)
    },

    toggleFavorite(path) {
      const { favorites } = get()
      const next = favorites.includes(path)
        ? favorites.filter((p) => p !== path)
        : [...favorites, path]
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
      set({ favorites: next })
    },

    forgetRepo(path) {
      const recent = get().recent.filter((p) => p !== path)
      const favorites = get().favorites.filter((p) => p !== path)
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
      set({ recent, favorites })
    },

    closeTab(index) {
      const tabs = get().tabs.filter((_, i) => i !== index)
      const active = Math.max(
        0,
        Math.min(get().active > index ? get().active - 1 : get().active, tabs.length - 1)
      )
      set({ tabs, active })
      persist(tabs, active)
    },

    setActive(index) {
      set({ active: index })
      persist(get().tabs, index)
    },

    async refresh(index) {
      const tab = get().tabs[index ?? get().active]
      if (tab) await load(tab.path)
    },

    async refreshPath(path) {
      if (get().tabs.some((t) => t.path === path)) await load(path)
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
    },

    compare(target) {
      const tab = get().tabs[get().active]
      if (tab) updateTab(tab.path, { compare: target ?? undefined, diff: undefined })
    },

    inspectFile(inspect) {
      const tab = get().tabs[get().active]
      if (tab) {
        updateTab(tab.path, { inspect: inspect ?? undefined, diff: undefined, recovery: undefined })
      }
    },

    openRecovery(view) {
      const tab = get().tabs[get().active]
      if (tab) {
        updateTab(tab.path, { recovery: view ?? undefined, diff: undefined, inspect: undefined })
      }
    },

    setDraft(path, draft) {
      const tab = get().tabs.find((t) => t.path === path)
      if (tab) updateTab(path, { draft: { ...tab.draft, ...draft } })
    },

    setBusy(path, busy) {
      updateTab(path, { busy })
    },

    setGraphFilter(path, filter) {
      const graphFilters = { ...get().graphFilters }
      if (filter.solo || filter.hidden.length) graphFilters[path] = filter
      else delete graphFilters[path]
      localStorage.setItem(GRAPH_FILTERS_KEY, JSON.stringify(graphFilters))
      set({ graphFilters })
      for (const tab of get().tabs)
        if (tab.path === path || tab.snapshot?.path === path) void load(tab.path)
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
  useApp.setState({ tabs, active: Math.min(saved.active, tabs.length - 1) })
  tabs.forEach((_, i) => void useApp.getState().refresh(i))
}

export function useActiveTab(): RepoTab | undefined {
  return useApp((s) => s.tabs[s.active])
}
