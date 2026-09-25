// Watches open repositories and tells the renderer when files change on disk (e.g. from a terminal or editor).
import { watch, type FSWatcher } from 'fs'
import type { ChangeScope } from '../shared/api'

const DEBOUNCE_MS = 400

// Git internals that change without affecting what we display, or on every git command
const IGNORED_GIT =
  /^\.git[\\/](objects|logs)[\\/]|\.lock$|^\.git[\\/](FETCH_HEAD|ORIG_HEAD|gitk\.cache)$/
const IGNORED_WORKTREE = /(^|[\\/])node_modules[\\/]/

interface Watched {
  watcher: FSWatcher
  timer?: NodeJS.Timeout
  scope?: ChangeScope
}

const watched = new Map<string, Watched>()

function classify(file: string): ChangeScope | null {
  if (file === '.git' || /^\.git[\\/]/.test(file)) {
    if (IGNORED_GIT.test(file)) return null
    // The index changes on stage/unstage: only the status is affected
    return /^\.git[\\/]index$/.test(file) ? 'worktree' : 'git'
  }
  return IGNORED_WORKTREE.test(file) ? null : 'worktree'
}

/** Replaces the set of watched repositories; `notify` is called debounced, once per burst of changes. */
export function setWatchedRepos(
  paths: string[],
  notify: (repoPath: string, scope: ChangeScope) => void
): void {
  for (const [path, entry] of watched) {
    if (paths.includes(path)) continue
    clearTimeout(entry.timer)
    entry.watcher.close()
    watched.delete(path)
  }

  for (const path of paths) {
    if (watched.has(path)) continue
    try {
      const entry: Watched = {
        watcher: watch(path, { recursive: true }, (_event, file) => {
          const scope = file ? classify(file.toString()) : 'git'
          if (!scope) return
          // A git change within the burst wins: it implies a full reload
          if (entry.scope !== 'git') entry.scope = scope
          clearTimeout(entry.timer)
          entry.timer = setTimeout(() => {
            const burst = entry.scope ?? 'worktree'
            entry.scope = undefined
            notify(path, burst)
          }, DEBOUNCE_MS)
        })
      }
      // e.g. the folder was deleted: stop watching instead of crashing the main process
      entry.watcher.on('error', () => {
        entry.watcher.close()
        watched.delete(path)
      })
      watched.set(path, entry)
    } catch {
      // Unwatchable path (missing, permissions): the app still works with manual refresh
    }
  }
}
