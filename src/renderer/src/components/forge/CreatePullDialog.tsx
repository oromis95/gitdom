// A new pull request from a branch: its target, title and description (the repository's template,
// or its commits), draft or not, reviewers and labels, with the commits it brings. A branch not
// pushed yet, or with commits to push, is pushed first.
import { useEffect, useMemo, useState } from 'react'
import { GitCommitHorizontal, GitPullRequest } from 'lucide-react'
import { FORGE_NAMES, PULL_NOUN, type Candidate, type PullLabel } from '../../../../shared/forge'
import type { ReleaseCommit } from '../../../../shared/releaseNotes'
import { isReady, useForge } from '../../forge'
import { createPull } from '../../pullActions'
import { useApp } from '../../store'
import { readableOn } from '../../themes'
import ReviewerPicker from './ReviewerPicker'
import { titleOfBranch } from './pullText'

export default function CreatePullDialog(): React.JSX.Element | null {
  const request = useForge((s) => s.create)
  // Keyed: each request starts with a fresh form
  return request ? <CreateForm key={`${request.repo}\n${request.branch}`} {...request} /> : null
}

function CreateForm({
  repo,
  branch: initialBranch
}: {
  repo: string
  branch: string
}): React.JSX.Element | null {
  const snapshot = useApp((s) => s.tabs.find((t) => t.path === repo)?.snapshot)
  const status = useForge((s) => s.byRepo[repo])
  const [branch, setBranch] = useState(initialBranch)
  const ready = isReady(status) ? status : null
  const remote = ready?.repo.remote ?? 'origin'
  const targets = useMemo(
    () =>
      (snapshot?.refs ?? [])
        .filter((r) => r.type === 'remote' && r.remote === remote && !r.name.endsWith('/HEAD'))
        .map((r) => r.name.slice(remote.length + 1)),
    [snapshot, remote]
  )
  const [target, setTarget] = useState(() => {
    const preferred = ready?.info?.defaultBranch
    return preferred && targets.includes(preferred)
      ? preferred
      : (targets[0] ?? preferred ?? 'main')
  })
  const [title, setTitle] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [draft, setDraft] = useState(false)
  const [reviewers, setReviewers] = useState<Candidate[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const [labelText, setLabelText] = useState('')
  const [repoLabels, setRepoLabels] = useState<PullLabel[]>([])
  const [template, setTemplate] = useState<string | null>(null)
  const [commits, setCommits] = useState<{ key: string; list: ReleaseCommit[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const kind = ready?.repo.kind ?? 'github'
  const noun = PULL_NOUN[kind].name
  const local = snapshot?.refs.find((r) => r.type === 'local' && r.name === branch)
  const needsPush = !local?.upstream || (local.ahead ?? 0) > 0
  const commitsKey = `${target}\n${branch}`

  useEffect(() => {
    void window.api.forge
      .template(repo)
      .then((result) => setTemplate(result.ok ? result.value : ''))
    if (ready?.info?.labels)
      void window.api.forge.labels(repo).then((result) => result.ok && setRepoLabels(result.value))
    // Read once when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo])

  useEffect(() => {
    let alive = true
    void window.api.op(repo, 'releaseCommits', `${remote}/${target}`, branch).then((result) => {
      if (alive) setCommits({ key: commitsKey, list: result.ok ? result.value : [] })
    })
    return () => {
      alive = false
    }
  }, [repo, remote, target, branch, commitsKey])

  const list = commits?.key === commitsKey ? commits.list : null
  // Until edited, the title and description follow the branch and its commits
  const shownTitle = title ?? (list?.length === 1 ? list[0].subject : titleOfBranch(branch))
  const shownBody =
    body ??
    (template ||
      (list && list.length > 1
        ? list.map((c) => `- ${c.subject}`).join('\n')
        : (list?.[0]?.body ?? '')))

  if (!ready || !snapshot) return null
  const close = (): void => useForge.setState({ create: null })
  const allLabels = [
    ...labels,
    ...labelText
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean)
  ]
  const valid = !!shownTitle.trim() && target !== branch && (list === null || list.length > 0)

  const submit = async (): Promise<void> => {
    setBusy(true)
    const done = await createPull(
      repo,
      {
        branch,
        targetBranch: target,
        title: shownTitle.trim(),
        body: shownBody,
        draft,
        reviewers,
        labels: [...new Set(allLabels)]
      },
      needsPush
    )
    setBusy(false)
    if (done) close()
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal create-pull"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !busy) void submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      >
        <div className="modal-title">
          <GitPullRequest size={16} /> New {noun} on {FORGE_NAMES[kind]}
        </div>
        {/* Scrolls on small windows: the title and the buttons stay */}
        <div className="create-scroll">
          <div className="create-branches">
            <label className="modal-field">
              <span>From</span>
              <select value={branch} onChange={(e) => setBranch(e.target.value)}>
                {snapshot.refs
                  .filter((r) => r.type === 'local')
                  .map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <span className="create-arrow">→</span>
            <label className="modal-field">
              <span>Into {remote}/</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {needsPush && (
            <div className="modal-message create-note">
              {local?.upstream
                ? `${branch} has ${local.ahead} commit${local.ahead === 1 ? '' : 's'} to push: GitDom pushes them first.`
                : `${branch} isn't on the remote yet: GitDom pushes it first.`}
            </div>
          )}
          <label className="modal-field">
            <span>Title</span>
            <input autoFocus value={shownTitle} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="modal-field">
            <span>
              Description{' '}
              {template && <span className="muted">from the repository&apos;s template</span>}
            </span>
            <textarea
              className="create-body"
              rows={5}
              value={template === null && body === null ? '' : shownBody}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="modal-field">
            <span>Reviewers</span>
            <ReviewerPicker
              repo={repo}
              chosen={reviewers}
              onChange={setReviewers}
              exclude={[ready.viewer.login]}
            />
          </div>
          {ready.info?.labels && (
            <div className="modal-field">
              <span>Labels</span>
              {repoLabels.length > 0 ? (
                <div className="create-labels">
                  {repoLabels.map((l) => {
                    const on = labels.includes(l.name)
                    return (
                      <button
                        type="button"
                        key={l.name}
                        className={`pull-label create-label${on ? ' on' : ''}`}
                        style={
                          on && l.color
                            ? { background: l.color, color: readableOn(l.color) }
                            : undefined
                        }
                        onClick={() =>
                          setLabels(on ? labels.filter((x) => x !== l.name) : [...labels, l.name])
                        }
                      >
                        {l.name}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <input
                  value={labelText}
                  placeholder="Separated by commas"
                  onChange={(e) => setLabelText(e.target.value)}
                />
              )}
            </div>
          )}
          <label className="modal-check">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            Draft: not ready for review yet
          </label>
          <div className="create-commits">
            {list === null ? (
              <span className="muted">Reading the commits…</span>
            ) : list.length === 0 ? (
              <span className="muted">
                {target === branch
                  ? 'Choose another target branch'
                  : `${branch} has no commits that ${target} hasn't`}
              </span>
            ) : (
              <>
                <div className="muted">
                  {list.length} commit{list.length === 1 ? '' : 's'}
                </div>
                {list.slice(0, 5).map((c) => (
                  <div key={c.hash} className="create-commit">
                    <GitCommitHorizontal size={12} />
                    <span className="mono muted">{c.hash.slice(0, 7)}</span>
                    <span className="pull-commit-subject">{c.subject}</span>
                  </div>
                ))}
                {list.length > 5 && <div className="muted">and {list.length - 5} more</div>}
              </>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
            {busy
              ? needsPush
                ? 'Pushing…'
                : 'Opening…'
              : needsPush
                ? `Push and open`
                : `Open ${noun}`}
          </button>
        </div>
      </form>
    </div>
  )
}
