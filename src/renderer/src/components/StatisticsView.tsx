// Repository statistics, shown in place of the graph: who works on the project and when, how the
// code grew, its languages, the files that change most and those only one person knows.
import { useEffect, useState } from 'react'
import { BarChart3, RefreshCw, X } from 'lucide-react'
import type { RepoSnapshot, RepoStatistics, StatisticsOptions } from '../../../shared/types'
import { useApp } from '../store'
import { fromTerminal } from '../ui'
import { formatCount } from '../statistics'
import { storage } from '../storage'
import Report from './statistics/Report'

const OPTIONS_KEY = 'gitdom.statistics'
const PERIODS: [number | null, string][] = [
  [null, 'All time'],
  [365, 'Last year'],
  [180, 'Last 6 months'],
  [90, 'Last 3 months'],
  [30, 'Last 30 days']
]

function loadOptions(): StatisticsOptions {
  try {
    const saved = JSON.parse(storage.getItem(OPTIONS_KEY) ?? '{}') as Partial<StatisticsOptions>
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
    storage.setItem(OPTIONS_KEY, JSON.stringify(merged))
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
