import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import type { HeavyObject, Maintenance, RepoHealth as Health } from '../../../shared/api'
import { notify, openMenu, useUi, type HealthSession } from '../ui'
import { copy, runValue } from '../actions'
import { formatBytes } from '../statistics'

/** Thresholds past which packing pays off, as `git gc --auto` sees them, a bit earlier */
const MANY_LOOSE = 1000
const MANY_PACKS = 20

const plural = (n: number, word: string): string =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

const STATES: Record<HeavyObject['state'], { label: string; title: string }> = {
  current: { label: 'in HEAD', title: 'This version is in the last commit' },
  older: { label: 'older version', title: 'The file is still there, with other content' },
  deleted: {
    label: 'deleted',
    title: 'The file is gone, but the history keeps it: only rewriting the history frees the space'
  }
}

const TASKS: { task: Maintenance; label: string; busy: string; title: string }[] = [
  {
    task: 'fsck',
    label: 'Check',
    busy: 'Checking…',
    title: 'Look for missing or damaged objects (git fsck)'
  },
  {
    task: 'prune',
    label: 'Prune',
    busy: 'Pruning…',
    title:
      'Remove objects no branch, tag, stash or reflog needs, older than two weeks, and records of worktrees whose folder is gone (git prune)'
  },
  {
    task: 'gc',
    label: 'Compress',
    busy: 'Compressing…',
    title: 'Pack the objects together and drop what is no longer needed (git gc)'
  }
]

const total = (h: Health): number =>
  h.loose.size + h.packs.size + h.garbage.size + (h.lfs?.size ?? 0)

/** Why compressing would help, if it would. */
function advice(h: Health): string[] {
  const reasons: string[] = []
  if (h.loose.count >= MANY_LOOSE) reasons.push(`${plural(h.loose.count, 'loose object')}`)
  if (h.packs.count >= MANY_PACKS) reasons.push(`${plural(h.packs.count, 'pack')}`)
  if (h.prunable) reasons.push(`${plural(h.prunable, 'loose object')} already packed`)
  if (h.garbage.count) reasons.push(`${plural(h.garbage.count, 'leftover file')}`)
  return reasons
}

