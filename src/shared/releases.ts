// Versions and release notes: GitDom's CHANGELOG.md, bundled in the app, and the notes of the
// GitHub releases, which the release workflow takes from it. Only the Markdown it uses is understood.

/** Compares versions like 0.10.1, with or without a leading v: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

export interface ChangelogEntry {
  version: string
  /** As written in the heading, e.g. 2026-09-25 */
  date: string
  /** Markdown of the section */
  body: string
}

const VERSION_HEADING = /^##\s+\[?v?(\d+(?:\.\d+)+)\]?(?:\s+[—–-]\s+(.+?))?\s*$/

/** Sections headed "## 0.6.0 — 2026-09-25", in file order (newest first). */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: { version: string; date: string; lines: string[] }[] = []
  for (const line of text.split(/\r?\n/)) {
    const heading = VERSION_HEADING.exec(line)
    if (heading) entries.push({ version: heading[1], date: heading[2] ?? '', lines: [] })
    else entries.at(-1)?.lines.push(line)
  }
  return entries.map((e) => ({ version: e.version, date: e.date, body: e.lines.join('\n').trim() }))
}

export interface Inline {
  text: string
  bold?: boolean
  code?: boolean
}

export type Block =
  | { kind: 'heading'; text: Inline[] }
  | { kind: 'paragraph'; text: Inline[] }
  /** List item; depth 0 for top-level items */
  | { kind: 'item'; depth: number; text: Inline[] }

/** Bold, code spans and links, the latter reduced to their text. */
export function parseInline(text: string): Inline[] {
  const parts: Inline[] = []
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    if (match[1] !== undefined) parts.push({ text: match[1], bold: true })
    else if (match[2] !== undefined) parts.push({ text: match[2], code: true })
    else parts.push({ text: match[3] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** Headings, paragraphs and nested bullet lists; lines continuing an item or paragraph join it. */
export function parseMarkdown(text: string): Block[] {
  const blocks: { kind: Block['kind']; depth: number; text: string }[] = []
  let open = false
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (!line.trim()) open = false
    else if (heading) {
      blocks.push({ kind: 'heading', depth: 0, text: heading[1].trim() })
      open = false
    } else if (item) {
      blocks.push({ kind: 'item', depth: Math.floor(item[1].length / 2), text: item[2].trim() })
      open = true
    } else if (open) blocks[blocks.length - 1].text += ` ${line.trim()}`
    else {
      blocks.push({ kind: 'paragraph', depth: 0, text: line.trim() })
      open = true
    }
  }
  return blocks.map((b) =>
    b.kind === 'item'
      ? { kind: 'item', depth: b.depth, text: parseInline(b.text) }
      : { kind: b.kind, text: parseInline(b.text) }
  )
}
