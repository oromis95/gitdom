// The time-lapse of a file: what each step shows, and the searches through all of them.
import type { Timelapse } from '../../shared/types'

/** A row of a version: one of its lines, or a line it removed (a ghost). */
export interface TimelapseRow {
  id: number
  ghost: boolean
}

/** The rows of a version, with the lines it removed where they were when `ghosts` is on. */
export function frameRows(t: Timelapse, frame: number, ghosts: boolean): TimelapseRow[] {
  const lines = t.frames[frame]
  const removed = ghosts ? t.ghosts[frame] : []
  const rows: TimelapseRow[] = []
  let next = 0
  for (const g of removed) {
    for (; next < g.at; next++) rows.push({ id: lines[next], ghost: false })
    for (const id of g.lines) rows.push({ id, ghost: true })
  }
  for (; next < lines.length; next++) rows.push({ id: lines[next], ghost: false })
  return rows
}

/** Steps after which a change no longer stands out */
const RECENCY_STEPS = 16

/** How much a line added `ago` steps before stands out: 1 for this step's, fading to 0. */
export function recency(ago: number): number {
  if (ago < 0 || ago >= RECENCY_STEPS) return 0
  return Math.round((1 - ago / RECENCY_STEPS) ** 2 * 100) / 100
}

/** Where a time-lapse search looks */
export interface TimelapseFilters {
  /** Lines a commit added or changed */
  added: boolean
  /** Lines a commit removed */
  removed: boolean
  /** The commit's message, author and hash */
  commits: boolean
}

/** The steps a search matches, oldest first: `lower` holds each line's text in lower case. */
export function searchSteps(
  t: Timelapse,
  lower: string[],
  term: string,
  filters: TimelapseFilters
): number[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return []
  const steps = new Set<number>()
  if (filters.added) lower.forEach((text, id) => text.includes(needle) && steps.add(t.born[id]))
  if (filters.removed)
    t.ghosts.forEach((removed, step) => {
      if (removed.some((g) => g.lines.some((id) => lower[id].includes(needle)))) steps.add(step)
    })
  if (filters.commits)
    t.revisions.forEach((r, step) => {
      const fields = [r.subject, r.authorName, r.authorEmail]
      if (fields.some((f) => f.toLowerCase().includes(needle)) || r.hash.startsWith(needle))
        steps.add(step)
    })
  return [...steps].sort((a, b) => a - b)
}

/** The steps whose version has a line. */
export function stepsWith(t: Timelapse, id: number): boolean[] {
  return t.frames.map((frame) => frame.includes(id))
}

/** The step after (or before, going back) `from` in a sorted list of steps, if any. */
export function nextStep(steps: number[], from: number, back: boolean): number | undefined {
  return back ? steps.findLast((s) => s < from) : steps.find((s) => s > from)
}
