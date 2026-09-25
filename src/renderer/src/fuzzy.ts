// Fuzzy matching for the command palette: the query's characters must appear in order.

export interface FuzzyMatch {
  score: number
  /** Indexes of the matched characters in the text, for highlighting */
  positions: number[]
}

const isWordStart = (text: string, i: number): boolean =>
  i === 0 ||
  /[\s/\-_.:()"]/.test(text[i - 1]) ||
  (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]))

function scoreOf(text: string, positions: number[]): number {
  let score = 0
  positions.forEach((p, k) => {
    score += 1
    if (isWordStart(text, p)) score += 3
    if (k > 0 && p === positions[k - 1] + 1) score += 4
  })
  // Prefer matches near the start and shorter texts
  return score - positions[0] * 0.05 - text.length * 0.01
}

/**
 * Matches `query` against `text`, case-insensitively, ignoring spaces in the query.
 * Consecutive characters and word starts score higher; null when the query doesn't match.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return { score: 0, positions: [] }
  const lower = text.toLowerCase()

  // Greedy from each occurrence of the first character: keep the best scoring match
  let best: FuzzyMatch | null = null
  for (let start = lower.indexOf(q[0]); start >= 0; start = lower.indexOf(q[0], start + 1)) {
    const positions = [start]
    for (let k = 1; k < q.length; k++) {
      const i = lower.indexOf(q[k], positions[k - 1] + 1)
      if (i < 0) return best
      positions.push(i)
    }
    const score = scoreOf(text, positions)
    if (!best || score > best.score) best = { score, positions }
  }
  return best
}

/** Filters and sorts items by how well their text matches, best first. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  text: (item: T) => string
): { item: T; match: FuzzyMatch }[] {
  const results: { item: T; match: FuzzyMatch; index: number }[] = []
  items.forEach((item, index) => {
    const match = fuzzyMatch(query, text(item))
    if (match) results.push({ item, match, index })
  })
  // Stable for equal scores: the original order says what's most relevant
  return results.sort((a, b) => b.match.score - a.match.score || a.index - b.index)
}
