// Intra-line highlighting (DIFF-03): the words that changed between a removed line and the
// added line that replaced it.
import type { DiffLine } from './types'

/** Character range [start, end) of a line's text */
export type Range = [number, number]

/** Lines longer than this in tokens are not compared word by word */
const TOKEN_LIMIT = 400
/** Below this share of unchanged characters the lines are unrelated: nothing is marked */
const MIN_SIMILARITY = 0.25

function tokenize(text: string): string[] {
  return text.match(/\w+|\s+|[^\w\s]/g) ?? []
}

/** Ranges of the tokens outside the longest common subsequence, merged when adjacent. */
function changedRanges(tokens: string[], kept: boolean[]): Range[] {
  const ranges: Range[] = []
  let offset = 0
  tokens.forEach((token, i) => {
    const end = offset + token.length
    if (!kept[i]) {
      const last = ranges[ranges.length - 1]
      if (last && last[1] === offset) last[1] = end
      else ranges.push([offset, end])
    }
    offset = end
  })
  return ranges
}

/** Changed parts of both lines, or null when they are too different or too long to compare. */
export function wordDiff(oldText: string, newText: string): { old: Range[]; new: Range[] } | null {
  const a = tokenize(oldText)
  const b = tokenize(newText)
  if (a.length > TOKEN_LIMIT || b.length > TOKEN_LIMIT) return null
  // lcs[i][j]: length of the common subsequence of a[i…] and b[j…]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const keptA = new Array<boolean>(a.length).fill(false)
  const keptB = new Array<boolean>(b.length).fill(false)
  let common = 0
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      keptA[i++] = keptB[j++] = true
      common += a[i - 1].length
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++
    else j++
  }
  if (common < MIN_SIMILARITY * Math.max(oldText.length, newText.length)) return null
  return { old: changedRanges(a, keptA), new: changedRanges(b, keptB) }
}

/**
 * Changed ranges of each line of a hunk, by line index: the n-th removed line of a block is
 * paired with the n-th added line that follows it.
 */
export function hunkWordRanges(lines: DiffLine[]): Map<number, Range[]> {
  const result = new Map<number, Range[]>()
  let i = 0
  while (i < lines.length) {
    if (lines[i].type !== 'del') {
      i++
      continue
    }
    const delStart = i
    while (i < lines.length && lines[i].type === 'del') i++
    const addStart = i
    while (i < lines.length && lines[i].type === 'add') i++
    const pairs = Math.min(addStart - delStart, i - addStart)
    for (let k = 0; k < pairs; k++) {
      const ranges = wordDiff(lines[delStart + k].text, lines[addStart + k].text)
      if (!ranges) continue
      if (ranges.old.length) result.set(delStart + k, ranges.old)
      if (ranges.new.length) result.set(addStart + k, ranges.new)
    }
  }
  return result
}

/**
 * Wraps the text ranges of already highlighted HTML in <mark> elements. Offsets count the
 * characters of the original text: tags are skipped and an entity counts as one character.
 */
export function markHtml(html: string, ranges: Range[]): string {
  if (!ranges.length) return html
  const open = '<mark class="word">'
  let out = ''
  let offset = 0
  let r = 0
  let inside = false
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i) + 1 || html.length
      // Marks can't cross the highlighter's spans: close and reopen around its tags
      out += inside ? `</mark>${html.slice(i, end)}${open}` : html.slice(i, end)
      i = end
      continue
    }
    if (!inside && r < ranges.length && offset === ranges[r][0]) {
      out += open
      inside = true
    }
    const end = html[i] === '&' ? html.indexOf(';', i) + 1 || i + 1 : i + 1
    out += html.slice(i, end)
    i = end
    offset++
    if (inside && offset === ranges[r][1]) {
      out += '</mark>'
      inside = false
      r++
    }
  }
  if (inside) out += '</mark>'
  return out.replace(/<mark class="word"><\/mark>/g, '')
}
