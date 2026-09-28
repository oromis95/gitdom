// Watches open repositories and tells the renderer when files change on disk (e.g. from a terminal or editor).
import { readFileSync, statSync, watch, type FSWatcher } from 'fs'
import { relative, resolve } from 'path'
import type { ChangeScope } from '../shared/api'

const DEBOUNCE_MS = 400

// Git internals that change without affecting what we display, or on every git command
const IGNORED_GIT =
  /^\.git[\\/](objects|logs)[\\/]|\.lock$|^\.git[\\/](FETCH_HEAD|ORIG_HEAD|gitk\.cache)$|^\.git[\\/]worktrees[\\/][^\\/]+[\\/](index$|logs[\\/])/
const IGNORED_WORKTREE = /(^|[\\/])node_modules[\\/]/

interface Watched {
  watchers: FSWatcher[]
  timer?: NodeJS.Timeout
  scope?: ChangeScope
}

const watched = new Map<string, Watched>()

export function classify(file: string): ChangeScope | null {
  if (file === '.git' || /^\.git[\\/]/.test(file)) {
    if (IGNORED_GIT.test(file)) return null
    // The index changes on stage/unstage: only the status is affected
    return /^\.git[\\/]index$/.test(file) ? 'worktree' : 'git'
  }
  return IGNORED_WORKTREE.test(file) ? null : 'worktree'
}

/**
 * Where git keeps the data of a working tree whose .git is a file (REPO-09): for a linked
 * worktree, the repository's git dir and the worktree's own folder in it (worktrees/<name>); for
 * a submodule, its git dir. Null for an ordinary repository, whose .git folder is watched anyway.
 */
export function linkedGitDir(path: string): { common: string; own: string } | null {
  try {
    const dotGit = resolve(path, '.git')
    if (!statSync(dotGit).isFile()) return null
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
    if (!match) return null
    const gitDir = resolve(path, match[1].trim())
    let common = gitDir
    try {
      common = resolve(gitDir, readFileSync(resolve(gitDir, 'commondir'), 'utf8').trim())
    } catch {
      // No commondir: a submodule, whose git dir is all its own
    }
    return { common, own: relative(common, gitDir).replace(/\\/g, '/') }
  } catch {
    return null
  }
}

/** A change in the linked git dir, as if it happened in the worktree's own .git folder. */
export function classifyLinked(own: string, file: string): ChangeScope | null {
  let path = file.replace(/\\/g, '/')
  if (own && path.startsWith('worktrees/')) {
    // The other worktrees' HEAD and index don't concern this one
    if (!path.startsWith(`${own}/`)) return null
    path = path.slice(own.length + 1)
  }
  return classify(`.git/${path}`)
}

/** Replaces the set of watched repositories; `notify` is called debounced, once per burst of changes. */
export function setWatchedRepos(
  paths: string[],
  notify: (repoPath: string, scope: ChangeScope) => void
): void {
  for (const [path, entry] of watched) {
    if (paths.includes(path)) continue
    clearTimeout(entry.timer)
    entry.watchers.forEach((w) => w.close())
    watched.delete(path)
  }

  for (const path of paths) {
    if (watched.has(path)) continue
    const entry: Watched = { watchers: [] }
    const changed = (scope: ChangeScope | null): void => {
      if (!scope) return
      // A git change within the burst wins: it implies a full reload
      if (entry.scope !== 'git') entry.scope = scope
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        const burst = entry.scope ?? 'worktree'
        entry.scope = undefined
        notify(path, burst)
      }, DEBOUNCE_MS)
    }
    const add = (folder: string, onChange: (file: string | null) => void): void => {
      try {
        const watcher = watch(folder, { recursive: true }, (_event, file) =>
          onChange(file ? file.toString() : null)
        )
        // e.g. the folder was deleted: stop watching instead of crashing the main process; the
        // next update of the watched set tries again
        watcher.on('error', () => {
          clearTimeout(entry.timer)
          entry.watchers.forEach((w) => w.close())
          if (watched.get(path) === entry) watched.delete(path)
        })
        entry.watchers.push(watcher)
      } catch {
        // Unwatchable path (missing, permissions): the app still works with manual refresh
      }
    }

    add(path, (file) => changed(file ? classify(file) : 'git'))
    const linked = linkedGitDir(path)
    if (linked)
      add(linked.common, (file) => changed(file ? classifyLinked(linked.own, file) : 'git'))
    if (entry.watchers.length) watched.set(path, entry)
  }
}
