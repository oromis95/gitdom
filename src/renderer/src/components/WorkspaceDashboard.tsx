// The workspace dashboard: every repository GitDom knows (open tabs, workspaces, favorites, recent)
// in one look, with what needs doing in each, and fetching them all at once.
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Archive,
  CircleAlert,
  FolderGit2,
  GitBranch,
  LoaderCircle,
  Pencil
} from 'lucide-react'
import type { RepoSummary } from '../../../shared/api'
import { useApp } from '../store'
import { useWorkspaces } from '../workspaces'
import { notify, openMenu, useUi } from '../ui'
import { copy, showInFolder } from '../actions'
import { relativeTime } from '../time'

/** Repositories read or fetched at the same time */
const PARALLEL = 4

type Loaded = { summary: RepoSummary | null; error: string | null }
type Fetching = 'fetching' | 'pulling' | { error: string }

const nameOf = (path: string): string => path.split(/[\\/]/).pop() || path

/** Runs `work` on each item, a few at a time. */
async function eachLimited<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
    })
  )
}

const changesOf = (s: RepoSummary): number => s.staged + s.unstaged + s.untracked + s.conflicts
const needsAttention = (l: Loaded | undefined): boolean =>
  !l ||
  !!l.error ||
  (!!l.summary &&
    (changesOf(l.summary) > 0 ||
      l.summary.ahead > 0 ||
      l.summary.behind > 0 ||
      !!l.summary.operation))

