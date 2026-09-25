// Recovery view, shown in place of the graph: the reflog of a ref (ADV-05) and the backups GitDom
// saves before rewriting history (NFR-04).
import { useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, History, X } from 'lucide-react'
import type { Result } from '../../../shared/api'
import type { Backup, ReflogEntry, RepoSnapshot } from '../../../shared/types'
import { useActiveTab, useApp, type RecoveryView as View } from '../store'
import { checkoutCommit, createBranch, reset, run } from '../actions'
import { confirm, fromTerminal, notify, openMenu, type MenuItem } from '../ui'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

const shortRef = (ref: string): string => ref.replace(/^refs\/(heads|remotes|tags)\//, '')

function copyHash(hash: string): void {
  void navigator.clipboard.writeText(hash)
  notify('info', 'Copied commit hash')
}

/**
 * Loads with an operation whenever `key` changes, dropping the answers to outdated requests. The
 * previous answer stays shown while reloading, so the list does not flash after every action.
 */
function useLoaded<T>(key: string, load: () => Promise<Result<T>>): Result<T> | null {
  const [loaded, setLoaded] = useState<Result<T> | null>(null)
  useEffect(() => {
    let cancelled = false
    void load().then((result) => {
      if (!cancelled) setLoaded(result)
    })
    return () => {
      cancelled = true
    }
    // key identifies what load fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return loaded
}

/** Changes whenever the repository does, so the lists reload after every action. */
const snapshotKey = (snapshot: RepoSnapshot): string =>
  `${snapshot.head.hash}\0${snapshot.refs.map((r) => r.fullName + r.hash).join()}`

function Reflog({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const repo = snapshot.path
  const select = useApp((s) => s.select)
  const selected = useActiveTab()?.selected
  const [ref, setRef] = useState('HEAD')
  const branches = snapshot.refs.filter((r) => r.type === 'local')
  const result = useLoaded(`${ref}\0${snapshotKey(snapshot)}`, () =>
    window.api.op(repo, 'reflog', ref)
  )
  const inGraph = useMemo(() => new Set(snapshot.commits.map((c) => c.hash)), [snapshot.commits])
  const branch = snapshot.head.branch ?? 'HEAD'

  const menuFor = (e: ReflogEntry): MenuItem[] => {
    const short = e.hash.slice(0, 7)
    return [
      { label: 'Create branch here', onClick: () => void createBranch(repo, e.hash, short) },
      {
        label: 'Checkout this commit (detached)',
        onClick: () => void checkoutCommit(repo, e.hash)
      },
      'separator',
      ...(['mixed', 'hard'] as const).map((mode): MenuItem => ({
        label: `Reset ${branch} here (${mode})`,
        danger: mode === 'hard',
        disabled: e.hash === snapshot.head.hash && mode !== 'hard',
        onClick: () => void reset(repo, snapshot, e.hash, mode)
      })),
      'separator',
      { label: 'Copy commit hash', onClick: () => copyHash(e.hash) }
    ]
  }

  let list: React.ReactNode
  if (!result) list = <div className="center-message">Loading…</div>
  else if (!result.ok) list = <div className="banner-error">{result.error}</div>
  else if (!result.value.length) {
    list = <div className="center-message">No reflog entries for {shortRef(ref)}</div>
  } else {
    list = result.value.map((e, i) => (
      <div
        key={i}
        className={`history-row reflog-row${e.hash === selected ? ' selected' : ''}`}
        onClick={() => select(e.hash)}
        onContextMenu={(ev) => openMenu(ev, menuFor(e))}
      >
        <span className="history-hash mono">{e.hash.slice(0, 7)}</span>
        <span className="reflog-action">{e.action}</span>
        <span className="history-subject" title={e.message}>
          {e.message}
          {e.subject && e.subject !== e.message && <span className="muted"> · {e.subject}</span>}
        </span>
        {!inGraph.has(e.hash) && (
          <span
            className="reflog-lost"
            title="No branch or tag reaches this commit: create a branch to keep it"
          >
            not in graph
          </span>
        )}
        <span className="cell-date">
          {e.date ? dateFormat.format(new Date(e.date * 1000)) : ''}
        </span>
        <button
          className="row-action"
          onClick={(ev) => {
            ev.stopPropagation()
            void createBranch(repo, e.hash, e.hash.slice(0, 7))
          }}
        >
          Branch
        </button>
      </div>
    ))
  }

  return (
    <>
      <div className="recovery-hint">
        <span className="muted">Where</span>
        <select value={ref} onChange={(e) => setRef(e.target.value)}>
          <option value="HEAD">HEAD (every checkout, commit, reset…)</option>
          {branches.map((b) => (
            <option key={b.fullName} value={b.fullName}>
              {b.name}
            </option>
          ))}
        </select>
        <span className="muted">
          has pointed, newest first. Commits lost by a reset or a rebase are still here: right-click
          one to get it back.
        </span>
      </div>
      <div className="history-list">{list}</div>
    </>
  )
}

function Backups({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const repo = snapshot.path
  const select = useApp((s) => s.select)
  const result = useLoaded(snapshotKey(snapshot), () => window.api.op(repo, 'backups'))

  const restore = async (backup: Backup, ref: string, hash: string): Promise<void> => {
    const current = ref === `refs/heads/${snapshot.head.branch}`
    const ok = await confirm(
      'Restore backup',
      `Move ${shortRef(ref)} back to ${hash.slice(0, 7)}, as it was before "${backup.label}"?` +
        (current ? ' Uncommitted changes are kept; the restore stops if they would be lost.' : '') +
        ' The current position is backed up too, and Undo reverts the restore.',
      'Restore'
    )
    if (ok && (await run(repo, 'restoreBackup', backup.id, ref))) {
      notify('success', `Restored ${shortRef(ref)} to ${hash.slice(0, 7)}`)
    }
  }

  const remove = async (backup: Backup): Promise<void> => {
    const ok = await confirm(
      'Delete backup',
      `Delete the backup saved before "${backup.label}"? Its commits may then be lost, unless a branch or the reflog still reaches them.`,
      'Delete',
      true
    )
    if (ok) await run(repo, 'deleteBackup', backup.id)
  }

  if (!result) return <div className="center-message">Loading…</div>
  if (!result.ok) return <div className="banner-error">{result.error}</div>
  return (
    <>
      <div className="recovery-hint muted">
        GitDom saves the branch before a reset, a rebase or a force push, and keeps the latest 50
        backups. Nothing is saved when the action changes nothing.
      </div>
      <div className="history-list">
        {!result.value.length && <div className="center-message">No backups yet</div>}
        {result.value.map((b) => (
          <div key={b.id} className="backup">
            <div className="backup-title">
              <span className="backup-label">{b.label}</span>
              <span className="cell-date">{dateFormat.format(new Date(b.date))}</span>
              <button className="row-action" onClick={() => void remove(b)}>
                Delete
              </button>
            </div>
            {b.refs.map((r) => {
              const local = r.name.startsWith('refs/heads/')
              const same = r.current === r.hash
              return (
                <div key={r.name} className="backup-ref history-row" onClick={() => select(r.hash)}>
                  <span className="backup-ref-name">{shortRef(r.name)}</span>
                  <span className="muted">was</span>
                  <span className="history-hash mono">{r.hash.slice(0, 7)}</span>
                  <span className="muted">
                    {r.current === null
                      ? 'now deleted'
                      : same
                        ? 'unchanged since'
                        : `now ${r.current.slice(0, 7)}`}
                  </span>
                  <span className="toolbar-spacer" />
                  <button
                    className="row-action"
                    onClick={(e) => {
                      e.stopPropagation()
                      void createBranch(repo, r.hash, `${shortRef(r.name)} before "${b.label}"`)
                    }}
                  >
                    Create branch
                  </button>
                  {local && (
                    <button
                      className="row-action"
                      disabled={same}
                      title={same ? 'The branch is already there' : undefined}
                      onClick={(e) => {
                        e.stopPropagation()
                        void restore(b, r.name, r.hash)
                      }}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

export default function RecoveryView({
  snapshot,
  view
}: {
  snapshot: RepoSnapshot
  view: View
}): React.JSX.Element {
  const openRecovery = useApp((s) => s.openRecovery)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !fromTerminal(e) && !document.querySelector('.modal, .menu'))
        openRecovery(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openRecovery])

  return (
    <div className="diff-view inspector recovery">
      <div className="diff-header">
        <span className="diff-path">{view === 'reflog' ? 'Reflog' : 'Backups'}</span>
        <span className="toolbar-spacer" />
        <div className="segmented">
          <button
            className={view === 'reflog' ? 'active' : ''}
            onClick={() => openRecovery('reflog')}
          >
            <History size={14} /> Reflog
          </button>
          <button
            className={view === 'backups' ? 'active' : ''}
            onClick={() => openRecovery('backups')}
          >
            <ArchiveRestore size={14} /> Backups
          </button>
        </div>
        <button className="diff-close" onClick={() => openRecovery(null)} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      {view === 'reflog' ? <Reflog snapshot={snapshot} /> : <Backups snapshot={snapshot} />}
    </div>
  )
}
