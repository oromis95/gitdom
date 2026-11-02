import { describe, expect, it } from 'vitest'
import {
  dateTimeFormat,
  dateTimeSecondsFormat,
  dayFormat,
  relativeTime,
  timeFormat,
  timeSecondsFormat,
  utcDayFormat,
  weekdayFormat
} from './time'

describe('relativeTime', () => {
  const now = Date.UTC(2026, 8, 25, 12) // ms
  const ago = (seconds: number): string => relativeTime(now / 1000 - seconds, now)

  it('picks the largest fitting unit', () => {
    expect(ago(10)).toBe('just now')
    expect(ago(90)).toBe('2 minutes ago')
    expect(ago(3 * 3600)).toBe('3 hours ago')
    expect(ago(24 * 3600)).toBe('yesterday')
    expect(ago(9 * 24 * 3600)).toBe('last week')
    expect(ago(400 * 24 * 3600)).toBe('last year')
  })

  it('handles dates in the future, from clocks out of step', () => {
    expect(relativeTime(now / 1000 + 2 * 3600, now)).toBe('in 2 hours')
  })
})

describe('date formats', () => {
  // Local time: the formats show dates in the system's time zone
  const afternoon = new Date(2026, 1, 3, 14, 5, 9)
  const morning = new Date(2026, 1, 3, 9, 5, 9)

  it('puts the day first, with two digits each and the whole year', () => {
    expect(dayFormat.format(afternoon)).toBe('03/02/2026')
    expect(weekdayFormat.format(afternoon)).toBe('Tuesday, 03/02/2026')
    expect(utcDayFormat.format(new Date('2026-02-03'))).toBe('03/02/2026')
  })

  it('tells the time on 24 hours', () => {
    expect(dateTimeFormat.format(afternoon)).toBe('03/02/2026, 14:05')
    expect(dateTimeSecondsFormat.format(afternoon)).toBe('03/02/2026, 14:05:09')
    expect(timeFormat.format(morning)).toBe('09:05')
    expect(timeSecondsFormat.format(afternoon)).toBe('14:05:09')
  })
})
