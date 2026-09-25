// Parsing of conflict markers, for the 3-pane merge tool.

export interface ConflictBlock {
  kind: 'conflict'
  ours: string[]
  theirs: string[]
  /** Common ancestor lines, with merge.conflictStyle diff3/zdiff3 */
  base?: string[]
  oursLabel: string
  theirsLabel: string
}

export type Segment = { kind: 'common'; lines: string[] } | ConflictBlock

/** Lines kept for a conflict: null leaves it unresolved, with its markers. */
export type Choice = 'ours' | 'theirs' | 'both' | null

export interface ConflictFile {
  segments: Segment[]
  eol: '\n' | '\r\n'
  /** The file ends with a line break */
  finalEol: boolean
}

const START = /^<{7}(?: (.*))?$/
const BASE = /^\|{7}(?: .*)?$/
const MIDDLE = /^={7}$/
const END = /^>{7}(?: (.*))?$/

export function parseConflicts(text: string): ConflictFile {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const finalEol = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (finalEol) lines.pop()

  const segments: Segment[] = []
  const common = (line: string): void => {
    const last = segments.at(-1)
    if (last?.kind === 'common') last.lines.push(line)
    else segments.push({ kind: 'common', lines: [line] })
  }

  let i = 0
  while (i < lines.length) {
    const start = START.exec(lines[i])
    if (!start) {
      common(lines[i++])
      continue
    }
    const block: ConflictBlock = {
      kind: 'conflict',
      ours: [],
      theirs: [],
      oursLabel: start[1] ?? '',
      theirsLabel: ''
    }
    let part: string[] = block.ours
    let j = i + 1
    let closed = false
    for (; j < lines.length; j++) {
      const line = lines[j]
      const end = part === block.theirs ? END.exec(line) : null
      if (end) {
        block.theirsLabel = end[1] ?? ''
        closed = true
        break
      }
      if (part === block.ours && BASE.test(line)) part = block.base = []
      else if (part !== block.theirs && MIDDLE.test(line)) part = block.theirs
      else part.push(line)
    }
    if (closed) {
      segments.push(block)
      i = j + 1
    } else {
      // Unterminated markers are just text
      common(lines[i++])
    }
  }
  return { segments, eol, finalEol }
}

/** Builds the resolved file; unresolved conflicts keep their markers. */
export function buildOutput(file: ConflictFile, choices: Choice[]): string {
  const lines: string[] = []
  let c = 0
  for (const segment of file.segments) {
    if (segment.kind === 'common') {
      lines.push(...segment.lines)
      continue
    }
    const choice = choices[c++]
    if (choice === 'ours' || choice === 'both') lines.push(...segment.ours)
    if (choice === 'theirs' || choice === 'both') lines.push(...segment.theirs)
    if (choice === null) {
      lines.push(`<<<<<<< ${segment.oursLabel}`.trimEnd(), ...segment.ours)
      if (segment.base) lines.push('|||||||', ...segment.base)
      lines.push('=======', ...segment.theirs, `>>>>>>> ${segment.theirsLabel}`.trimEnd())
    }
  }
  const text = lines.join(file.eol)
  return file.finalEol && lines.length ? text + file.eol : text
}

export const conflictCount = (file: ConflictFile): number =>
  file.segments.filter((s) => s.kind === 'conflict').length
