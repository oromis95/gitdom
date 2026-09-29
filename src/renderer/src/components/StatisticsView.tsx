// Repository statistics, shown in place of the graph: who works on the project and when, how the
// code grew, its languages, the files that change most and those only one person knows.
import { useEffect, useMemo, useState } from 'react'
import { BarChart3, RefreshCw, X } from 'lucide-react'
import type { RepoSnapshot, RepoStatistics, StatisticsOptions } from '../../../shared/types'
import { useApp } from '../store'
import { fromTerminal } from '../ui'
import { laneColor } from '../graph/colors'
import { relativeTime } from '../time'
import {
  WEEKDAYS,
  calendar,
  formatBytes,
  formatCompact,
  formatCount,
  formatSpan,
  growth,
  level,
  punchcardRows,
  yearsOf
} from '../statistics'
import { Avatar } from './HoverCards'

const OPTIONS_KEY = 'gitdom.statistics'
const PERIODS: [number | null, string][] = [
  [null, 'All time'],
  [365, 'Last year'],
  [180, 'Last 6 months'],
  [90, 'Last 3 months'],
  [30, 'Last 30 days']
]
const AUTHORS_SHOWN = 15

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const formatDate = (seconds: number): string => dateFormat.format(seconds * 1000)
// Calendar days are dates without a time: read them as UTC, or they may show as the day before
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
const monthLabel = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })
const shortMonth = (month: string): string => monthLabel.format(new Date(`${month}-01`))

function loadOptions(): StatisticsOptions {
  try {
    const saved = JSON.parse(
      localStorage.getItem(OPTIONS_KEY) ?? '{}'
    ) as Partial<StatisticsOptions>
    return {
      sinceDays: PERIODS.some(([days]) => days === saved.sinceDays) ? saved.sinceDays! : null,
      allBranches: saved.allBranches === true
    }
  } catch {
    return { sinceDays: null, allBranches: false }
  }
}

/** Changes whenever the history the statistics cover does. */
const versionOf = (snapshot: RepoSnapshot, options: StatisticsOptions): string =>
  options.allBranches
    ? snapshot.refs.map((r) => r.fullName + r.hash).join()
    : String(snapshot.head.hash)

// Reading a long history takes a while: results stay until GitDom closes, and a refresh is asked
// for rather than automatic
const results = new Map<string, { stats: RepoStatistics; version: string }>()

function Card({
  title,
  hint,
  children,
  wide
}: {
  title: string
  hint?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <section className={`stats-card${wide ? ' wide' : ''}`}>
      <h3>{title}</h3>
      {hint && <div className="stats-hint">{hint}</div>}
      {children}
    </section>
  )
}

function Summary({ stats }: { stats: RepoStatistics }): React.JSX.Element {
  const activeDays = Object.keys(stats.days).length
  const items: [string, string, string?][] = [
    [
      'Commits',
      formatCount(stats.commits),
      stats.merges ? `${formatCount(stats.merges)} merges` : undefined
    ],
    ['Authors', formatCount(stats.authorCount)],
    ['Active days', formatCount(activeDays)],
    [
      'Lines',
      `+${formatCompact(stats.added)} −${formatCompact(stats.deleted)}`,
      'added and deleted'
    ],
    [
      'Files',
      formatCount(stats.trackedFiles),
      `${formatCount(stats.changedFiles)} changed in this period`
    ],
    [
      'Span',
      stats.first && stats.last ? formatSpan(stats.last - stats.first) : '—',
      stats.first && stats.last
        ? `${formatDate(stats.first)} – ${formatDate(stats.last)}`
        : undefined
    ]
  ]
  return (
    <div className="stats-summary">
      {items.map(([label, value, note]) => (
        <div key={label} className="stats-figure">
          <span className="stats-figure-value">{value}</span>
          <span className="stats-figure-label">{label}</span>
          {note && <span className="stats-figure-note">{note}</span>}
        </div>
      ))}
    </div>
  )
}

const CELL = 13

