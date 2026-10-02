// What I did: the user's commits in every repository GitDom knows, day by day, to copy for a
// standup or a report. "Mine" is the repository's user.email, or an address of the identity profiles.
import { useEffect, useMemo, useState } from 'react'
import { Copy, LoaderCircle } from 'lucide-react'
import type { MyCommit } from '../../../shared/api'
import { useApp } from '../store'
import { eachLimited, knownRepositories, useWorkspaces } from '../workspaces'
import { loadProfiles } from '../identity'
import { notify, useUi } from '../ui'

type Period = 'thisWeek' | 'lastWeek' | 'last7' | 'last30'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'thisWeek', label: 'This week' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'last7', label: 'The last 7 days' },
  { id: 'last30', label: 'The last 30 days' }
]

const DAY_MS = 86400000

/** The period in Unix seconds, from local midnights; weeks start on Monday. */
function range(period: Period, now = new Date()): [number, number] {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const monday = midnight - ((now.getDay() + 6) % 7) * DAY_MS
  const [from, to] =
    period === 'thisWeek'
      ? [monday, now.getTime() + 60000]
      : period === 'lastWeek'
        ? [monday - 7 * DAY_MS, monday]
        : [midnight - (period === 'last7' ? 6 : 29) * DAY_MS, now.getTime() + 60000]
  return [Math.floor(from / 1000), Math.floor(to / 1000)]
}

const nameOf = (path: string): string => path.split(/[\\/]/).pop() || path
const dayOf = (date: number): string =>
  new Date(date * 1000).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
const timeOf = (date: number): string =>
  new Date(date * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

interface Found extends MyCommit {
  repo: string
}

/** Days, newest first, each with its repositories and their commits. */
function byDay(commits: Found[]): { day: string; repos: { repo: string; commits: Found[] }[] }[] {
  const days: { day: string; repos: { repo: string; commits: Found[] }[] }[] = []
  for (const c of [...commits].sort((a, b) => b.date - a.date)) {
    const day = dayOf(c.date)
    let entry = days.at(-1)
    if (entry?.day !== day) days.push((entry = { day, repos: [] }))
    let group = entry.repos.find((r) => r.repo === c.repo)
    if (!group) entry.repos.push((group = { repo: c.repo, commits: [] }))
    group.commits.push(c)
  }
  return days
}

function asText(days: ReturnType<typeof byDay>, markdown: boolean): string {
  return days
    .map(({ day, repos }) =>
      [
        markdown ? `### ${day}` : day,
        ...repos.flatMap(({ repo, commits }) => [
          markdown ? `**${nameOf(repo)}**` : `  ${nameOf(repo)}`,
          // The oldest first, as they happened
          ...[...commits].reverse().map((c) => `${markdown ? '-' : '    -'} ${c.subject}`)
        ])
      ].join('\n')
    )
    .join('\n\n')
}

function Dialog(): React.JSX.Element {
  const close = (): void => useUi.setState({ myWeek: false })
  const tabs = useApp((s) => s.tabs)
  const favorites = useApp((s) => s.favorites)
  const recent = useApp((s) => s.recent)
  const workspaces = useWorkspaces((s) => s.list)
  const [period, setPeriod] = useState<Period>('thisWeek')
  const [found, setFound] = useState<{ key: string; commits: Found[]; done: boolean }>({
    key: '',
    commits: [],
    done: false
  })
  const [failed, setFailed] = useState<string[]>([])

  const repos = useMemo(
    () =>
      knownRepositories(
        tabs.map((t) => t.path),
        workspaces,
        favorites,
        recent
      ),
    [tabs, workspaces, favorites, recent]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelectorAll('.modal, .menu-backdrop').length === 1)
        close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const [since, until] = range(period)
    const emails = loadProfiles().map((p) => p.email)
    const key = `${period}:${since}`
    const commits: Found[] = []
    const missing: string[] = []
    void eachLimited(repos, async (repo) => {
      const result = await window.api.op(repo, 'myCommits', since, until, emails)
      if (cancelled) return
      if (result.ok) commits.push(...result.value.map((c) => ({ ...c, repo })))
      else missing.push(repo)
      setFound({ key, commits: [...commits], done: false })
    }).then(() => {
      if (cancelled) return
      setFound({ key, commits: [...commits], done: true })
      setFailed(missing)
    })
    return () => {
      cancelled = true
    }
    // The list of repositories is read once per period
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const key = `${period}:${range(period)[0]}`
  const current = found.key === key ? found : { commits: [], done: false }
  const days = byDay(current.commits)
  const repoCount = new Set(current.commits.map((c) => c.repo)).size

  const show = async (c: Found): Promise<void> => {
    close()
    await useApp.getState().openRepo(c.repo)
    useApp.getState().select(c.hash, true)
  }

  const copy = (markdown: boolean): void => {
    void navigator.clipboard.writeText(asText(days, markdown))
    notify('success', markdown ? 'Copied as Markdown' : 'Copied as text')
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal my-week" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">What I did</div>
        <div className="my-week-bar">
          <div className="segmented" role="tablist">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={p.id === period}
                className={p.id === period ? 'active' : ''}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="my-week-gap" />
          <span className="my-week-summary">
            {!current.done && <LoaderCircle size={13} className="spin" />}
            {current.commits.length === 1 ? '1 commit' : `${current.commits.length} commits`}
            {repoCount > 0 &&
              ` in ${repoCount === 1 ? '1 repository' : `${repoCount} repositories`}`}
          </span>
        </div>
        <div className="my-week-list">
          {current.done && days.length === 0 && (
            <div className="my-week-note">
              No commits of yours in this period, in the {repos.length} repositories GitDom knows.
              Yours are those with the repository&apos;s author email, or one of your identity
              profiles.
            </div>
          )}
          {days.map(({ day, repos: groups }) => (
            <section key={day} className="my-week-day">
              <h3>{day}</h3>
              {groups.map(({ repo, commits }) => (
                <div key={repo} className="my-week-repo">
                  <div className="my-week-repo-name" title={repo}>
                    {nameOf(repo)}
                  </div>
                  {commits.map((c) => (
                    <button
                      key={c.hash}
                      className="my-week-commit"
                      title={`${c.hash}\nOpen it in the graph`}
                      onClick={() => void show(c)}
                    >
                      <span className="my-week-time">{timeOf(c.date)}</span>
                      <span className="my-week-subject">{c.subject}</span>
                      <span className="my-week-ref">{c.ref}</span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
        {failed.length > 0 && (
          <div className="my-week-note">
            Not read: {failed.map(nameOf).join(', ')} (the folder is gone or isn&apos;t a
            repository)
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" disabled={!days.length} onClick={() => copy(false)}>
            <Copy size={13} /> Copy as text
          </button>
          <button className="btn" disabled={!days.length} onClick={() => copy(true)}>
            <Copy size={13} /> Copy as Markdown
          </button>
          <span className="my-week-gap" />
          <button className="btn" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MyWeek(): React.JSX.Element | null {
  const open = useUi((s) => s.myWeek)
  return open ? <Dialog /> : null
}
