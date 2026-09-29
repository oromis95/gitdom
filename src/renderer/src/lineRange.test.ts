import { describe, expect, it } from 'vitest'
import { foldContext, functionRange, rangeLabel } from './lineRange'

describe('line ranges', () => {
  it('names lines and functions', () => {
    expect(rangeLabel('12,40')).toBe('lines 12–40')
    expect(rangeLabel('7,7')).toBe('line 7')
    expect(rangeLabel(':parse')).toBe('function parse')
  })

  it('escapes function names for git, and reads them back', () => {
    expect(functionRange('parse')).toBe(':parse')
    expect(functionRange('a.b(c)')).toBe(':a\\.b\\(c\\)')
    expect(rangeLabel(functionRange('a.b(c)'))).toBe('function a.b(c)')
  })
})

describe('folding unchanged lines', () => {
  const hunk = (types: string): { type: string }[] =>
    [...types].map((t) => ({ type: t === '+' ? 'add' : t === '-' ? 'del' : 'context' }))

  it('keeps lines next to the changes and folds the long runs', () => {
    // 12 unchanged, a change, 12 unchanged, a change, 2 unchanged
    const rows = foldContext(hunk('............+............-..'))
    expect(rows).toEqual([
      { start: 0, end: 8 },
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      { start: 16, end: 21 },
      22,
      23,
      24,
      25,
      26,
      27
    ])
  })

  it('leaves short runs and hunks without changes alone', () => {
    expect(foldContext(hunk('+.....-'))).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(foldContext(hunk('+++'))).toEqual([0, 1, 2])
  })
})
