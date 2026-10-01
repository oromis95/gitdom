import { useEffect, useMemo, useState } from 'react'
import { formatNotes, groupCommits, type ReleaseCommit } from '../../../shared/releaseNotes'
import { compareVersions } from '../../../shared/releases'
import { useApp } from '../store'
import { notify, useUi, type ReleaseNotesSession } from '../ui'

const HEAD = 'HEAD'
const VERSION = /^v?\d+(?:\.\d+)*/i

/** Versions newest first, then the other tags by name. */
function sortTags(names: string[]): string[] {
  const versions = names.filter((n) => VERSION.test(n)).sort((a, b) => compareVersions(b, a))
  const others = names.filter((n) => !VERSION.test(n)).sort((a, b) => a.localeCompare(b))
  return [...versions, ...others]
}

function Dialog({ session }: { session: ReleaseNotesSession }): React.JSX.Element {
  const { repo } = session
  const close = (): void => useUi.setState({ releaseNotes: null })
  const refs = useApp((s) => s.tabs.find((t) => t.path === repo)?.snapshot?.refs)
  const tags = useMemo(
    () => sortTags((refs ?? []).filter((r) => r.type === 'tag').map((r) => r.name)),
    [refs]
  )
  const [to, setTo] = useState(session.to)
  // The start of the range for each end: the tag before it, unless picked; '' for the first commit
  const [start, setStart] = useState<{ to: string; from: string } | null>(null)
  const from = start?.to === to ? start.from : undefined
  const [loaded, setLoaded] = useState<{
    range: string
    commits: ReleaseCommit[]
    error: string | null
  } | null>(null)
  const range = `${from}..${to}`
  const commits = loaded?.range === range ? loaded.commits : null
  const error = loaded?.range === range ? loaded.error : null
  const [hashes, setHashes] = useState(false)
  const [authors, setAuthors] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'previousTag', to === HEAD ? HEAD : `${to}^`).then((result) => {
      if (!cancelled) setStart({ to, from: result.ok && result.value ? result.value : '' })
    })
    return () => {
      cancelled = true
    }
  }, [repo, to])

  useEffect(() => {
    if (from === undefined) return
    let cancelled = false
    void window.api.op(repo, 'releaseCommits', from || null, to).then((result) => {
      if (cancelled) return
      setLoaded({
        range: `${from}..${to}`,
        commits: result.ok ? result.value : [],
        error: result.ok ? null : result.error
      })
    })
    return () => {
      cancelled = true
    }
  }, [repo, from, to])

  const groups = useMemo(() => (commits ? groupCommits(commits) : []), [commits])
  const notes = commits
    ? formatNotes(to === HEAD ? 'Unreleased' : to, groups, { hashes, authors })
    : ''
  const counted = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal release-notes"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="modal-title">Release notes</div>
        <div className="modal-message">
          The commits between two tags, grouped by type: by their prefix (feat:, fix:…) when they
          have one, by the first word of the summary otherwise. Merges are left out.
        </div>
        <div className="release-notes-range">
          <label>
            From
            <select
              value={from ?? ''}
              disabled={from === undefined}
              onChange={(e) => setStart({ to, from: e.target.value })}
            >
              <option value="">the first commit</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            to
            <select value={to} autoFocus onChange={(e) => setTo(e.target.value)}>
              <option value={HEAD}>HEAD (not released yet)</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <span className="toolbar-spacer" />
          <label className="modal-check">
            <input type="checkbox" checked={hashes} onChange={(e) => setHashes(e.target.checked)} />
            Hashes
          </label>
          <label className="modal-check">
            <input
              type="checkbox"
              checked={authors}
              onChange={(e) => setAuthors(e.target.checked)}
            />
            Authors
          </label>
        </div>
        <textarea
          className="release-notes-text mono"
          readOnly
          spellCheck={false}
          rows={18}
          value={error ?? (commits ? notes : 'Reading the commits…')}
        />
        <div className="release-notes-count">
          {commits &&
            !error &&
            `${counted} commit${counted === 1 ? '' : 's'}${
              commits.length > counted ? `, ${commits.length - counted} fixup left out` : ''
            } · Markdown`}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
          <button
            className="btn btn-primary"
            disabled={!commits || !!error}
            onClick={() => {
              void navigator.clipboard
                .writeText(notes)
                .then(() => notify('info', 'Release notes copied'))
            }}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReleaseNotes(): React.JSX.Element | null {
  const session = useUi((s) => s.releaseNotes)
  return session ? <Dialog key={`${session.repo}:${session.to}`} session={session} /> : null
}
