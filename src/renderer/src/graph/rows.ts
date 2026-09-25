// Rows of the commit graph: the working tree, the commits, and the stashes hanging from the
// commits they were made on (STASH-03).
import type { Commit, Stash } from '../../../shared/types'

export type GraphItem =
  | { kind: 'wip'; changes: number }
  | { kind: 'commit'; commit: Commit }
  | { kind: 'stash'; stash: Stash }

/**
 * Commits newest first, with the WIP row on top when there are changes. Each stash goes where
 * its date falls, but never below its base commit; stashes whose base isn't loaded are left out.
 */
export function buildRows(commits: Commit[], stashes: Stash[], changes: number): GraphItem[] {
  const index = new Map(commits.map((c, i) => [c.hash, i]))
  const before = new Map<number, Stash[]>()
  for (const stash of stashes) {
    const base = index.get(stash.base)
    if (base === undefined) continue
    let at = commits.findIndex((c) => c.authorDate <= stash.date)
    if (at < 0 || at > base) at = base
    before.set(at, [...(before.get(at) ?? []), stash])
  }

  const rows: GraphItem[] = changes > 0 ? [{ kind: 'wip', changes }] : []
  commits.forEach((commit, i) => {
    for (const stash of before.get(i) ?? []) rows.push({ kind: 'stash', stash })
    rows.push({ kind: 'commit', commit })
  })
  return rows
}
