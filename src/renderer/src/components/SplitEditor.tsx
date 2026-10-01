import { useState } from 'react'
import { useUi, type SplitSession } from '../ui'
import { runSplitCommit } from '../actions'

function Editor({ session }: { session: SplitSession }): React.JSX.Element {
  const close = (): void => useUi.setState({ split: null })
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState(session.message)

  const toggle = (path: string): void => {
    const next = new Set(chosen)
    if (!next.delete(path)) next.add(path)
    setChosen(next)
  }

  const count = chosen.size
  const rest = session.files.length - count
  const problem =
    count === 0
      ? 'Pick the files that go in the first commit'
      : rest === 0
        ? 'Leave some files for the second commit'
        : !first.trim() || !second.trim()
          ? 'Both commits need a message'
          : null

  const split = (): void => {
    if (problem) return
    close()
    // A rename moves as a whole: both its paths go in the same commit
    const paths = session.files
      .filter((f) => chosen.has(f.path))
      .flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]))
    void runSplitCommit(session.repo, session.hash, paths, first.trim(), second.trim())
  }

  const plural = (n: number): string => `${n} file${n === 1 ? '' : 's'}`

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal split-editor"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="modal-title">Split commit {session.hash.slice(0, 7)}</div>
        <div className="modal-message">
          Pick the files for the first commit; the others stay in the second, which keeps the files
          as they are now.{' '}
          {session.isHead ? '' : 'The commits after it are recreated on top of the two. '}
          Your uncommitted changes are left alone.
        </div>
        {session.pushedTo && (
          <div className="rebase-problem">
            It is already on {session.pushedTo}: you will have to force push, and anyone who pulled
            it must fix their copy.
          </div>
        )}
        <div className="split-files">
          {session.files.map((f) => (
            <label key={f.path} className="split-file">
              <input type="checkbox" checked={chosen.has(f.path)} onChange={() => toggle(f.path)} />
              <span className={`file-status status-${f.status}`}>{f.status}</span>
              <span className="split-path mono" title={f.path}>
                {f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
              </span>
              <span className="split-where">{chosen.has(f.path) ? 'first' : 'second'}</span>
            </label>
          ))}
        </div>
        <div className="split-messages">
          <label>
            <span>First commit · {plural(count)}</span>
            <textarea
              rows={4}
              value={first}
              autoFocus
              placeholder="Message of the first commit"
              onChange={(e) => setFirst(e.target.value)}
            />
          </label>
          <label>
            <span>Second commit · {plural(rest)}</span>
            <textarea rows={4} value={second} onChange={(e) => setSecond(e.target.value)} />
          </label>
        </div>
        {problem && <div className="split-hint">{problem}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!!problem} onClick={split}>
            Split commit
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SplitEditor(): React.JSX.Element | null {
  const session = useUi((s) => s.split)
  // Keyed by commit: every opening starts afresh
  return session ? <Editor key={session.hash} session={session} /> : null
}