function Dialog({ session }: { session: HealthSession }): React.JSX.Element {
  const { repo } = session
  const close = (): void => useUi.setState({ health: null })
  // Bumped after maintenance, to measure again
  const [loads, setLoads] = useState(0)
  const [health, setHealth] = useState<{
    loads: number
    value: Health | null
    error: string | null
  }>()
  const [heavy, setHeavy] = useState<{ loads: number; value: HeavyObject[] | null }>()
  const [busy, setBusy] = useState<Maintenance | null>(null)
  const [problems, setProblems] = useState<string[] | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Not while a menu is open: Escape closes that one only
      if (e.key === 'Escape' && document.querySelectorAll('.modal, .menu-backdrop').length === 1)
        close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'repoHealth').then((result) => {
      if (cancelled) return
      setHealth({
        loads,
        value: result.ok ? result.value : null,
        error: result.ok ? null : result.error
      })
    })
    void window.api.op(repo, 'heaviestObjects').then((result) => {
      if (!cancelled) setHeavy({ loads, value: result.ok ? result.value : null })
    })
    return () => {
      cancelled = true
    }
  }, [repo, loads])

  // The previous figures stay until the new ones come
  const figures = health?.value ?? null
  const reasons = figures ? advice(figures) : []

  const maintain = async (task: Maintenance): Promise<void> => {
    const before = figures ? total(figures) : null
    setBusy(task)
    setProblems(null)
    const found = await runValue(repo, 'maintain', task)
    setBusy(null)
    if (!found) return
    if (task === 'fsck') {
      setProblems(found)
      if (!found.length) notify('success', 'No problems found')
      return
    }
    const after = await window.api.op(repo, 'repoHealth')
    if (after.ok) {
      setHealth({ loads: loads + 1, value: after.value, error: null })
      const freed = before === null ? 0 : before - total(after.value)
      const packed = figures ? figures.loose.count - after.value.loose.count : 0
      const done = [
        ...(task === 'gc' && packed > 0 ? [`${plural(packed, 'loose object')} packed`] : []),
        ...(freed > 0 ? [`${formatBytes(freed)} freed`] : [])
      ]
      notify(
        'success',
        `${task === 'gc' ? 'Compressed' : 'Pruned'}: ${done.length ? done.join(', ') : 'nothing to free'}`
      )
    }
    setLoads(loads + 1)
  }

  const items: [string, string, string][] = figures
    ? [
        ['On disk', formatBytes(total(figures)), 'all the history'],
        ['Packed', formatBytes(figures.packs.size), plural(figures.packs.count, 'pack')],
        ['Loose', formatBytes(figures.loose.size), plural(figures.loose.count, 'object')],
        ...(figures.lfs
          ? [
              [
                'Git LFS',
                `${formatBytes(figures.lfs.size)}${figures.lfs.partial ? '+' : ''}`,
                plural(figures.lfs.files, 'file')
              ] as [string, string, string]
            ]
          : []),
        ['Commits', figures.commits.toLocaleString(), 'in every branch, tag and stash']
      ]
    : []

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : close}>
      <div className="modal repo-health" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Repository health</div>
        {health?.error ? (
          <div className="repo-health-note">{health.error}</div>
        ) : !figures ? (
          <div className="repo-health-note">Measuring the repository…</div>
        ) : (
          <>
            <div className="repo-health-figures">
              {items.map(([label, value, note]) => (
                <div key={label} className="stats-figure">
                  <span className="stats-figure-value">{value}</span>
                  <span className="stats-figure-label">{label}</span>
                  <span className="stats-figure-note">{note}</span>
                </div>
              ))}
            </div>
            <div className={`repo-health-advice${reasons.length ? ' warn' : ''}`}>
              {reasons.length
                ? `Compressing would help: ${reasons.join(', ')}.`
                : 'Nothing to tidy up: git keeps this repository in shape.'}
            </div>
          </>
        )}
        {problems && problems.length > 0 && (
          <div className="repo-health-problems">
            <div>
              {plural(problems.length, 'problem')} found. A clone from the remote, or the backup of
              the repository, has the missing objects.
            </div>
            <pre className="mono">{problems.join('\n')}</pre>
          </div>
        )}
        <div className="repo-health-section">
          <h3>Heaviest files in the history</h3>
          <span>
            The biggest versions in any branch, tag or stash. Deleted files still take space until
            the history is rewritten.
          </span>
        </div>
        <div className="repo-health-list">
          {!heavy || heavy.loads !== loads ? (
            heavy?.value ? null : (
              <div className="repo-health-note">Looking through the history…</div>
            )
          ) : !heavy.value ? (
            <div className="repo-health-note">The history could not be read</div>
          ) : heavy.value.length === 0 ? (
            <div className="repo-health-note">No files yet</div>
          ) : null}
          {heavy?.value?.map((o) => (
            <div
              key={o.hash}
              className="repo-health-row"
              title={`${o.path}\n${o.hash}`}
              onContextMenu={(e) =>
                openMenu(e, [
                  { label: 'Copy Path', onClick: () => copy(o.path) },
                  { label: 'Copy Object Hash', onClick: () => copy(o.hash) }
                ])
              }
            >
              <span className="repo-health-size">{formatBytes(o.size)}</span>
              <span className="repo-health-disk" title="Compressed, as stored">
                {formatBytes(o.diskSize)}
              </span>
              <FileText size={13} />
              <span className="repo-health-path mono">{o.path}</span>
              <span className={`repo-health-state ${o.state}`} title={STATES[o.state].title}>
                {STATES[o.state].label}
              </span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          {TASKS.map((t) => (
            <button
              key={t.task}
              type="button"
              className={`btn${t.task === 'gc' && reasons.length ? ' btn-primary' : ''}`}
              title={t.title}
              disabled={busy !== null}
              onClick={() => void maintain(t.task)}
            >
              {busy === t.task ? t.busy : t.label}
            </button>
          ))}
          <span className="repo-health-gap" />
          <button type="button" className="btn" disabled={busy !== null} onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RepoHealth(): React.JSX.Element | null {
  const session = useUi((s) => s.health)
  return session ? <Dialog key={session.repo} session={session} /> : null
}
