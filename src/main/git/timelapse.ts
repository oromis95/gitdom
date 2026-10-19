// The time-lapse of a file: every version, and the identity of each line through them, computed
// from the versions' text with a line diff instead of a `git blame` for each. Plain code with no
// git or Electron: ops/log.ts reads the versions and a worker thread (main/workers) runs this.
import { matchLines } from '../../shared/lineDiff'
import type { Timelapse, TimelapseGhosts } from '../../shared/types'

/** Lines of all the versions together: older versions are left out beyond it */
const TIMELAPSE_LINES = 8_000_000
/** A version bigger than this stops the time-lapse */
const TIMELAPSE_FILE_LIMIT = 2 * 1024 * 1024

/** What ops/log.ts reads with git for a time-lapse. */
export interface TimelapseInput {
  path: string
  /** The commits that changed the file, newest first, with the parents among them */
  commits: { hash: string; parents: string[] }[]
  /** `git cat-file --batch` output with the file at each commit, in the same order */
  batch: Uint8Array
  /** The file on disk, null when it isn't there */
  onDisk: Uint8Array | null
}

export type TimelapseFrames = Pick<Timelapse, 'text' | 'born' | 'frames' | 'ghosts'> & {
  /** How many of the newest commits are shown */
  kept: number
  /** For each commit shown, oldest first: the file doesn't exist in it */
  deleted: boolean[]
  /** For each commit shown, oldest first: the id of the file in it */
  blobs: (string | undefined)[]
  /** The file on disk differs from the last commit: one more version, after the others */
  uncommitted: boolean
}

const bufferOf = (bytes: Uint8Array): Buffer =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** The lines of a version, or an error for content the time-lapse can't show. */
export function versionLines(data: Buffer, path: string): string[] {
  if (data.length > TIMELAPSE_FILE_LIMIT)
    throw new Error(`${path} is too large for a time-lapse in some versions`)
  // Like git: a NUL byte near the start makes a file binary
  if (data.subarray(0, 8000).includes(0)) throw new Error(`${path} is a binary file`)
  const text = data.toString('utf8').replace(/\r?\n$/, '')
  return text ? text.split(/\r?\n/) : []
}

/** Objects read with `git cat-file --batch`: the id and content of each, or null when missing. */
export function parseBatch(output: Buffer): ({ oid: string; data: Buffer } | null)[] {
  const objects: ({ oid: string; data: Buffer } | null)[] = []
  let at = 0
  while (at < output.length) {
    const end = output.indexOf(0x0a, at)
    if (end < 0) break
    const header = output.subarray(at, end).toString('utf8')
    at = end + 1
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
      objects.push(null)
      continue
    }
    const [oid, type, size] = header.split(' ')
    if (type !== 'blob') throw new Error('Not a file in some versions')
    objects.push({ oid, data: output.subarray(at, at + Number(size)) })
    at += Number(size) + 1
  }
  return objects
}

/** The versions of a file read by git, and their lines with an identity through them. */
export function computeTimelapse({
  path,
  commits,
  batch,
  onDisk
}: TimelapseInput): TimelapseFrames {
  const contents = parseBatch(bufferOf(batch))
  // Newest first, until the lines of all versions get too many
  let total = 0
  let kept = 0
  const texts: (string[] | null)[] = []
  for (; kept < commits.length; kept++) {
    const object = contents[kept]
    const lines = object ? versionLines(object.data, path) : null
    total += lines?.length ?? 0
    if (total > TIMELAPSE_LINES && kept > 0) break
    texts.push(lines)
  }
  const shown = commits.slice(0, kept).reverse()
  const blobs = contents
    .slice(0, kept)
    .reverse()
    .map((b) => b?.oid)
  texts.reverse()
  const index = new Map(shown.map((c, i) => [c.hash, i]))
  const versions: TimelapseVersion[] = shown.map((c, i) => ({
    parents: c.parents.map((p) => index.get(p) ?? -1).filter((p) => p >= 0),
    lines: texts[i]
  }))

  // The uncommitted changes, as a last version
  let uncommitted = false
  const latest = versions.length ? versions[versions.length - 1].lines : null
  if (onDisk) {
    const lines = versionLines(bufferOf(onDisk), path)
    if (!latest || lines.length !== latest.length || lines.some((l, i) => l !== latest[i])) {
      versions.push({ parents: versions.length ? [versions.length - 1] : [], lines })
      uncommitted = true
    }
  }
  if (!versions.length) throw new Error(`${path} has no history on this branch`)
  return {
    ...buildFrames(versions),
    kept,
    deleted: texts.map((t) => t === null),
    blobs,
    uncommitted
  }
}

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
