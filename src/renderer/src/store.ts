import { create } from 'zustand'
import { notify } from './ui'
import type { DiffSource, RepoSnapshot } from '../../shared/types'

export const WIP_HASH = 'WIP'

export interface RepoTab {
  path: string
  name: string
  snapshot?: RepoSnapshot
  loading: boolean
  error?: string
  /** Selected commit hash, or WIP_HASH for the working tree */
  selected: string | null
  /** File whose diff replaces the graph, when open */
  diff?: DiffTarget
  /** File whose history or blame replaces the graph; an open diff still takes precedence */
  inspect?: FileInspect
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

export interface FileInspect {
  /** Path in the working tree, or in the commit the file was opened from */
  path: string
  mode: 'history' | 'blame'
  /** Commit to blame at, and the revision selected in the history; null for the working tree */
  rev: string | null
  /** Path of the file at `rev`, when it was renamed since */
  revPath?: string
}

export interface CommitDraft {
  summary: string
  description: string
  amend: boolean
}

const EMPTY_DRAFT: CommitDraft = { summary: '', description: '', amend: false }

interface ScrollRequest {
  hash: string
  nonce: number
}

interface AppState {
  tabs: RepoTab[]
  active: number
  recent: string[]
  scrollRequest: ScrollRequest | null

  pickAndOpen(): Promise<void>
  openRepo(path: string): Promise<void>
  closeTab(index: number): void
  setActive(index: number): void
  refresh(index?: number): Promise<void>
  /** Reloads the snapshot of the repository at `path`, if open. */
  refreshPath(path: string): Promise<void>
  /** Reloads only the working tree status: cheap, for file edits. */
  refreshStatus(path: string): Promise<void>
  select(hash: string | null, scrollIntoView?: boolean): void
  openDiff(target: DiffTarget | null): void
  /** Shows the history or blame of a file, closing the diff. */
  inspectFile(inspect: FileInspect | null): void
  setDraft(path: string, draft: Partial<CommitDraft>): void
  setBusy(path: string, busy: string | undefined): void
}

const TABS_KEY = 'gitdom.tabs'
const RECENT_KEY = 'gitdom.recent'
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
      const result = await window.api.openRepository(path)
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
    scrollRequest: null,

    async pickAndOpen() {
      const path = await window.api.pickRepository()
      if (path) await get().openRepo(path)
    },

    async openRepo(requested) {
      // Resolve to the repository root first so the same repo is never opened twice
      const result = await window.api.openRepository(requested)
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
      updateTab(tab.path, { selected: hash })
      if (scrollIntoView && hash) set({ scrollRequest: { hash, nonce: Date.now() } })
    },

    openDiff(target) {
      const tab = get().tabs[get().active]
      if (tab) updateTab(tab.path, { diff: target ?? undefined })
    },

    inspectFile(inspect) {
      const tab = get().tabs[get().active]
      if (tab) updateTab(tab.path, { inspect: inspect ?? undefined, diff: undefined })
    },

    setDraft(path, draft) {
      const tab = get().tabs.find((t) => t.path === path)
      if (tab) updateTab(path, { draft: { ...tab.draft, ...draft } })
    },

    setBusy(path, busy) {
      updateTab(path, { busy })
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
