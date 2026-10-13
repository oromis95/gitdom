import { describe, expect, it } from 'vitest'
import type { Timelapse, TimelapseRevision } from '../../shared/types'
import { frameRows, nextStep, recency, searchSteps, stepsWith } from './timelapse'

const revision = (subject: string, authorName = 'Ann'): TimelapseRevision => ({
  hash: `${subject}0000`,
  authorName,
  authorEmail: `${authorName.toLowerCase()}@x.it`,
  authorDate: 0,
  subject,
  deleted: false
})

// a b c → a B c d → B c d
const t: Timelapse = {
  path: 'f.txt',
  revisions: [revision('create'), revision('edit', 'Bob'), revision('trim')],
  text: ['a', 'b', 'c', 'B', 'd'],
  born: Int32Array.from([0, 0, 0, 1, 1]),
  frames: [Int32Array.from([0, 1, 2]), Int32Array.from([0, 3, 2, 4]), Int32Array.from([3, 2, 4])],
  ghosts: [[], [{ at: 1, lines: [1] }], [{ at: 0, lines: [0] }]],
  tags: [],
  truncated: false
}
const lower = t.text.map((s) => s.toLowerCase())
const all = { added: true, removed: true, commits: true }

describe('time-lapse', () => {
  it('puts the removed lines where they were', () => {
    const rows = (f: number, ghosts: boolean): string[] =>
      frameRows(t, f, ghosts).map((r) => (r.ghost ? '-' : '') + t.text[r.id])
    expect(rows(1, true)).toEqual(['a', '-b', 'B', 'c', 'd'])
    expect(rows(1, false)).toEqual(['a', 'B', 'c', 'd'])
    expect(rows(2, true)).toEqual(['-a', 'B', 'c', 'd'])
  })

  it('fades the changes over the steps after them', () => {
    expect(recency(0)).toBe(1)
    expect(recency(4)).toBeGreaterThan(recency(8))
    expect(recency(100)).toBe(0)
  })

  it('finds the steps that add or remove a text, or whose commit matches', () => {
    expect(searchSteps(t, lower, 'b', all)).toEqual([0, 1])
    expect(searchSteps(t, lower, 'b', { ...all, removed: false, commits: false })).toEqual([0, 1])
    expect(searchSteps(t, lower, 'a', { ...all, added: false, commits: false })).toEqual([2])
    expect(searchSteps(t, lower, 'bob', { ...all, added: false, removed: false })).toEqual([1])
    expect(searchSteps(t, lower, '  ', all)).toEqual([])
  })

  it('knows where a line exists, and the next step of a list', () => {
    expect(stepsWith(t, 3)).toEqual([false, true, true])
    expect(nextStep([0, 2, 5], 2, false)).toBe(5)
    expect(nextStep([0, 2, 5], 2, true)).toBe(0)
    expect(nextStep([0, 2, 5], 5, false)).toBeUndefined()
  })
})
