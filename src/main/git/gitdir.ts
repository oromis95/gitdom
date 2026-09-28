import { resolve } from 'path'
import { runGit } from './exec'

export interface GitDirs {
  /** The working tree's own git dir: .git, or .git/worktrees/<name> for a linked worktree */
  gitDir: string
  /** The dir shared by all the worktrees: objects, refs, config */
  commonDir: string
}

const cache = new Map<string, Promise<GitDirs>>()

/**
 * The repository's git dirs, asked once per session: starting git costs up to 200 ms on some
 * machines (antivirus), and a repository's git dir doesn't move.
 */
export function gitDirs(repo: string): Promise<GitDirs> {
  let dirs = cache.get(repo)
  if (!dirs) {
    dirs = runGit(repo, ['rev-parse', '--git-dir', '--git-common-dir']).then((output) => {
      const [gitDir, commonDir] = output.split('\n').map((p) => resolve(repo, p.trim()))
      return { gitDir, commonDir }
    })
    cache.set(repo, dirs)
    // Not a repository yet (e.g. just deleted): ask again next time
    dirs.catch(() => cache.delete(repo))
  }
  return dirs
}