function Dialog(): React.JSX.Element {
  const close = (): void => useUi.setState({ dashboard: false })
  const tabs = useApp((s) => s.tabs)
  const favorites = useApp((s) => s.favorites)
  const recent = useApp((s) => s.recent)
  const workspaces = useWorkspaces((s) => s.list)
  const [scope, setScope] = useState('all')
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({})
  const [fetching, setFetching] = useState<Record<string, Fetching>>({})
  const [busy, setBusy] = useState(false)

  // Every repository once, the open ones first
  const all = useMemo(() => {
    const paths = [
      ...tabs.map((t) => t.path),
      ...workspaces.flatMap((w) => w.paths),
      ...favorites,
      ...recent
    ]
    return paths.filter((p, i) => paths.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
  }, [tabs, workspaces, favorites, recent])
  const paths =
    scope === 'all'
      ? all
      : scope === 'tabs'
        ? tabs.map((t) => t.path)
        : (workspaces.find((w) => w.name === scope)?.paths ?? [])

  const load = (path: string): Promise<void> =>
    window.api.op(path, 'repoSummary').then((result) => {
      setLoaded((l) => ({
        ...l,
        [path]: result.ok
          ? { summary: result.value, error: null }
          : { summary: null, error: result.error }
      }))
    })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelectorAll('.modal, .menu-backdrop').length === 1)
        close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    void eachLimited(all, load)
    // Once, on opening: refresh and fetch read them again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** An open tab shows the change too */
  const refreshTab = (path: string): void => {
    if (useApp.getState().tabs.some((t) => t.path === path))
      void useApp.getState().refreshPath(path)
  }

  const fetchAll = async (): Promise<void> => {
    setBusy(true)
    const failed: string[] = []
    await eachLimited(
      paths.filter((p) => !loaded[p]?.error),
      async (path) => {
        setFetching((f) => ({ ...f, [path]: 'fetching' }))
        const result = await window.api.op(path, 'fetch')
        if (!result.ok) failed.push(nameOf(path))
        setFetching((f) => {
          const next = { ...f }
          if (result.ok) delete next[path]
          else next[path] = { error: result.error }
          return next
        })
        await load(path)
        refreshTab(path)
      }
    )
    setBusy(false)
    if (failed.length) notify('warning', `Could not fetch ${failed.join(', ')}`)
    else notify('success', 'Fetched every repository')
  }

  /** Brings a branch that is only behind up to date: nothing to merge, nothing to lose */
  const fastForward = async (path: string): Promise<void> => {
    setFetching((f) => ({ ...f, [path]: 'pulling' }))
    const result = await window.api.op(path, 'pull', 'ff-only')
    setFetching((f) => {
      const next = { ...f }
      if (result.ok) delete next[path]
      else next[path] = { error: result.error }
      return next
    })
    await load(path)
    refreshTab(path)
  }

  const open = (path: string): void => {
    close()
    void useApp.getState().openRepo(path)
  }

  const counts = { changes: 0, behind: 0, ahead: 0, problems: 0 }
  for (const path of paths) {
    const s = loaded[path]?.summary
    if (loaded[path]?.error || s?.operation || s?.conflicts) counts.problems++
    if (s && changesOf(s)) counts.changes++
    if (s?.behind) counts.behind++
    if (s?.ahead) counts.ahead++
  }
  const shown = onlyAttention ? paths.filter((p) => needsAttention(loaded[p])) : paths
  const parts = [
    counts.changes && `${counts.changes} with changes`,
    counts.ahead && `${counts.ahead} to push`,
    counts.behind && `${counts.behind} behind`,
    counts.problems && `${counts.problems} to look at`
  ].filter(Boolean)

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : close}>
      <div className="modal dashboard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Workspace dashboard</div>
        <div className="dashboard-bar">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Repositories"
          >
            <option value="all">All my repositories</option>
            {tabs.length > 0 && <option value="tabs">Open tabs</option>}
            {workspaces.map((w) => (
              <option key={w.name} value={w.name}>
                Workspace: {w.name}
              </option>
            ))}
          </select>
          <label className="dashboard-check">
            <input
              type="checkbox"
              checked={onlyAttention}
              onChange={(e) => setOnlyAttention(e.target.checked)}
            />
            Only those needing attention
          </label>
          <span className="dashboard-gap" />
          <span className="dashboard-summary">
            {paths.length === 1 ? '1 repository' : `${paths.length} repositories`}
            {parts.length ? `: ${parts.join(', ')}` : ', all clean and up to date'}
          </span>
        </div>
        <div className="dashboard-list">
          {paths.length === 0 && (
            <div className="dashboard-note">
              No repositories yet: the ones you open, favorite or save in a workspace show up here.
            </div>
          )}
          {paths.length > 0 && shown.length === 0 && (
            <div className="dashboard-note">Nothing needs attention.</div>
          )}
          {shown.map((path) => {
            const l = loaded[path]
            const s = l?.summary
            const f = fetching[path]
            const changes = s ? changesOf(s) : 0
            const canForward =
              !!s?.branch && s.behind > 0 && s.ahead === 0 && changes === 0 && !s.operation
            return (
              <div
                key={path}
                className={`dashboard-row${l?.error ? ' missing' : ''}`}
                title={path}
                onClick={() => !l?.error && open(path)}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: 'Open', disabled: !!l?.error, onClick: () => open(path) },
                    {
                      label: 'Show in folder',
                      disabled: !!l?.error,
                      onClick: () => showInFolder(path, null)
                    },
                    { label: 'Copy path', onClick: () => copy(path) },
                    'separator',
                    {
                      label: 'Remove from the recent and favorites',
                      onClick: () => useApp.getState().forgetRepo(path)
                    }
                  ])
                }
              >
                <FolderGit2 size={18} className="dashboard-icon" />
                <div className="dashboard-name">
                  <span className="dashboard-repo">{nameOf(path)}</span>
                  <span className="dashboard-path">{path}</span>
                </div>
                {!l ? (
                  <span className="dashboard-state muted">
                    <LoaderCircle size={13} className="spin" /> Reading…
                  </span>
                ) : l.error ? (
                  <span className="dashboard-state error">
                    <CircleAlert size={13} /> {l.error}
                  </span>
                ) : (
                  s && (
                    <>
                      <span className="dashboard-branch" title={s.upstream ?? 'No upstream'}>
                        <GitBranch size={13} />
                        {s.branch ?? `detached ${s.head ?? ''}`}
                      </span>
                      <span className="dashboard-sync">
                        {s.ahead > 0 && (
                          <span className="ahead" title={`${s.ahead} commits to push`}>
                            <ArrowUp size={12} />
                            {s.ahead}
                          </span>
                        )}
                        {s.behind > 0 && (
                          <span className="behind" title={`${s.behind} commits to pull`}>
                            <ArrowDown size={12} />
                            {s.behind}
                          </span>
                        )}
                        {!s.upstream && s.branch && <span className="muted">no upstream</span>}
                      </span>
                      <span className="dashboard-changes">
                        {s.operation ? (
                          <span className="dashboard-chip error">
                            {s.operation === 'am' ? 'patch' : s.operation} in progress
                          </span>
                        ) : s.conflicts ? (
                          <span className="dashboard-chip error">{s.conflicts} conflicts</span>
                        ) : changes ? (
                          <span
                            className="dashboard-chip changes"
                            title={`${s.staged} staged, ${s.unstaged} changed, ${s.untracked} new`}
                          >
                            <Pencil size={11} /> {changes}
                          </span>
                        ) : null}
                        {s.stashes > 0 && (
                          <span className="dashboard-chip" title={`${s.stashes} stashes`}>
                            <Archive size={11} /> {s.stashes}
                          </span>
                        )}
                      </span>
                      <span className="dashboard-last" title={s.lastCommit?.subject}>
                        {s.lastCommit ? relativeTime(s.lastCommit.date) : 'no commits'}
                      </span>
                    </>
                  )
                )}
                <span className="dashboard-action" onClick={(e) => e.stopPropagation()}>
                  {f === 'fetching' || f === 'pulling' ? (
                    <span className="muted">
                      <LoaderCircle size={13} className="spin" />{' '}
                      {f === 'fetching' ? 'Fetching' : 'Pulling'}
                    </span>
                  ) : f ? (
                    <span className="dashboard-state error" title={f.error}>
                      <CircleAlert size={13} /> Failed
                    </span>
                  ) : (
                    canForward && (
                      <button
                        className="btn btn-small"
                        disabled={busy}
                        title="Fast-forward: there is nothing to merge and nothing local to lose"
                        onClick={() => void fastForward(path)}
                      >
                        Pull
                      </button>
                    )
                  )}
                </span>
              </div>
            )
          })}
        </div>
        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={() => void eachLimited(paths, load)}>
            Refresh
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || paths.length === 0}
            title="git fetch in every repository shown, a few at a time"
            onClick={() => void fetchAll()}
          >
            {busy ? 'Fetching…' : 'Fetch all'}
          </button>
          <span className="dashboard-gap" />
          <button className="btn" disabled={busy} onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WorkspaceDashboard(): React.JSX.Element | null {
  const open = useUi((s) => s.dashboard)
  return open ? <Dialog /> : null
}
