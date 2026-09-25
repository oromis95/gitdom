// State of the activity log dock (UI-09): the git commands the main process reports as they end.
import { create } from 'zustand'
import type { ActivityEntry } from '../../shared/api'

const HEIGHT_KEY = 'gitdom.activityHeight'
const BACKGROUND_KEY = 'gitdom.activityBackground'
const MAX_ENTRIES = 1000
const MIN_HEIGHT = 120

interface ActivityState {
  shown: boolean
  height: number
  entries: ActivityEntry[]
  /** Also list background commands (refreshes, reads), not only the user's actions */
  background: boolean
}

export const useActivity = create<ActivityState>(() => ({
  shown: false,
  height: Number(localStorage.getItem(HEIGHT_KEY)) || 260,
  entries: [],
  background: localStorage.getItem(BACKGROUND_KEY) === 'true'
}))

let listening = false

/** Loads the log kept by the main process and follows it; entries arrive even while hidden. */
export function startActivityLog(): void {
  if (listening) return
  listening = true
  const pending: ActivityEntry[] = []
  let loaded = false
  window.api.activity.onEntry((entry) => {
    if (!loaded) pending.push(entry)
    else useActivity.setState((s) => ({ entries: [...s.entries, entry].slice(-MAX_ENTRIES) }))
  })
  void window.api.activity.list().then((entries) => {
    const known = new Set(entries.map((e) => e.id))
    loaded = true
    useActivity.setState({
      entries: [...entries, ...pending.filter((e) => !known.has(e.id))].slice(-MAX_ENTRIES)
    })
  })
}

export function toggleActivity(show = !useActivity.getState().shown): void {
  useActivity.setState({ shown: show })
}

export function setActivityHeight(height: number): void {
  const clamped = Math.round(Math.max(MIN_HEIGHT, Math.min(height, window.innerHeight * 0.75)))
  localStorage.setItem(HEIGHT_KEY, String(clamped))
  useActivity.setState({ height: clamped })
}

export function setShowBackground(background: boolean): void {
  localStorage.setItem(BACKGROUND_KEY, String(background))
  useActivity.setState({ background })
}

export function clearActivity(): void {
  window.api.activity.clear()
  useActivity.setState({ entries: [] })
}

/** An entry failed: git exited with an error, or couldn't start. */
export const failed = (e: ActivityEntry): boolean => !e.ok

/** The command as it could be typed in a terminal. */
export function commandLine(e: ActivityEntry): string {
  const quote = (arg: string): string =>
    /^[\w@%+=:,./^{}~-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`
  return ['git', ...e.args.map(quote)].join(' ')
}
