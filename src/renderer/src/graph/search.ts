// Graph search (GRAPH-17): what the renderer matches itself, and the parts of a text to mark.
import type { Commit } from '../../../shared/types'

export type SearchMode = 'commit' | 'file'

/** Normalized search text: empty when there's nothing to search. */
export function searchKey(text: string): string {
  return text.trim().toLowerCase()
}

/** Whether the subject, the author or the start of the hash contains the (normalized) key. */
export function matchesCommit(commit: Commit, key: string): boolean {
  if (!key) return false
  return (
    commit.subject.toLowerCase().includes(key) ||
    commit.authorName.toLowerCase().includes(key) ||
    commit.authorEmail.toLowerCase().includes(key) ||
    (/^[0-9a-f]{4,}$/.test(key) && commit.hash.startsWith(key))
  )
}

export interface TextPart {
  text: string
  mark: boolean
}

/** Splits `text` around every occurrence of the key, ignoring case. */
export function markMatches(text: string, key: string): TextPart[] {
  if (!key) return [{ text, mark: false }]
  const lower = text.toLowerCase()
  const parts: TextPart[] = []
  let from = 0
  for (let at = lower.indexOf(key); at >= 0; at = lower.indexOf(key, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), mark: false })
    parts.push({ text: text.slice(at, at + key.length), mark: true })
    from = at + key.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), mark: false })
  return parts
}

/** The match after (or before) the current row, wrapping around; -1 without matches. */
export function nextMatch(matches: number[], current: number, backwards: boolean): number {
  if (matches.length === 0) return -1
  if (backwards) {
    const earlier = matches.filter((row) => row < current)
    return earlier.length ? earlier[earlier.length - 1] : matches[matches.length - 1]
  }
  return matches.find((row) => row > current) ?? matches[0]
}
