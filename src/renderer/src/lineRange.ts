// Ranges of lines followed through the history (`git log -L`): picked in the blame or named.

/** "lines 12–40", "line 7" or "function parse", for a range of lineHistory. */
export function rangeLabel(range: string): string {
  if (range.startsWith(':')) return `function ${range.slice(1).replace(/\\(.)/g, '$1')}`
  const [start, end] = range.split(',')
  return start === end ? `line ${start}` : `lines ${start}–${end}`
}

/** Escapes a function name for git, which reads it as a regular expression. */
export const functionRange = (name: string): string =>
  `:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`

/** A run of unchanged lines folded away, from `start` to `end` included. */
export interface Fold {
  start: number
  end: number
}

/**
 * The lines of a hunk to show: long runs of unchanged lines fold, keeping `keep` lines next to
 * each change. A function's history repeats the whole function at every commit otherwise.
 */
export function foldContext(lines: { type: string }[], keep = 3, shortest = 5): (number | Fold)[] {
  const rows: (number | Fold)[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type !== 'context') {
      rows.push(i++)
      continue
    }
    let end = i
    while (end + 1 < lines.length && lines[end + 1].type === 'context') end++
    const before = i === 0 ? 0 : keep
    const after = end === lines.length - 1 ? 0 : keep
    if (end - i + 1 - before - after >= shortest) {
      for (let k = i; k < i + before; k++) rows.push(k)
      rows.push({ start: i + before, end: end - after })
      for (let k = end - after + 1; k <= end; k++) rows.push(k)
    } else for (let k = i; k <= end; k++) rows.push(k)
    i = end + 1
  }
  return rows
}
