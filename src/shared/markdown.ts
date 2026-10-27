// The Markdown of pull request descriptions and comments, as GitHub and GitLab write it, read into
// blocks the interface draws as elements: HTML never reaches the page, its tags are dropped.

export interface Span {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  /** A link: only http(s) addresses, other targets stay plain text */
  href?: string
  /** A picture, shown as a link to it */
  image?: boolean
}

export type MdBlock =
  | { kind: 'heading'; level: number; text: Span[] }
  | { kind: 'paragraph'; text: Span[] }
  /** List item; `ordered` is its number, `checked` set for task list items */
  | { kind: 'item'; depth: number; ordered: number | null; checked: boolean | null; text: Span[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'quote'; blocks: MdBlock[] }
  | { kind: 'table'; header: Span[][]; rows: Span[][][] }
  | { kind: 'rule' }

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}

/** Removes HTML: comments entirely, tags leaving their text; <br> becomes a space. */
function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/gi, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e])
}

const safeHref = (url: string): string | undefined =>
  /^https?:\/\/[^\s]+$/i.test(url) ? url : undefined

const INLINE = new RegExp(
  [
    '`([^`]+)`', // 1 code
    '!\\[([^\\]]*)\\]\\(([^)\\s]+)[^)]*\\)', // 2, 3 image
    '\\[([^\\]]+)\\]\\(([^)\\s]+)[^)]*\\)', // 4, 5 link
    '<(https?://[^>\\s]+)>', // 6 autolink
    '\\*\\*(.+?)\\*\\*', // 7 bold
    '__(.+?)__', // 8 bold
    '~~(.+?)~~', // 9 strike
    '\\*([^*\\s][^*]*?)\\*', // 10 italic
    '(?<![\\w])_([^_\\s][^_]*?)_(?![\\w])', // 11 italic
    '(https?://[^\\s<>()]*[^\\s<>().,;:!?\'"])' // 12 bare URL
  ].join('|'),
  'g'
)

/** Code spans, links, pictures, bold, italic and strikethrough; nested styles are flattened. */
export function parseSpans(source: string): Span[] {
  const spans: Span[] = []
  const plain = (text: string): void => {
    if (text) spans.push({ text: stripHtml(text) })
  }
  let last = 0
  for (const m of source.matchAll(INLINE)) {
    plain(source.slice(last, m.index))
    last = m.index + m[0].length
    if (m[1] !== undefined) spans.push({ text: m[1], code: true })
    else if (m[3] !== undefined)
      spans.push({ text: stripHtml(m[2]) || 'image', href: safeHref(m[3]), image: true })
    else if (m[5] !== undefined) spans.push({ text: stripHtml(m[4]), href: safeHref(m[5]) })
    else if (m[6] !== undefined) spans.push({ text: m[6], href: m[6] })
    else if (m[7] !== undefined || m[8] !== undefined)
      spans.push(...parseSpans(m[7] ?? m[8]).map((s) => ({ ...s, bold: true })))
    else if (m[9] !== undefined)
      spans.push(...parseSpans(m[9]).map((s) => ({ ...s, strike: true })))
    else if (m[10] !== undefined || m[11] !== undefined)
      spans.push(...parseSpans(m[10] ?? m[11]).map((s) => ({ ...s, italic: true })))
    else spans.push({ text: m[12], href: m[12] })
  }
  plain(source.slice(last))
  return spans.filter((s) => s.text)
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const cells = (line: string): Span[][] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => parseSpans(cell.trim().replace(/\\\|/g, '|')))

/** Without the spaces dropped tags leave at the ends. */
function trimSpans(spans: Span[]): Span[] {
  const result = spans.map((s) => ({ ...s }))
  if (result[0] && !result[0].code) result[0].text = result[0].text.trimStart()
  const last = result.at(-1)
  if (last && !last.code) last.text = last.text.trimEnd()
  return result.filter((s) => s.text)
}

/** Headings, paragraphs, lists (also numbered and task lists), code, quotes, tables and rules. */
export function parseBlocks(source: string): MdBlock[] {
  const lines = source.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const blocks: MdBlock[] = []
  // The paragraph or list item later lines continue, until a blank line
  let open: { text: string; block: Extract<MdBlock, { text: Span[] }> } | null = null
  const close = (): void => {
    if (open) open.block.text = trimSpans(parseSpans(open.text))
    open = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence) {
      close()
      const body: string[] = []
      while (++i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i])
      blocks.push({ kind: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      close()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      close()
      blocks.push({ kind: 'heading', level: heading[1].length, text: parseSpans(heading[2]) })
      continue
    }
    if (RULE.test(line)) {
      close()
      blocks.push({ kind: 'rule' })
      continue
    }
    if (QUOTE.test(line)) {
      close()
      const quoted: string[] = []
      for (; i < lines.length && QUOTE.test(lines[i]); i++) quoted.push(QUOTE.exec(lines[i])![1])
      i--
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted.join('\n')) })
      continue
    }
    if (line.includes('|') && TABLE_RULE.test(lines[i + 1] ?? '') && lines[i + 1].includes('-')) {
      close()
      const header = cells(line)
      const rows: Span[][][] = []
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++)
        rows.push(cells(lines[i]))
      i--
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      close()
      const task = TASK.exec(item[4])
      const block: MdBlock = {
        kind: 'item',
        depth: Math.floor(item[1].replace(/\t/g, '  ').length / 2),
        ordered: item[3] ? Number(item[3]) : null,
        checked: task ? task[1] !== ' ' : null,
        text: []
      }
      blocks.push(block)
      open = { text: task ? task[2] : item[4], block }
      continue
    }
    if (open) {
      open.text += ` ${line.trim()}`
      continue
    }
    const block: MdBlock = { kind: 'paragraph', text: [] }
    blocks.push(block)
    open = { text: line.trim(), block }
  }
  close()
  return blocks.filter((b) => b.kind !== 'paragraph' || b.text.length > 0)
}
