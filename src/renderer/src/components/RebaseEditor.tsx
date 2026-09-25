import { useState } from 'react'
import { GripVertical } from 'lucide-react'
import type { RebaseAction, RebaseStep } from '../../../shared/api'
import { useUi, type RebaseSession } from '../ui'
import { runInteractiveRebase } from '../actions'

const ACTIONS: { action: RebaseAction; label: string; help: string }[] = [
  { action: 'pick', label: 'Pick', help: 'Keep the commit' },
  { action: 'reword', label: 'Reword', help: 'Keep the commit, change its message' },
  { action: 'squash', label: 'Squash', help: 'Meld into the commit above, keeping both messages' },
  { action: 'fixup', label: 'Fixup', help: 'Meld into the commit above, dropping this message' },
  { action: 'drop', label: 'Drop', help: 'Remove the commit' }
]

interface Row extends RebaseStep {
  subject: string
  author: string
  /** Original message, to tell whether a reword changed it */
  original: string
}

/** Why the todo list can't run, or null when it can. */
function problemOf(rows: Row[]): string | null {
  const first = rows.find((r) => r.action !== 'drop')
  if (!first) return 'Every commit would be dropped'
  if (first.action === 'squash' || first.action === 'fixup') {
    return 'The first kept commit cannot be squashed: there is no commit above it to meld into'
  }
  if (rows.some((r) => r.action === 'reword' && !r.message?.trim())) {
    return 'A reworded commit needs a message'
  }
  return null
}

function Editor({ session }: { session: RebaseSession }): React.JSX.Element {
  const close = (): void => useUi.setState({ rebase: null })
  const [rows, setRows] = useState<Row[]>(() =>
    session.commits.map((c) => ({
      action: 'pick',
      hash: c.hash,
      subject: c.subject,
      author: c.author,
      message: c.message,
      original: c.message
    }))
  )
  const [dragged, setDragged] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const update = (index: number, patch: Partial<Row>): void =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const move = (from: number, to: number): void => {
    const next = [...rows]
    const [row] = next.splice(from, 1)
    next.splice(to > from ? to - 1 : to, 0, row)
    setRows(next)
  }

  const problem = problemOf(rows)
  const changed = rows.some(
    (r, i) =>
      r.hash !== session.commits[i].hash ||
      (r.action !== 'pick' && !(r.action === 'reword' && r.message === r.original))
  )

  const start = (): void => {
    if (problem) return
    close()
    const todo = rows.map(({ action, hash, message }) =>
      action === 'reword' ? { action, hash, message: message!.trim() } : { action, hash }
    )
    void runInteractiveRebase(session.repo, session.base, todo)
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal rebase-editor"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="modal-title">Interactive rebase</div>
        <div className="modal-message">
          {rows.length} commit{rows.length === 1 ? '' : 's'} after{' '}
          {session.base ? session.base.slice(0, 7) : 'the root'}, oldest first as they are applied.
          Drag to reorder.
        </div>
        {session.merges > 0 && (
          <div className="rebase-problem">
            {session.merges === 1 ? 'A merge commit' : `${session.merges} merge commits`} in this
            range will be flattened: the merged commits are replayed one after the other, without
            the merge.
          </div>
        )}
        <div className="rebase-rows" onDragLeave={() => setDropAt(null)}>
          {rows.map((row, i) => (
            <div
              key={row.hash}
              className={`rebase-row action-${row.action}${dragged === i ? ' dragging' : ''}${
                dropAt === i ? ' drop-before' : ''
              }${dropAt === rows.length && i === rows.length - 1 ? ' drop-after' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                setDragged(i)
              }}
              onDragEnd={() => {
                setDragged(null)
                setDropAt(null)
              }}
              onDragOver={(e) => {
                if (dragged === null) return
                e.preventDefault()
                const box = e.currentTarget.getBoundingClientRect()
                setDropAt(e.clientY < box.top + box.height / 2 ? i : i + 1)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragged !== null && dropAt !== null) move(dragged, dropAt)
                setDragged(null)
                setDropAt(null)
              }}
            >
              <div className="rebase-row-main">
                <GripVertical size={15} className="rebase-grip" />
                <select
                  value={row.action}
                  title={ACTIONS.find((a) => a.action === row.action)?.help}
                  onChange={(e) => update(i, { action: e.target.value as RebaseAction })}
                >
                  {ACTIONS.map((a) => (
                    <option key={a.action} value={a.action} title={a.help}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <span className="mono rebase-hash">{row.hash.slice(0, 7)}</span>
                <span className="rebase-subject" title={row.original}>
                  {row.action === 'reword' ? row.message?.split('\n')[0] : row.subject}
                </span>
                <span className="rebase-author">{row.author}</span>
              </div>
              {row.action === 'reword' && (
                <textarea
                  className="rebase-message"
                  rows={3}
                  value={row.message}
                  autoFocus
                  onChange={(e) => update(i, { message: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        {problem && <div className="rebase-problem">{problem}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!!problem || !changed}
            title={changed ? undefined : 'Nothing changed yet'}
            onClick={start}
          >
            Start rebase
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RebaseEditor(): React.JSX.Element | null {
  const session = useUi((s) => s.rebase)
  // Keyed by session: every opening starts from the commits as they are
  return session ? <Editor key={session.commits[0].hash + session.base} session={session} /> : null
}
