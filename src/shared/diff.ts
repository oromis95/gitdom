// Unified diff parsing and partial patch generation for hunk/line staging.
import type { DiffLine, FileDiff, Hunk } from './types'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parses the output of `git diff` for a single file. */
export function parseDiff(output: string, path: string): FileDiff {
  const file: FileDiff = { path, binary: false, hunks: [] }
  let hunk: Hunk | null = null
  let oldNo = 0
  let newNo = 0

  for (const line of output.split('\n')) {
    const header = HUNK_HEADER.exec(line)
    if (header) {
      oldNo = Number(header[1])
      newNo = Number(header[3])
      hunk = {
        header: line,
        oldStart: oldNo,
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newNo,
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: []
      }
      file.hunks.push(hunk)
      continue
    }

    if (!hunk) {
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) file.binary = true
      else if (line.startsWith('new file mode')) file.change = 'added'
      else if (line.startsWith('deleted file mode')) file.change = 'deleted'
      else if (line.startsWith('rename from ')) file.oldPath = line.slice('rename from '.length)
      continue
    }

    const marker = line[0]
    const text = line.slice(1)
    let parsed: DiffLine | null = null
    if (marker === ' ') parsed = { type: 'context', text, oldNo: oldNo++, newNo: newNo++ }
    else if (marker === '+') parsed = { type: 'add', text, newNo: newNo++ }
    else if (marker === '-') parsed = { type: 'del', text, oldNo: oldNo++ }
    else if (marker === '\\') {
      const last = hunk.lines[hunk.lines.length - 1]
      if (last) last.noNewline = true
    }
    if (parsed) hunk.lines.push(parsed)
  }
  return file
}

export interface HunkSelection {
  hunk: Hunk
  /** Indexes into hunk.lines; undefined selects every changed line */
  lines?: Set<number>
}

/**
 * Builds a patch containing only the selected lines, to be fed to `git apply --recount`.
 *
 * Forward (staging): unselected additions are dropped, unselected deletions become context.
 * Reverse (unstaging/discarding, applied with --reverse): the roles swap — unselected
 * additions stay as context and unselected deletions are dropped.
 * Returns null when nothing is selected.
 */
export function buildPatch(
  file: FileDiff,
  selections: HunkSelection[],
  reverse: boolean
): string | null {
  const oldPath = file.oldPath ?? file.path
  const out = [`diff --git a/${oldPath} b/${file.path}`, `--- a/${oldPath}`, `+++ b/${file.path}`]
  let hasChanges = false

  for (const { hunk, lines: selected } of selections) {
    const body: string[] = []
    let oldCount = 0
    let newCount = 0
    let changed = false

    hunk.lines.forEach((line, i) => {
      const isSelected = selected ? selected.has(i) : true
      let emitted: string | null = null
      if (line.type === 'context') {
        emitted = ' '
      } else if (line.type === 'add') {
        if (isSelected) emitted = '+'
        else if (reverse) emitted = ' '
      } else {
        if (isSelected) emitted = '-'
        else if (!reverse) emitted = ' '
      }
      if (emitted === null) return

      body.push(emitted + line.text)
      if (line.noNewline) body.push('\\ No newline at end of file')
      if (emitted !== '+') oldCount++
      if (emitted !== '-') newCount++
      if (emitted !== ' ') changed = true
    })

    if (!changed) continue
    hasChanges = true
    out.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`, ...body)
  }

  return hasChanges ? out.join('\n') + '\n' : null
}
