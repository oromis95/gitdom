import { describe, expect, it } from 'vitest'
import {
  calendar,
  formatBytes,
  formatCompact,
  formatCount,
  formatSpan,
  growth,
  level,
  punchcardRows,
  yearsOf
} from './statistics'

describe('statistics charts', () => {
  it('lays out a year in weeks starting on Monday', () => {
    // January 1st 2026 is a Thursday
    const year = calendar({ '2026-01-01': 2, '2026-01-05': 8, '2025-12-31': 5 }, 2026)
    expect(year.days).toHaveLength(365)
    expect(year.days[0]).toEqual({ date: '2026-01-01', count: 2, week: 0, weekday: 3, level: 1 })
    // The next Monday starts the second column
    expect(year.days[4]).toMatchObject({ date: '2026-01-05', week: 1, weekday: 0, level: 4 })
    expect(year.days[364].date).toBe('2026-12-31')
    expect(year.weeks).toBe(53)
    expect(year.months[0]).toEqual({ label: 'Jan', week: 0 })
    expect(year.months[1]).toEqual({ label: 'Feb', week: 4 })
    expect([year.total, year.active]).toEqual([10, 2])
    expect(calendar({}, 2024).days).toHaveLength(366)
  })

  it('shades days by how busy they are', () => {
    expect([0, 1, 3, 5, 8, 20].map((n) => level(n, 8))).toEqual([0, 1, 2, 3, 4, 4])
    expect(level(3, 0)).toBe(0)
  })

  it('lists years, grows the code month by month and starts the week on Monday', () => {
    expect(yearsOf({ '2024-05-01': 1, '2026-01-01': 1, '2024-06-01': 1 })).toEqual([2026, 2024])
    const month = (
      added: number,
      deleted: number
    ): { month: string; commits: number; added: number; deleted: number } => ({
      month: '2026-01',
      commits: 1,
      added,
      deleted
    })
    expect(growth([month(100, 0), month(10, 30), month(0, 0)])).toEqual([100, 80, 80])
    const card = Array.from({ length: 7 }, (_, day) => new Array(24).fill(day))
    expect(punchcardRows(card).map((row) => row[0])).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('formats counts, sizes and spans', () => {
    expect([100, 86400, 40 * 86400, 300 * 86400, 1000 * 86400].map(formatSpan)).toEqual([
      'less than a day',
      '1 day',
      '40 days',
      '10 months',
      '2.5 years'
    ])
    expect([formatCount(1234), formatCount(12345), formatCount(4_500_000)]).toEqual([
      '1,234',
      '12.3K',
      '4.5M'
    ])
    expect([formatCompact(950), formatCompact(1251)]).toEqual(['950', '1.3K'])
    expect([formatBytes(512), formatBytes(2048), formatBytes(50 * 1024 * 1024)]).toEqual([
      '512 B',
      '2.0 KB',
      '50 MB'
    ])
  })
})
