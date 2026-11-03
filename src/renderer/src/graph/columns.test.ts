import { describe, expect, it } from 'vitest'
import { MESSAGE_MIN, fitColumns, type ColumnWidths } from './columns'

// The default columns: branch labels, author and date, no SHA
const DEFAULTS: ColumnWidths = { refs: 220, sha: 0, author: 150, date: 140 }
const ALL: ColumnWidths = { refs: 220, sha: 90, author: 150, date: 140 }

const message = (room: number, columns: ColumnWidths): number =>
  room - columns.refs - columns.sha - columns.author - columns.date

describe('fitColumns', () => {
  it('keeps the widths set when the message has room', () => {
    expect(fitColumns(DEFAULTS, 1062)).toEqual(DEFAULTS)
    expect(fitColumns(DEFAULTS, 220 + 150 + 140 + MESSAGE_MIN)).toEqual(DEFAULTS)
    expect(fitColumns(ALL, 2000)).toEqual(ALL)
  })

  it('narrows the branch labels first', () => {
    // A window 1300 pixels wide: 642 beside the lanes
    const fitted = fitColumns(DEFAULTS, 642)
    expect(fitted).toEqual({ refs: 152, sha: 0, author: 150, date: 140 })
    expect(message(642, fitted)).toBe(MESSAGE_MIN)
  })

  it('then narrows and hides the SHA, the author and the date, in turn', () => {
    expect(fitColumns(ALL, 660)).toEqual({ refs: 100, sha: 70, author: 150, date: 140 })
    // Narrower than its floor: hidden, the message gets the rest
    expect(fitColumns(ALL, 600)).toEqual({ refs: 100, sha: 0, author: 150, date: 140 })
    expect(fitColumns(ALL, 520)).toEqual({ refs: 100, sha: 0, author: 80, date: 140 })
    expect(fitColumns(ALL, 500)).toEqual({ refs: 100, sha: 0, author: 0, date: 140 })
    expect(fitColumns(DEFAULTS, 420)).toEqual({ refs: 100, sha: 0, author: 0, date: 120 })
  })

  it('keeps the date whole in a window 1100 pixels wide', () => {
    const fitted = fitColumns(DEFAULTS, 442)
    expect(fitted).toEqual({ refs: 100, sha: 0, author: 0, date: 140 })
    expect(message(442, fitted)).toBeGreaterThanOrEqual(MESSAGE_MIN)
  })

  it('leaves the branch labels and the message in the smallest window', () => {
    // 1000 pixels: 342 beside the lanes
    const fitted = fitColumns(DEFAULTS, 342)
    expect(fitted).toEqual({ refs: 100, sha: 0, author: 0, date: 0 })
    expect(message(342, fitted)).toBeGreaterThan(MESSAGE_MIN)
  })

  it('narrows the branch labels further when nothing else is left, but never hides them', () => {
    expect(fitColumns(DEFAULTS, 290)).toEqual({ refs: 90, sha: 0, author: 0, date: 0 })
    expect(fitColumns(DEFAULTS, 100)).toEqual({ refs: 60, sha: 0, author: 0, date: 0 })
  })

  it('gives the room of hidden or narrower columns to the others', () => {
    expect(fitColumns({ ...DEFAULTS, refs: 0 }, 342)).toEqual({
      refs: 0,
      sha: 0,
      author: 0,
      date: 140
    })
    expect(fitColumns({ ...DEFAULTS, refs: 90 }, 440)).toEqual({
      refs: 90,
      sha: 0,
      author: 0,
      date: 140
    })
    // Set narrower than its floor, a column hides when room runs out
    expect(fitColumns({ ...DEFAULTS, date: 80 }, 360)).toEqual({
      refs: 100,
      sha: 0,
      author: 0,
      date: 0
    })
  })
})
