// The charts of the statistics, drawn in SVG: the activity calendar, commits and code by month,
// and the hours of the week commits are made.
import { useMemo, useState } from 'react'
import type { RepoStatistics } from '../../../../shared/types'
import {
  WEEKDAYS,
  calendar,
  formatCount,
  growth,
  level,
  punchcardRows,
  yearsOf
} from '../../statistics'

// Calendar days are dates without a time: read them as UTC, or they may show as the day before
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
const monthLabel = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })
const shortMonth = (month: string): string => monthLabel.format(new Date(`${month}-01`))

const CELL = 13

export function ActivityCalendar({ days }: { days: Record<string, number> }): React.JSX.Element {
  const years = useMemo(() => yearsOf(days), [days])
  const [picked, setPicked] = useState<number | null>(null)
  const year = picked !== null && years.includes(picked) ? picked : years[0]
  const shown = useMemo(() => (year ? calendar(days, year) : null), [days, year])
  if (!shown) return <div className="muted">No commits</div>
  const left = 30
  const top = 16
  return (
    <>
      <div className="stats-toolbar">
        <span className="muted">
          {formatCount(shown.total)} commits on {shown.active} days in {year}
        </span>
        <span className="toolbar-spacer" />
        {years.length > 1 && (
          <select value={year} onChange={(e) => setPicked(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
      </div>
      <svg
        className="stats-chart"
        viewBox={`0 0 ${left + shown.weeks * CELL} ${top + 7 * CELL + 16}`}
        role="img"
        aria-label={`Commits per day in ${year}`}
      >
        {shown.months.map((m) => (
          <text key={m.label} className="stats-axis" x={left + m.week * CELL} y={10}>
            {m.label}
          </text>
        ))}
        {[0, 2, 4].map((row) => (
          <text key={row} className="stats-axis" x={0} y={top + row * CELL + 10}>
            {WEEKDAYS[row]}
          </text>
        ))}
        {shown.days.map((d) => (
          <rect
            key={d.date}
            className={`stats-level l${d.level}`}
            x={left + d.week * CELL}
            y={top + d.weekday * CELL}
            width={CELL - 2}
            height={CELL - 2}
            rx={2}
          >
            <title>
              {d.count} commit{d.count === 1 ? '' : 's'} on {dayFormat.format(new Date(d.date))}
            </title>
          </rect>
        ))}
        <g
          transform={`translate(${left + shown.weeks * CELL - 5 * CELL - 30}, ${top + 7 * CELL + 3})`}
        >
          <text className="stats-axis" x={-4} y={9} textAnchor="end">
            Less
          </text>
          {[0, 1, 2, 3, 4].map((l) => (
            <rect
              key={l}
              className={`stats-level l${l}`}
              x={l * CELL}
              y={0}
              width={CELL - 2}
              height={CELL - 2}
              rx={2}
            />
          ))}
          <text className="stats-axis" x={5 * CELL + 2} y={9}>
            More
          </text>
        </g>
      </svg>
    </>
  )
}

export function MonthlyChart({ stats }: { stats: RepoStatistics }): React.JSX.Element {
  const months = stats.months
  if (!months.length) return <div className="muted">No commits</div>
  const lines = growth(months)
  const width = 720
  const height = 190
  const [left, right, top, bottom] = [40, 52, 10, 34]
  const plotW = width - left - right
  const plotH = height - top - bottom
  const step = plotW / months.length
  const most = Math.max(1, ...months.map((m) => m.commits))
  const low = Math.min(0, ...lines)
  const high = Math.max(1, ...lines)
  const lineY = (v: number): number => top + plotH * (1 - (v - low) / (high - low || 1))
  const points = lines.map((v, i) => `${left + step * (i + 0.5)},${lineY(v)}`).join(' ')
  // A short history keeps its bars slim instead of filling the whole width
  const barWidth = Math.max(1, Math.min(step * 0.7, 32))
  const yearly = months.length > 18
  return (
    <>
      <div className="stats-legend">
        <span>
          <i className="stats-swatch commits" /> Commits per month
        </span>
        <span>
          <i className="stats-swatch growth" /> Lines of code (added minus deleted
          {stats.first !== null && stats.commits ? ', since the first commit covered' : ''})
        </span>
      </div>
      <svg
        className="stats-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Commits per month"
      >
        <line
          className="stats-gridline"
          x1={left}
          x2={left + plotW}
          y1={top + plotH}
          y2={top + plotH}
        />
        <text className="stats-axis" x={left - 6} y={top + 8} textAnchor="end">
          {formatCount(most)}
        </text>
        <text className="stats-axis" x={left - 6} y={top + plotH} textAnchor="end">
          0
        </text>
        <text className="stats-axis growth" x={left + plotW + 6} y={lineY(high) + 8}>
          {formatCount(high)}
        </text>
        {low < 0 && (
          <text className="stats-axis growth" x={left + plotW + 6} y={lineY(low)}>
            {formatCount(low)}
          </text>
        )}
        {months.map((m, i) => {
          const x = left + step * i
          const h = (m.commits / most) * plotH
          const january = m.month.endsWith('-01')
          const label = yearly ? january && m.month.slice(0, 4) : shortMonth(m.month)
          const year = !yearly && (i === 0 || january) && m.month.slice(0, 4)
          return (
            <g key={m.month}>
              <rect
                className="stats-bar"
                x={x + (step - barWidth) / 2}
                y={top + plotH - h}
                width={barWidth}
                height={h}
              />
              {label && (
                <text
                  className="stats-axis"
                  x={x + step / 2}
                  y={top + plotH + 14}
                  textAnchor="middle"
                >
                  {label}
                </text>
              )}
              {year && (
                <text
                  className="stats-axis"
                  x={x + step / 2}
                  y={top + plotH + 27}
                  textAnchor="middle"
                >
                  {year}
                </text>
              )}
              <rect className="stats-hit" x={x} y={top} width={step} height={plotH}>
                <title>
                  {m.month}: {m.commits} commit{m.commits === 1 ? '' : 's'}, +{formatCount(m.added)}{' '}
                  −{formatCount(m.deleted)} lines, {formatCount(lines[i])} lines in total
                </title>
              </rect>
            </g>
          )
        })}
        <polyline className="stats-line" points={points} />
        {months.length === 1 && (
          <circle className="stats-point" cx={left + step / 2} cy={lineY(lines[0])} r={3} />
        )}
      </svg>
    </>
  )
}

export function Punchcard({ punchcard }: { punchcard: number[][] }): React.JSX.Element {
  const rows = punchcardRows(punchcard)
  const most = Math.max(1, ...rows.flat())
  const size = 26
  const [left, top] = [36, 18]
  return (
    <svg
      className="stats-chart"
      viewBox={`0 0 ${left + 24 * size} ${top + 7 * size}`}
      role="img"
      aria-label="Commits by weekday and hour"
    >
      {Array.from({ length: 24 }, (_, hour) =>
        hour % 3 === 0 ? (
          <text
            key={hour}
            className="stats-axis"
            x={left + hour * size + size / 2}
            y={11}
            textAnchor="middle"
          >
            {hour}
          </text>
        ) : null
      )}
      {rows.map((row, day) => (
        <g key={day}>
          <text className="stats-axis" x={0} y={top + day * size + size / 2 + 4}>
            {WEEKDAYS[day]}
          </text>
          {row.map((count, hour) => (
            <circle
              key={hour}
              className={`stats-dot l${level(count, most)}`}
              cx={left + hour * size + size / 2}
              cy={top + day * size + size / 2}
              r={count ? 2 + Math.sqrt(count / most) * (size / 2 - 3) : 1.5}
            >
              <title>
                {count} commit{count === 1 ? '' : 's'} on {WEEKDAYS[day]} at {hour}:00–{hour}:59
              </title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  )
}
