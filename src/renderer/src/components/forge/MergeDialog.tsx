// Merging a pull request: the methods the repository allows, the commit message, deleting the
// source branch, or merging by itself once the checks pass. Then the local branch is cleaned up.
import { useEffect, useState } from 'react'
import { GitMerge } from 'lucide-react'
import {
  MERGE_METHODS,
  sameRepoPath,
  type ForgeRepoInfo,
  type MergeMethod,
  type PullRequest
} from '../../../../shared/forge'
import { isReady, pullLabel, useForge } from '../../forge'
import { afterMerge } from '../../pullActions'
import { fail } from '../../actions/core'
import { mergeText } from './pullText'

export default function MergeDialog(): React.JSX.Element | null {
  const target = useForge((s) => s.merge)
  const status = useForge((s) => (target ? s.byRepo[target.repo] : undefined))
  const pull = isReady(status) ? status.pulls.find((p) => p.number === target?.number) : undefined
  if (!target || !pull || !isReady(status)) return null
  return (
    <MergeForm
      key={`${target.repo}\n${pull.number}`}
      repo={target.repo}
      pull={pull}
      fork={!sameRepoPath(pull.sourceRepo, status.repo.path)}
    />
  )
}

function MergeForm({
  repo,
  pull,
  fork
}: {
  repo: string
  pull: PullRequest
  fork: boolean
}): React.JSX.Element {
  const kind = useForge((s) => {
    const status = s.byRepo[repo]
    return status && status.state !== 'none' ? status.repo.kind : 'github'
  })
  const [info, setInfo] = useState<ForgeRepoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<MergeMethod | null>(null)
  const [message, setMessage] = useState('')
  const [deleteBranch, setDeleteBranch] = useState<boolean | null>(null)
  // Merging by itself suits a pull request still waiting for its checks or reviews
  const waiting = pull.merge.state === 'blocked' || pull.checks?.state === 'pending'
  const [auto, setAuto] = useState(waiting)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.forge.repoInfo(repo, pull.targetBranch).then((result) => {
      if (result.ok) setInfo(result.value)
      else setError(result.error)
    })
  }, [repo, pull.targetBranch])

  const label = pullLabel(kind, pull.number)
  const close = (): void => useForge.setState({ merge: null })
  const chosen = method ?? info?.methods[0] ?? 'merge'
  const remove = !fork && (deleteBranch ?? info?.deleteBranch ?? false)
  const canAuto = !!info?.autoMerge
  const state = mergeText(pull.merge)

  const submit = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.forge.mergePull(repo, pull.number, {
      method: chosen,
      message,
      deleteBranch: remove,
      auto: canAuto && auto
    })
    setBusy(false)
    if (!result.ok) return fail(result)
    close()
    await afterMerge(repo, pull, result.value)
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal merge-pull"
        onSubmit={(e) => {
          e.preventDefault()
          if (info && !busy) void submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      >
        <div className="modal-title">
          <GitMerge size={16} /> Merge {label}
        </div>
        <div className="modal-message">
          {pull.title}: <span className="mono">{pull.sourceBranch}</span> into{' '}
          <span className="mono">{pull.targetBranch}</span>
        </div>
        {pull.merge.state !== 'clean' && (
          <div className={`modal-message pull-merge ${state.tone}`}>
            {state.title}
            {state.detail ? `: ${state.detail}` : ''}
          </div>
        )}
        {error && <div className="banner-error">{error}</div>}
        {!info && !error && <div className="muted">Reading what the repository allows…</div>}
        {info && (
          <>
            <div className="merge-methods" role="radiogroup">
              {info.methods.map((m) => (
                <label key={m} className={`merge-method${m === chosen ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="method"
                    checked={m === chosen}
                    onChange={() => setMethod(m)}
                  />
                  <span>
                    <b>{MERGE_METHODS[m].name}</b>
                    <span className="muted">{MERGE_METHODS[m].detail}</span>
                  </span>
                </label>
              ))}
            </div>
            {chosen !== 'rebase' && chosen !== 'fastForward' && (
              <label className="modal-field">
                <span>
                  Commit message <span className="muted">empty for the service&apos;s own</span>
                </span>
                <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
              </label>
            )}
            {!fork && (
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={remove}
                  onChange={(e) => setDeleteBranch(e.target.checked)}
                />
                Delete {pull.sourceBranch} on the remote after merging
              </label>
            )}
            {canAuto && (
              <label className="modal-check">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                Merge by itself once the checks pass and the reviews are in
              </label>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!info || busy}>
            {busy ? 'Merging…' : canAuto && auto ? 'Merge when ready' : 'Merge'}
          </button>
        </div>
      </form>
    </div>
  )
}