function ActivityCalendar({ days }: { days: Record<string, number> }): React.JSX.Element {
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

function MonthlyChart({ stats }: { stats: RepoStatistics }): React.JSX.Element {
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

function Punchcard({ punchcard }: { punchcard: number[][] }): React.JSX.Element {
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

function Authors({ stats }: { stats: RepoStatistics }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? stats.authors : stats.authors.slice(0, AUTHORS_SHOWN)
  return (
    <>
      <div className="stats-table">
        {shown.map((a) => {
          const share = stats.commits ? a.commits / stats.commits : 0
          return (
            <div key={a.email + a.name} className="stats-row">
              <Avatar name={a.name} email={a.email} size={22} />
              <span className="stats-name" title={a.email}>
                {a.name}
              </span>
              <span
                className="stats-bar-cell"
                title={`${Math.round(share * 1000) / 10}% of the commits`}
              >
                <span className="stats-share" style={{ width: `${share * 100}%` }} />
              </span>
              <span className="stats-number">{formatCount(a.commits)}</span>
              <span className="stats-number add">+{formatCount(a.added)}</span>
              <span className="stats-number del">−{formatCount(a.deleted)}</span>
              <span
                className="stats-dates muted"
                title={`${formatDate(a.first)} – ${formatDate(a.last)}`}
              >
                {a.first === a.last
                  ? formatDate(a.first)
                  : `${formatDate(a.first)} – ${formatDate(a.last)}`}
              </span>
            </div>
          )
        })}
      </div>
      {stats.authors.length > AUTHORS_SHOWN && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${stats.authors.length}`}
        </button>
      )}
      {stats.authorCount > stats.authors.length && (
        <div className="stats-hint">
          The {stats.authors.length} most active authors of {formatCount(stats.authorCount)}.
        </div>
      )}
    </>
  )
}

function Languages({ stats }: { stats: RepoStatistics }): React.JSX.Element {
  const total = stats.languages.reduce((sum, l) => sum + l.bytes, 0)
  if (!total) return <div className="muted">No source files GitDom recognizes</div>
  const percent = (bytes: number): string => {
    const value = (bytes / total) * 100
    return `${value < 1 ? value.toFixed(1) : Math.round(value)}%`
  }
  return (
    <>
      <div className="stats-stack">
        {stats.languages.map((l, i) => (
          <span
            key={l.name}
            style={{ width: `${(l.bytes / total) * 100}%`, background: laneColor(i) }}
            title={`${l.name}: ${percent(l.bytes)}`}
          />
        ))}
      </div>
      <div className="stats-languages">
        {stats.languages.map((l, i) => (
          <span key={l.name} className="stats-language">
            <i className="stats-swatch" style={{ background: laneColor(i) }} />
            <span>{l.name}</span>
            <span className="muted">
              {percent(l.bytes)} · {formatCount(l.files)} file{l.files === 1 ? '' : 's'} ·{' '}
              {formatBytes(l.bytes)}
            </span>
          </span>
        ))}
      </div>
    </>
  )
}

function HotFiles({ stats }: { stats: RepoStatistics }): React.JSX.Element {
  const inspectFile = useApp((s) => s.inspectFile)
  if (!stats.hotspots.length) return <div className="muted">No files changed</div>
  const hottest = stats.hotspots[0].heat || 1
  return (
    <div className="stats-table">
      {stats.hotspots.map((f) => (
        <div
          key={f.path}
          className="stats-row clickable"
          title="Open the file's history"
          onClick={() => inspectFile({ path: f.path, mode: 'history', rev: null })}
        >
          <span className="stats-path mono">
            <bdi>{f.path}</bdi>
          </span>
          <span className="stats-bar-cell" title={`Heat ${f.heat}`}>
            <span className="stats-share hot" style={{ width: `${(f.heat / hottest) * 100}%` }} />
          </span>
          <span className="stats-number" title="Commits that changed it">
            {formatCount(f.changes)}×
          </span>
          <span className="stats-number muted" title="Authors who changed it">
            {f.authors} author{f.authors === 1 ? '' : 's'}
          </span>
          <span className="stats-dates muted" title={formatDate(f.last)}>
            {relativeTime(f.last)}
          </span>
        </div>
      ))}
    </div>
  )
}

function Knowledge({ stats }: { stats: RepoStatistics }): React.JSX.Element {
  const inspectFile = useApp((s) => s.inspectFile)
  return (
    <>
      <div className="stats-bus">
        <span className="stats-figure-value">{stats.busFactor}</span>
        <span>
          {stats.busFactor === 1 ? 'person is' : 'people are'} the main author of half the files. If{' '}
          {stats.busFactor === 1 ? 'they leave' : 'they all leave'}, most of the code has no one who
          knows it well.
        </span>
      </div>
      {stats.soloFiles.length ? (
        <div className="stats-table">
          {stats.soloFiles.map((f) => (
            <div
              key={f.path}
              className="stats-row clickable"
              title="Open the file's blame"
              onClick={() => inspectFile({ path: f.path, mode: 'blame', rev: null })}
            >
              <span className="stats-path mono">
                <bdi>{f.path}</bdi>
              </span>
              <span className="stats-name">{f.owner}</span>
              <span className="stats-number">{formatCount(f.changes)}×</span>
              <span className="stats-dates muted">{relativeTime(f.last)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted">Every changed file has more than one author</div>
      )}
    </>
  )
}

function Report({ stats }: { stats: RepoStatistics }): React.JSX.Element {
  if (!stats.commits) {
    return <div className="center-message">No commits in this period</div>
  }
  return (
    <div className="stats-grid">
      <Summary stats={stats} />
      <Card title="Activity" wide>
        <ActivityCalendar days={stats.days} />
      </Card>
      <Card title="Commits and code over time" wide>
        <MonthlyChart stats={stats} />
      </Card>
      <Card title="When commits are made" hint="In each author's own time zone">
        <Punchcard punchcard={stats.punchcard} />
      </Card>
      <Card
        title="Languages"
        hint="By size of the files in the current version; generated and vendored files don't count"
      >
        <Languages stats={stats} />
      </Card>
      <Card title="Authors" wide>
        <Authors stats={stats} />
      </Card>
      <Card
        title="Hot files"
        hint="Files changed most, and most recently: where bugs and conflicts tend to be. Click one to see its history."
      >
        <HotFiles stats={stats} />
      </Card>
      <Card
        title="Files only one person knows"
        hint="Changed by a single author. Click one to see its blame."
      >
        <Knowledge stats={stats} />
      </Card>
    </div>
  )
}

export default function StatisticsView({
  snapshot
}: {
  snapshot: RepoSnapshot
}): React.JSX.Element {
  const repo = snapshot.path
  const openStatistics = useApp((s) => s.openStatistics)
  const [options, setOptions] = useState(loadOptions)
  const [reloads, setReloads] = useState(0)
  const [failure, setFailure] = useState<{ key: string; error: string } | null>(null)
  const [progress, setProgress] = useState(0)
  // Results live outside React: counting them re-renders when one arrives
  const [, setArrived] = useState(0)
  const key = `${repo}\0${options.allBranches}\0${options.sinceDays}`
  const loadKey = `${key}\0${reloads}`
  const version = versionOf(snapshot, options)
  const result = results.get(key)

  useEffect(() => {
    if (results.has(key)) return
    let active = true
    const started = version
    void window.api.statistics.load(repo, options).then((loaded) => {
      if (!active) return
      if (loaded.ok) {
        results.set(key, { stats: loaded.value, version: started })
        setArrived((n) => n + 1)
      } else setFailure({ key: loadKey, error: loaded.error })
    })
    return () => {
      active = false
      window.api.statistics.cancel(repo)
    }
    // loadKey identifies the request; version is read when it starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey])

  useEffect(
    () =>
      window.api.statistics.onProgress((p) => {
        if (p.repo === repo) setProgress(p.commits)
      }),
    [repo]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !fromTerminal(e) && !document.querySelector('.modal, .menu'))
        openStatistics(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openStatistics])

  const change = (next: Partial<StatisticsOptions>): void => {
    const merged = { ...options, ...next }
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(merged))
    setProgress(0)
    setOptions(merged)
  }
  const reload = (): void => {
    results.delete(key)
    setProgress(0)
    setReloads(reloads + 1)
  }
  const failed = failure?.key === loadKey ? failure.error : null

  let body: React.ReactNode
  if (result) body = <Report stats={result.stats} />
  else if (failed) {
    body = (
      <div className="center-message">
        <div>{failed === 'Cancelled' ? 'Stopped' : failed}</div>
        <button className="btn" onClick={reload}>
          Try again
        </button>
      </div>
    )
  } else {
    body = (
      <div className="center-message">
        <div>Reading the history…{progress ? ` ${formatCount(progress)} commits` : ''}</div>
        <button className="btn" onClick={() => window.api.statistics.cancel(repo)}>
          Stop
        </button>
      </div>
    )
  }

  return (
    <div className="diff-view inspector statistics">
      <div className="diff-header">
        <BarChart3 size={16} />
        <span className="diff-path">Statistics</span>
        <span className="toolbar-spacer" />
        {result && result.version !== version && (
          <button
            className="row-action stats-stale"
            onClick={reload}
            title="Read the history again"
          >
            <RefreshCw size={13} /> The repository changed: refresh
          </button>
        )}
        <div className="segmented">
          <button
            className={options.allBranches ? '' : 'active'}
            onClick={() => change({ allBranches: false })}
            title="The commits the current branch reaches"
          >
            {snapshot.head.branch ?? 'HEAD'}
          </button>
          <button
            className={options.allBranches ? 'active' : ''}
            onClick={() => change({ allBranches: true })}
            title="Every local and remote branch, and the tags"
          >
            All branches
          </button>
        </div>
        <select
          className="stats-period"
          value={String(options.sinceDays)}
          onChange={(e) =>
            change({ sinceDays: e.target.value === 'null' ? null : Number(e.target.value) })
          }
        >
          {PERIODS.map(([days, label]) => (
            <option key={label} value={String(days)}>
              {label}
            </option>
          ))}
        </select>
        {result && (
          <button className="diff-close" onClick={reload} title="Read the history again">
            <RefreshCw size={15} />
          </button>
        )}
        <button className="diff-close" onClick={() => openStatistics(false)} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      <div className="stats-body">{body}</div>
    </div>
  )
}
