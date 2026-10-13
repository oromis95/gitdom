// The time-lapse of a file: every version, and the identity of each line through them, computed
// from the versions' text with a line diff instead of a `git blame` for each.
import { matchLines } from '../../shared/lineDiff'
import type { Timelapse, TimelapseGhosts } from '../../shared/types'

export interface TimelapseVersion {
  /** Indexes of the earlier versions this one comes from, the first parent first */
  parents: number[]
  /** null when the file doesn't exist in this version */
  lines: string[] | null
}

/** Lines, line identities and removed lines of versions given oldest first, parents before children. */
export function buildFrames(
  versions: TimelapseVersion[]
): Pick<Timelapse, 'text' | 'born' | 'frames' | 'ghosts'> {
  const text: string[] = []
  const born: number[] = []
  // Equal texts get equal numbers, for the diff
  const codes = new Map<string, number>()
  const lineCode: number[] = []
  const codeOf = (line: string): number => {
    let code = codes.get(line)
    if (code === undefined) {
      code = codes.size
      codes.set(line, code)
    }
    return code
  }
  const frames: Int32Array[] = []
  const ghosts: TimelapseGhosts[][] = []
  const codesOf = (frame: Int32Array): Int32Array => frame.map((id) => lineCode[id])

  versions.forEach((version, index) => {
    const parents = version.parents.filter((p) => p >= 0 && p < index)
    const before = parents.length ? frames[parents[0]] : new Int32Array(0)
    if (!version.lines) {
      frames.push(new Int32Array(0))
      ghosts.push(before.length ? [{ at: 0, lines: [...before] }] : [])
      return
    }
    const current = Int32Array.from(version.lines, codeOf)
    const frame = new Int32Array(current.length).fill(-1)
    const match = matchLines(codesOf(before), current)
    match.forEach((i, j) => {
      if (i >= 0) frame[j] = before[i]
    })
    // A merge: lines the first parent lacks may come from the others
    for (const other of parents.slice(1)) {
      if (!frame.includes(-1)) break
      const otherMatch = matchLines(codesOf(frames[other]), current)
      otherMatch.forEach((i, j) => {
        if (i >= 0 && frame[j] < 0) frame[j] = frames[other][i]
      })
    }
    frame.forEach((id, j) => {
      if (id >= 0) return
      frame[j] = text.length
      text.push(version.lines![j])
      lineCode.push(current[j])
      born.push(index)
    })
    frames.push(frame)

    // The first parent's lines no line comes from, where they were: before the lines that
    // replaced them, like in a diff
    const removed: TimelapseGhosts[] = []
    let next = 0
    let at = 0
    const skipTo = (end: number): void => {
      if (end > next) removed.push({ at, lines: [...before.subarray(next, end)] })
    }
    match.forEach((i, j) => {
      if (i < 0) return
      skipTo(i)
      next = i + 1
      at = j + 1
    })
    skipTo(before.length)
    ghosts.push(removed)
  })
  return { text, born: Int32Array.from(born), frames, ghosts }
}
