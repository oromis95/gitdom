// Dates as people say them, "3 hours ago", and as they write them: day first, 25/09/2026, with
// times on 24 hours, whatever the locale of the system.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** How long ago a Unix timestamp in seconds was, e.g. "3 hours ago"; "just now" under a minute. */
export function relativeTime(seconds: number, now = Date.now()): string {
  const diff = seconds - now / 1000
  for (const [unit, size] of UNITS) {
    // Rounded away from zero on both sides: Math.round(-1.5) would give -1
    if (Math.abs(diff) >= size)
      return relative.format(Math.sign(diff) * Math.round(Math.abs(diff) / size), unit)
  }
  return 'just now'
}

const DAY: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }
const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
const SECONDS: Intl.DateTimeFormatOptions = { ...CLOCK, second: '2-digit' }

/** "25/09/2026" */
export const dayFormat = new Intl.DateTimeFormat('en-GB', DAY)
/** "25/09/2026" for a date without a time, read as UTC or it may show as the day before */
export const utcDayFormat = new Intl.DateTimeFormat('en-GB', { ...DAY, timeZone: 'UTC' })
/** "Friday, 25/09/2026" */
export const weekdayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', ...DAY })
/** "25/09/2026, 14:02" */
export const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { ...DAY, ...CLOCK })
/** "25/09/2026, 14:02:37" */
export const dateTimeSecondsFormat = new Intl.DateTimeFormat('en-GB', { ...DAY, ...SECONDS })
/** "14:02" */
export const timeFormat = new Intl.DateTimeFormat('en-GB', CLOCK)
/** "14:02:37" */
export const timeSecondsFormat = new Intl.DateTimeFormat('en-GB', SECONDS)

/** "3 hours ago · 25/09/2026, 14:02" */
export function describeDate(seconds: number): string {
  return `${relativeTime(seconds)} · ${dateTimeFormat.format(seconds * 1000)}`
}
