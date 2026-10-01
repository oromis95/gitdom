import { useEffect, useState } from 'react'
import { FileText, Folder } from 'lucide-react'
import type { CleanPreview, CleanScope } from '../../../shared/api'
import { confirm, notify, useUi, type CleanSession } from '../ui'
import { run } from '../actions'
import { formatBytes } from '../statistics'

const SCOPES: { scope: CleanScope; label: string; title: string }[] = [
  { scope: 'untracked', label: 'Untracked', title: 'New files git doesn’t know about yet' },
  {
    scope: 'ignored',
    label: 'Ignored',
    title: 'Files the ignore rules leave out: build output, dependencies, logs'
  },
  { scope: 'all', label: 'Both', title: 'Untracked and ignored files' }
]

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function Dialog({ session }: { session: CleanSession }): React.JSX.Element {
  const { repo } = session
  const close = (): void => useUi.setState({ clean: null })
  const [scope, setScope] = useState(session.scope)
  const [loaded, setLoaded] = useState<{
    scope: CleanScope
    preview: CleanPreview | null
    error: string | null
  } | null>(null)
  const preview = loaded?.scope === scope ? loaded.preview : null
  const error = loaded?.scope === scope ? loaded.error : null
  // Unticked entries, for the scope they were unticked in
  const [unticked, setUnticked] = useState<{ scope: CleanScope; paths: Set<string> }>({
    scope,
    paths: new Set()
  })
  const skipped = unticked.scope === scope ? unticked.paths : new Set<string>()
  const [query, setQuery] = useState('')
  const [toTrash, setToTrash] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Not while the confirmation is open: Escape cancels that one only
      if (e.key === 'Escape' && document.querySelectorAll('.modal').length === 1) close()
    }
    // Capturing, before the confirmation closes itself
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'cleanPreview', scope).then((result) => {
      if (cancelled) return
      setLoaded({
        scope,
        preview: result.ok ? result.value : null,
        error: result.ok ? null : result.error
      })
    })
    return () => {
      cancelled = true
    }
  }, [repo, scope])

  const needle = query.trim().replace(/\\/g, '/').toLowerCase()
  const shown = (preview?.entries ?? []).filter((e) => e.path.toLowerCase().includes(needle))
  const chosen = shown.filter((e) => !skipped.has(e.path))
  const bytes = chosen.reduce((n, e) => n + e.size, 0)
  const partial = chosen.some((e) => e.partial)
  const size = `${formatBytes(bytes)}${partial ? '+' : ''}`

  const tick = (paths: string[], on: boolean): void => {
    const next = new Set(skipped)
    for (const path of paths) {
      if (on) next.delete(path)
      else next.add(path)
    }
    setUnticked({ scope, paths: next })
  }

  const remove = async (): Promise<void> => {
    const what = plural(chosen.length, 'item')
    if (
      !toTrash &&
      !(await confirm(
        'Delete for good',
        `Delete ${what} (${size}) for good? They are not in the repository, so git has no copy, and they don’t go to the Recycle Bin.`,
        'Delete',
        true
      ))
    ) {
      return
    }
    setBusy(true)
    const ok = await run(
      repo,
      'cleanFiles',
      chosen.map((e) => e.path),
      toTrash
    )
    setBusy(false)
    if (!ok) return
    notify(
      'success',
      toTrash ? `Moved ${what} to the Recycle Bin (${size})` : `Deleted ${what} (${size})`
    )
    close()
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal clean-up" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Clean up the working tree</div>
        <div className="modal-message">
          Remove the files that aren&apos;t in the repository: new files never committed, or ignored
          ones such as build output. Untick what you want to keep.
        </div>
        <div className="clean-up-options">
          <div className="segmented">
            {SCOPES.map((s) => (
              <button
                key={s.scope}
                type="button"
                className={s.scope === scope ? 'active' : ''}
                title={s.title}
                onClick={() => setScope(s.scope)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <input
            className="clean-up-query mono"
            placeholder="Filter"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="clean-up-heading">
          {error
            ? error
            : !preview
              ? 'Looking for files…'
              : preview.entries.length === 0
                ? scope === 'ignored'
                  ? 'No ignored files: nothing to clean up'
                  : 'No untracked files: nothing to clean up'
                : shown.length === 0
                  ? 'Nothing matches the filter'
                  : `${chosen.length} of ${plural(shown.length, 'item')} chosen, ${size}${
                      preview.more ? `; ${preview.more} more not listed` : ''
                    }`}
        </div>
        {shown.length > 0 && (
          <div className="clean-up-list">
            <label className="clean-up-row clean-up-all">
              <input
                type="checkbox"
                checked={chosen.length === shown.length}
                ref={(el) => {
                  if (el) el.indeterminate = chosen.length > 0 && chosen.length < shown.length
                }}
                onChange={(e) =>
                  tick(
                    shown.map((s) => s.path),
                    e.target.checked
                  )
                }
              />
              <span className="clean-up-path">All</span>
            </label>
            {shown.map((e) => (
              <label key={e.path} className="clean-up-row">
                <input
                  type="checkbox"
                  checked={!skipped.has(e.path)}
                  onChange={(ev) => tick([e.path], ev.target.checked)}
                />
                {e.path.endsWith('/') ? <Folder size={13} /> : <FileText size={13} />}
                <span className="clean-up-path mono" title={e.path}>
                  {e.path}
                </span>
                {scope === 'all' && e.ignored && <span className="clean-up-tag">ignored</span>}
                <span className="clean-up-size">
                  {e.path.endsWith('/') && `${plural(e.files, 'file')}${e.partial ? '+' : ''} · `}
                  {formatBytes(e.size)}
                  {e.partial ? '+' : ''}
                </span>
              </label>
            ))}
          </div>
        )}
        {preview && preview.nested.length > 0 && (
          <div className="clean-up-note">
            Left alone, as repositories of their own: {preview.nested.join(', ')}
          </div>
        )}
        <label className="modal-check">
          <input type="checkbox" checked={toTrash} onChange={(e) => setToTrash(e.target.checked)} />
          Move to the Recycle Bin, where they can be restored
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || chosen.length === 0}
            onClick={() => void remove()}
          >
            {toTrash ? 'Move to Recycle Bin' : 'Delete for good'}
            {chosen.length > 0 && ` (${chosen.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CleanUp(): React.JSX.Element | null {
  const session = useUi((s) => s.clean)
  return session ? <Dialog key={session.repo} session={session} /> : null
}
