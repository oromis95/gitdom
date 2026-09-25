// Activity log (UI-09, NFR-07): every git command GitDom runs, with its duration and output.
// Commands run while an action is in progress (a push, a rebase…) are tagged with it, so the log
// can tell what the user asked for from background work like refreshes.
import { AsyncLocalStorage } from 'async_hooks'
import type { ActivityEntry } from '../../shared/api'

const MAX_ENTRIES = 1000
/** Output kept per command: background reads (log, status) can be megabytes */
const MAX_OUTPUT = { action: 20000, background: 2000 }

interface Action {
  id: number
  label: string
}

const context = new AsyncLocalStorage<Action>()
const entries: ActivityEntry[] = []
const listeners = new Set<(entry: ActivityEntry) => void>()
let nextId = 1
let nextActionId = 1

/** Runs `work` as a user action: the git commands it runs are logged under `label`. */
export function inAction<T>(label: string, work: () => Promise<T>): Promise<T> {
  // An action started by another one belongs to it
  if (context.getStore()) return work()
  return context.run({ id: nextActionId++, label }, work)
}

/** Hides credentials written in HTTP URLs, like https://user:token@host. */
export const redact = (text: string): string => text.replace(/\b(https?:\/\/)[^\s/@]+@/gi, '$1***@')

/**
 * Starts logging a command: call the returned function when it ends. The action is read here,
 * when git is started, as process events don't reliably carry it.
 */
export function logCommand(
  repo: string,
  args: string[]
): (exitCode: number | null, output: string, ok: boolean) => void {
  const action = context.getStore()
  const start = Date.now()
  return (exitCode, output, ok) => {
    const limit = action ? MAX_OUTPUT.action : MAX_OUTPUT.background
    const entry: ActivityEntry = {
      id: nextId++,
      repo,
      action: action?.label ?? null,
      actionId: action?.id ?? null,
      args: args.map(redact),
      start,
      duration: Date.now() - start,
      exitCode,
      ok,
      output: redact(output.length > limit ? output.slice(0, limit) : output).trimEnd(),
      truncated: output.length > limit
    }
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries.shift()
    for (const listener of listeners) listener(entry)
  }
}

export const activityEntries = (): ActivityEntry[] => [...entries]

export function clearActivity(): void {
  entries.length = 0
}

export function onActivity(listener: (entry: ActivityEntry) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
