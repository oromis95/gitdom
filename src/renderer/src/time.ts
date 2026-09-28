// Dates as people say them: "3 hours ago", "in 2 days".

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

export const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

/** "3 hours ago · 25 Sept 2026, 14:02" */
export function describeDate(seconds: number): string {
  return `${relativeTime(seconds)} · ${dateTimeFormat.format(seconds * 1000)}`
}
