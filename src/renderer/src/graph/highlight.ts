// Highlight of a branch under the mouse (GRAPH-15): its first-parent chain, rows and line pieces.
import type { GraphLayout, Segment } from './layout'

export interface ChainHighlight {
  rows: Set<number>
  /** Per row, the keys of the segments the chain runs through */
  segments: Map<number, Set<string>>
}

export const segmentKey = (s: Pick<Segment, 'kind' | 'from' | 'to'>): string =>
  `${s.kind}:${s.from}:${s.to}`

/**
 * Follows first parents from `start` down the graph. A first parent keeps the lane of its
 * child until it's reached (see layout.ts), so the line in between runs straight in that lane.
 */
export function firstParentChain(
  layout: GraphLayout,
  firstParents: (string | undefined)[],
  index: Map<string, number>,
  start: number
): ChainHighlight {
  const rows = new Set<number>()
  const segments = new Map<number, Set<string>>()
  const add = (row: number, key: string): void => {
    const keys = segments.get(row) ?? new Set<string>()
    keys.add(key)
    segments.set(row, keys)
  }

  for (let i = start; i >= 0 && i < layout.rows.length && !rows.has(i);) {
    rows.add(i)
    const parent = firstParents[i]
    const next = parent === undefined ? undefined : index.get(parent)
    if (next === undefined || next <= i) break
    const lane = layout.rows[i].lane
    add(i, segmentKey({ kind: 'bottom', from: lane, to: lane }))
    for (let k = i + 1; k < next; k++) add(k, segmentKey({ kind: 'full', from: lane, to: lane }))
    add(next, segmentKey({ kind: 'top', from: lane, to: layout.rows[next].lane }))
    i = next
  }
  return { rows, segments }
}
