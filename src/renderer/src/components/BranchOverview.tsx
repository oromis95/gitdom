import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, FolderGit2, GitBranch } from 'lucide-react'
import type { BranchInfo, BranchOverview as Overview } from '../../../shared/api'
import { useApp } from '../store'
import { confirm, notify, openMenu, useUi, type BranchesSession } from '../ui'
import { localBranchMenu, run } from '../actions'
import { relativeTime } from '../time'

/** Without a commit for this long, a branch is stale */
const STALE_DAYS = 90

type Filter = 'all' | 'merged' | 'stale' | 'gone'
type SortKey = 'name' | 'date' | 'ahead' | 'behind'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 'es'}`

const isStale = (b: BranchInfo, now: number): boolean => now / 1000 - b.date > STALE_DAYS * 86400

/** Why a branch can't be deleted from here, if it can't. */
function locked(b: BranchInfo): string | null {
  if (b.current) return 'The current branch: check out another one first'
  if (b.isBase) return 'The branch the others are compared with'
  if (b.worktree) return `Checked out in the worktree ${b.worktree}`
  return null
}

const FILTERS: { filter: Filter; label: string; title: string }[] = [
  { filter: 'all', label: 'All', title: 'Every local branch' },
  {
    filter: 'merged',
    label: 'Merged',
    title: 'Every commit, or every change, is already in the base'
  },
  { filter: 'stale', label: 'Stale', title: `No commit for ${STALE_DAYS} days or more` },
  {
    filter: 'gone',
    label: 'Upstream gone',
    title: 'The branch it followed was deleted on the remote, often after its pull request merged'
  }
]

function Dialog({ session }: { session: BranchesSession }): React.JSX.Element {
  const { repo } = session
  const close = (): void => useUi.setState({ branches: null })
  const snapshot = useApp((s) => s.tabs.find((t) => t.path === repo)?.snapshot)
  const [chosenBase, setChosenBase] = useState<string | null>(null)
  // Bumped after deleting, to list the branches again
  const [loads, setLoads] = useState(0)
  const key = `${chosenBase}:${loads}`
  const [loaded, setLoaded] = useState<{
    key: string
    overview: Overview | null
    error: string | null
  } | null>(null)
  // After deleting, the old list stays until the new one comes, instead of a blank table
  const overview =
    loaded?.key === key || loaded?.key.startsWith(`${chosenBase}:`) ? loaded.overview : null
  const error = loaded?.key === key ? loaded.error : null
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [now] = useState(() => Date.now())

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Not while the confirmation or a menu is open: Escape closes that one only
      if (e.key === 'Escape' && document.querySelectorAll('.modal, .menu-backdrop').length === 1)
        close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'branchOverview', chosenBase).then((result) => {
      if (cancelled) return
      setLoaded({
        key: `${chosenBase}:${loads}`,
        overview: result.ok ? result.value : null,
        error: result.ok ? null : result.error
      })
    })
    return () => {
      cancelled = true
    }
  }, [repo, chosenBase, loads])

  const base = overview?.base ?? chosenBase
  const bases = useMemo(
    () =>
      (snapshot?.refs ?? [])
        .filter((r) => r.type === 'local' || (r.type === 'remote' && !r.name.endsWith('/HEAD')))
        .map((r) => r.name)
        .sort((a, b) => a.localeCompare(b)),
    [snapshot?.refs]
  )
  const all = overview?.branches ?? []
  const counts = {
    merged: all.filter((b) => b.merged || b.squashed).length,
    stale: all.filter((b) => isStale(b, now)).length,
    gone: all.filter((b) => b.upstreamGone).length
  }
  const needle = query.trim().toLowerCase()
  const shown = all
    .filter(
      (b) =>
        filter === 'all' ||
        (filter === 'merged' && (b.merged || b.squashed)) ||
        (filter === 'stale' && isStale(b, now)) ||
        (filter === 'gone' && b.upstreamGone)
    )
    .filter((b) => !needle || b.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const by =
        sort.key === 'name'
          ? b.name.localeCompare(a.name)
          : sort.key === 'date'
            ? a.date - b.date
            : (a[sort.key] ?? 0) - (b[sort.key] ?? 0)
      return sort.desc ? -by : by
    })
  const deletable = shown.filter((b) => !locked(b))
  // Only what is shown and can go: a filter or a deletion leaves no hidden choice behind
  const chosen = deletable.filter((b) => picked.has(b.name))

  const pick = (names: string[], on: boolean): void => {
    const next = new Set(picked)
    for (const name of names) {
      if (on) next.add(name)
      else next.delete(name)
    }
    setPicked(next)
  }

  const header = (label: string, key: SortKey, className: string): React.JSX.Element => (
    <button
      type="button"
      className={`${className}${sort.key === key ? ' sorted' : ''}`}
      onClick={() =>
        setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: key !== 'name' })
      }
    >
      {label}
      {sort.key === key && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </button>
  )

  const remove = async (): Promise<void> => {
    const unmerged = chosen.filter((b) => !b.merged && !b.squashed)
    const commits = unmerged.reduce((n, b) => n + (b.ahead ?? 0), 0)
    const names =
      chosen.length <= 5
        ? chosen.map((b) => b.name).join(', ')
        : `${chosen
            .slice(0, 5)
            .map((b) => b.name)
            .join(', ')} and ${chosen.length - 5} more`
    const risk = unmerged.length
      ? ` ${unmerged.length === chosen.length ? (unmerged.length === 1 ? 'It has' : 'They have') : `${unmerged.length} of them ${unmerged.length === 1 ? 'has' : 'have'}`} ${commits === 1 ? 'a commit' : `${commits} commits`} not in ${base ?? 'the base'}: after this, only the backup keeps ${commits === 1 ? 'it' : 'them'}.`
      : ''
    const ok = await confirm(
      'Delete branches',
      `Delete ${chosen.length === 1 ? 'the branch' : `${chosen.length} branches`}: ${names}?${risk} The branches on the remote stay. Undo brings them back.`,
      'Delete',
      true
    )
    if (!ok) return
    const done = await run(
      repo,
      'deleteBranches',
      chosen.map((b) => b.name)
    )
    if (done) {
      notify(
        'success',
        chosen.length === 1
          ? `Deleted branch ${chosen[0].name}`
          : `Deleted ${chosen.length} branches`
      )
    }
    setPicked(new Set())
    setLoads(loads + 1)
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal branch-overview" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Branches</div>
        <div className="branch-overview-options">
          <label>
            Compared with
            <select
              value={base ?? ''}
              onChange={(e) => {
                setChosenBase(e.target.value)
                setPicked(new Set())
              }}
            >
              {!base && <option value="">Nothing</option>}
              {base && !bases.includes(base) && <option value={base}>{base}</option>}
              {bases.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented">
            {FILTERS.map((f) => (
              <button
                key={f.filter}
                type="button"
                className={f.filter === filter ? 'active' : ''}
                title={f.title}
                onClick={() => setFilter(f.filter)}
              >
                {f.label}
                {f.filter !== 'all' && overview && ` (${counts[f.filter]})`}
              </button>
            ))}
          </div>
          <input
            className="branch-overview-query mono"
            placeholder="Filter"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="branch-overview-heading">
          {error
            ? error
            : !overview
              ? 'Looking at the branches…'
              : `${plural(all.length, 'branch')}${base ? `; ${counts.merged} merged into ${base}` : ''}, ${counts.stale} stale, ${counts.gone} with the upstream gone`}
        </div>
        {shown.length > 0 && (
          <div className="branch-overview-table">
            <div className="branch-overview-row branch-overview-head">
              <input
                type="checkbox"
                disabled={!deletable.length}
                checked={deletable.length > 0 && chosen.length === deletable.length}
                ref={(el) => {
                  if (el) el.indeterminate = chosen.length > 0 && chosen.length < deletable.length
                }}
                onChange={(e) =>
                  pick(
                    deletable.map((b) => b.name),
                    e.target.checked
                  )
                }
              />
              {header('Branch', 'name', 'bo-name')}
              <span className="bo-commit">Last commit</span>
              {header('Age', 'date', 'bo-age')}
              {header('Ahead', 'ahead', 'bo-ahead')}
              {header('Behind', 'behind', 'bo-behind')}
              <span className="bo-status">Status</span>
            </div>
            {shown.map((b) => {
              const reason = locked(b)
              const ref = snapshot?.refs.find((r) => r.type === 'local' && r.name === b.name)
              return (
                <div
                  key={b.name}
                  className={`branch-overview-row${picked.has(b.name) && !reason ? ' picked' : ''}`}
                  title="Show in the graph; right-click for its menu"
                  onClick={() => {
                    useApp.getState().select(b.hash, true)
                    close()
                  }}
                  onContextMenu={(e) =>
                    snapshot && ref && openMenu(e, localBranchMenu(snapshot, ref))
                  }
                >
                  <input
                    type="checkbox"
                    disabled={!!reason}
                    title={reason ?? undefined}
                    checked={!reason && picked.has(b.name)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => pick([b.name], e.target.checked)}
                  />
                  <span className="bo-name">
                    {b.worktree ? <FolderGit2 size={13} /> : <GitBranch size={13} />}
                    <span className="bo-branch mono">{b.name}</span>
                    {b.current && <span className="bo-tag">current</span>}
                    {b.isBase && <span className="bo-tag">base</span>}
                    {b.upstreamGone ? (
                      <span
                        className="bo-tag bo-gone"
                        title={`${b.upstream} was deleted on the remote`}
                      >
                        upstream gone
                      </span>
                    ) : (
                      ref &&
                      (ref.ahead || ref.behind) && (
                        <span
                          className="bo-upstream"
                          title={`Against ${b.upstream}: ${ref.ahead ?? 0} to push, ${ref.behind ?? 0} to pull`}
                        >
                          {ref.ahead ? `↑${ref.ahead}` : ''}
                          {ref.behind ? `↓${ref.behind}` : ''}
                        </span>
                      )
                    )}
                  </span>
                  <span className="bo-commit" title={b.subject}>
                    {b.subject}
                    <span className="bo-author">{b.author}</span>
                  </span>
                  <span className={`bo-age${isStale(b, now) ? ' stale' : ''}`}>
                    {relativeTime(b.date, now)}
                  </span>
                  <span className="bo-ahead">{b.isBase ? '' : (b.ahead ?? '')}</span>
                  <span className="bo-behind">{b.isBase ? '' : (b.behind ?? '')}</span>
                  <span className="bo-status">
                    {b.merged ? (
                      <span className="bo-merged" title={`Every commit is in ${base}`}>
                        merged
                      </span>
                    ) : b.squashed ? (
                      <span
                        className="bo-merged squashed"
                        title={`Its changes are in ${base} through other commits, as after a squash or a rebase`}
                      >
                        squashed
                      </span>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {overview && shown.length === 0 && (
          <div className="branch-overview-heading">No branch matches</div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn branch-overview-merged"
            disabled={!deletable.some((b) => b.merged || b.squashed)}
            title="Choose every merged branch listed"
            onClick={() =>
              pick(
                deletable.filter((b) => b.merged || b.squashed).map((b) => b.name),
                true
              )
            }
          >
            Choose merged
          </button>
          <span className="toolbar-spacer" />
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!chosen.length}
            onClick={() => void remove()}
          >
            Delete{chosen.length ? ` ${plural(chosen.length, 'branch')}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BranchOverview(): React.JSX.Element | null {
  const session = useUi((s) => s.branches)
  return session ? <Dialog key={session.repo} session={session} /> : null
}
