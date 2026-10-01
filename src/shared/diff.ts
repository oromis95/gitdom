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

/**
 * Where a line of the new side of a diff was on the old side, from hunks without
 * context (`git diff -U0`). A changed line maps to the lines it replaced, an added
 * one to where it was inserted.
 */
export function lineBefore(hunks: Hunk[], line: number): number {
  let delta = 0
  for (const h of hunks) {
    // With no lines on a side, its start is the line before the change
    const newNext = h.newLines ? h.newStart + h.newLines : h.newStart + 1
    const oldNext = h.oldLines ? h.oldStart + h.oldLines : h.oldStart + 1
    if (line < (h.newLines ? h.newStart : newNext)) break
    if (line < newNext)
      return h.oldLines ? h.oldStart + Math.min(line - h.newStart, h.oldLines - 1) : oldNext
    delta = oldNext - newNext
  }
  return Math.max(1, line + delta)
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

/** The lines of a hunk as they are in the working tree: what staging all of it would store. */
export const hunkNewText = (hunk: Hunk): string[] =>
  hunk.lines.filter((l) => l.type !== 'del').map((l) => l.text)

/**
 * Builds a patch, to be applied with `git apply --cached --recount`, that stores `edited` in the
 * index in place of what the hunk changes, whatever the working tree holds. Lines the edit
 * leaves as they were in the index stay context. Returns null when the edit changes nothing.
 */
export function buildEditedPatch(file: FileDiff, hunk: Hunk, edited: string[]): string | null {
  const oldSide = hunk.lines.filter((l) => l.type !== 'add')
  const before = oldSide.map((l) => l.text)
  const oldNoEol = !!oldSide[oldSide.length - 1]?.noNewline
  // A missing newline at the end of the file stays as it is in the working tree
  const newNoEol = !!hunk.lines.filter((l) => l.type !== 'del').pop()?.noNewline
  const same = before.length === edited.length && before.every((text, i) => text === edited[i])
  if (same && oldNoEol === newNoEol) return null

  // The last line carries the newline marker: with one, it can't be shared context
  const marked = oldNoEol || newNoEol
  const shared = Math.min(before.length, edited.length) - (marked ? 1 : 0)
  let start = 0
  while (start < shared && before[start] === edited[start]) start++
  let end = 0
  if (!marked)
    while (
      end < shared - start &&
      before[before.length - 1 - end] === edited[edited.length - 1 - end]
    )
      end++

  const body = before.slice(0, start).map((text) => ' ' + text)
  const removed = before.slice(start, before.length - end)
  const added = edited.slice(start, edited.length - end)
  removed.forEach((text, i) => {
    body.push('-' + text)
    if (oldNoEol && i === removed.length - 1) body.push('\\ No newline at end of file')
  })
  added.forEach((text, i) => {
    body.push('+' + text)
    if (newNoEol && i === added.length - 1) body.push('\\ No newline at end of file')
  })
  body.push(...before.slice(before.length - end).map((text) => ' ' + text))

  const oldPath = file.oldPath ?? file.path
  return (
    [
      `diff --git a/${oldPath} b/${file.path}`,
      `--- a/${oldPath}`,
      `+++ b/${file.path}`,
      `@@ -${hunk.oldStart},${before.length} +${hunk.oldStart},${edited.length} @@`,
      ...body
    ].join('\n') + '\n'
  )
}
