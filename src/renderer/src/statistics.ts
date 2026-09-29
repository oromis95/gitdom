// Shapes of the statistics charts: the activity calendar, levels of color and the code growth.
// Pure functions, so they can be tested without drawing.
import type { MonthStats } from '../../shared/types'

export interface CalendarDay {
  /** "YYYY-MM-DD" */
  date: string
  count: number
  /** Column: weeks since the one of January 1st */
  week: number
  /** Row: 0 is Monday */
  weekday: number
  /** 0 without commits, then 1 to 4 as the day gets busier */
  level: number
}

export interface Calendar {
  days: CalendarDay[]
  weeks: number
  /** Week where each month starts, for the labels above the columns */
  months: { label: string; week: number }[]
  total: number
  /** Days with at least one commit */
  active: number
}

const monthName = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })

/** Levels of color: a quarter of the busiest day each, so one frantic day doesn't flatten the rest. */
export function level(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)))
}

/** Every day of `year`, laid out in weeks from Monday, with its commits. */
export function calendar(days: Record<string, number>, year: number): Calendar {
  const start = Date.UTC(year, 0, 1)
  const end = Date.UTC(year + 1, 0, 1)
  // Monday is 0: the first column starts on the Monday of January 1st's week
  const offset = (new Date(start).getUTCDay() + 6) % 7
  const result: CalendarDay[] = []
  const months: Calendar['months'] = []
  let max = 0
  for (let time = start, i = 0; time < end; time += 86400000, i++) {
    const date = new Date(time).toISOString().slice(0, 10)
    const count = days[date] ?? 0
    max = Math.max(max, count)
    const week = Math.floor((i + offset) / 7)
    if (date.endsWith('-01')) months.push({ label: monthName.format(time), week })
    result.push({ date, count, week, weekday: (i + offset) % 7, level: 0 })
  }
  for (const day of result) day.level = level(day.count, max)
  return {
    days: result,
    weeks: result[result.length - 1].week + 1,
    months,
    total: result.reduce((sum, d) => sum + d.count, 0),
    active: result.filter((d) => d.count > 0).length
  }
}

/** Years with commits, newest first. */
export function yearsOf(days: Record<string, number>): number[] {
  const years = new Set(Object.keys(days).map((d) => Number(d.slice(0, 4))))
  return [...years].sort((a, b) => b - a)
}

/**
 * Lines of code at the end of each month, as added minus deleted since the first commit covered;
 * with a period filter it's the growth over the period.
 */
export function growth(months: MonthStats[]): number[] {
  let lines = 0
  return months.map((m) => (lines += m.added - m.deleted))
}

/** The days of the week from Monday, as the punchcard rows show them; git counts from Sunday. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const punchcardRows = (punchcard: number[][]): number[][] =>
  WEEKDAYS.map((_, i) => punchcard[(i + 1) % 7])

/** How long a stretch of time is, roughly: "5 days", "3 months", "2.5 years". */
export function formatSpan(seconds: number): string {
  const days = seconds / 86400
  if (days < 1) return 'less than a day'
  if (days < 60) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
  if (days < 730) return `${Math.round(days / 30.44)} months`
  const years = Math.round((days / 365.25) * 2) / 2
  return `${years} years`
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const plain = new Intl.NumberFormat('en')

/** "1,234" up to 10,000, then "12.3K", "4.5M". */
export const formatCount = (n: number): string =>
  Math.abs(n) < 10000 ? plain.format(n) : compact.format(n)

/** "950", then "1.2K", "4.5M": for figures that must stay short. */
export const formatCompact = (n: number): string => compact.format(n)

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
