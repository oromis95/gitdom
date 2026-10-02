// A patch file, read before applying it (ADV-07): the commits it carries, the files it changes,
// and whether it applies as it is. Applied as commits (git am) or as changes (git apply).
import { useEffect, useState } from 'react'
import { FileText, GitCommitHorizontal } from 'lucide-react'
import type { PatchInfo } from '../../../shared/api'
import { useUi, type PatchSession } from '../ui'
import { applyPatch } from '../actions'

type How = 'commits' | 'worktree' | 'stage'

function Dialog({ session }: { session: PatchSession }): React.JSX.Element {
  const { repo, path } = session
  const close = (): void => useUi.setState({ patch: null })
  const [info, setInfo] = useState<{ value: PatchInfo | null; error: string | null }>()
  const [busy, setBusy] = useState(false)

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
    void window.api.op(repo, 'inspectPatch', path).then((result) => {
      if (!cancelled)
        setInfo(
          result.ok ? { value: result.value, error: null } : { value: null, error: result.error }
        )
    })
    return () => {
      cancelled = true
    }
  }, [repo, path])

  const apply = async (how: How): Promise<void> => {
    setBusy(true)
    const done = await applyPatch(repo, path, how)
    setBusy(false)
    if (done) close()
  }

  const patch = info?.value
  const name = path.split(/[\\/]/).pop() ?? path
  const hasCommits = !!patch?.commits.length

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : close}>
      <div className="modal patch-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Apply a patch</div>
        <div className="patch-file mono" title={path}>
          {name}
        </div>
        {!info ? (
          <div className="patch-note">Reading the patch…</div>
        ) : !patch ? (
          <div className="patch-problem">{info.error}</div>
        ) : (
          <>
            {hasCommits && (
              <div className="patch-section">
                <h3>
                  {patch.commits.length === 1 ? '1 commit' : `${patch.commits.length} commits`}
                </h3>
                {patch.commits.map((c, i) => (
                  <div key={i} className="patch-row">
                    <GitCommitHorizontal size={14} />
                    <span className="patch-subject">{c.subject}</span>
                    <span className="muted">{c.author}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="patch-section">
              <h3>{patch.files.length === 1 ? '1 file' : `${patch.files.length} files`}</h3>
              <div className="patch-files">
                {patch.files.map((f) => (
                  <div key={f.path} className="patch-row">
                    <FileText size={14} />
                    <span className="patch-subject mono">{f.path}</span>
                    {f.added === null ? (
                      <span className="muted">binary</span>
                    ) : (
                      <span>
                        <span className="patch-added">+{f.added}</span>{' '}
                        <span className="patch-removed">−{f.removed}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {patch.applies ? (
              <div className="patch-ok">It applies cleanly to the working tree.</div>
            ) : (
              <div className="patch-problem">
                <div>
                  It doesn&apos;t apply as it is: the files changed since it was made.{' '}
                  {hasCommits
                    ? 'Applying it as commits tries a three-way merge, leaving any conflicts to resolve.'
                    : '"Apply and stage" tries a three-way merge, leaving any conflicts to resolve.'}
                </div>
                <pre className="mono">{patch.problem}</pre>
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={close}>
            Cancel
          </button>
          <span className="patch-gap" />
          {patch && (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy || !patch.applies}
                title="Change the files, leaving the changes to review and commit"
                onClick={() => void apply('worktree')}
              >
                Apply to the working tree
              </button>
              <button
                type="button"
                className={`btn${hasCommits ? '' : ' btn-primary'}`}
                disabled={busy}
                title="Change the files and stage the changes"
                onClick={() => void apply('stage')}
              >
                Apply and stage
              </button>
              {hasCommits && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  title="Commit each one on the current branch, with its author and message (git am)"
                  onClick={() => void apply('commits')}
                >
                  Apply as {patch.commits.length === 1 ? 'a commit' : 'commits'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PatchDialog(): React.JSX.Element | null {
  const session = useUi((s) => s.patch)
  return session ? <Dialog key={session.repo + session.path} session={session} /> : null
}
