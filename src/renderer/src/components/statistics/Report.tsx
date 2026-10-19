// The statistics once read: the figures, the charts, and the tables of authors and files.
import { useState } from 'react'
import type { RepoStatistics } from '../../../../shared/types'
import { useApp } from '../../store'
import { laneColor } from '../../graph/colors'
import { relativeTime } from '../../time'
import { formatBytes, formatCompact, formatCount, formatSpan } from '../../statistics'
import { Avatar } from '../HoverCards'
import { ActivityCalendar, MonthlyChart, Punchcard } from './charts'

const AUTHORS_SHOWN = 15

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const formatDate = (seconds: number): string => dateFormat.format(seconds * 1000)

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

/** A file's name, always readable, above its folder, which gives way when the room runs out. */
function FilePath({ path }: { path: string }): React.JSX.Element {
  const slash = path.lastIndexOf('/')
  return (
    <span className="stats-path" title={path}>
      <span className="stats-file mono">{path.slice(slash + 1)}</span>
      {slash > 0 && (
        <span className="stats-folder">
          <bdi>{path.slice(0, slash)}</bdi>
        </span>
      )}
    </span>
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
          <FilePath path={f.path} />
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
              <FilePath path={f.path} />
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

export default function Report({ stats }: { stats: RepoStatistics }): React.JSX.Element {
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
        wide
        hint="Files changed most, and most recently: where bugs and conflicts tend to be. Click one to see its history."
      >
        <HotFiles stats={stats} />
      </Card>
      <Card
        title="Files only one person knows"
        wide
        hint="Changed by a single author. Click one to see its blame."
      >
        <Knowledge stats={stats} />
      </Card>
    </div>
  )
}
