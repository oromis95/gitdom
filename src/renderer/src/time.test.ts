import { describe, expect, it } from 'vitest'
import { relativeTime } from './time'

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
