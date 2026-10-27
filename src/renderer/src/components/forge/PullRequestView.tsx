// A pull request in place of the graph: its state, checks, reviews, description and conversation.
// Its changes are fetched and listed in the detail panel, read with GitDom's own diff.
import { useEffect, useState } from 'react'
import {
  ExternalLink,
  FileDiff,
  GitCommitHorizontal,
  GitMerge,
  MessageSquare,
  RefreshCw,
  X
} from 'lucide-react'
import {
  FORGE_NAMES,
  sameRepoPath,
  type ForgeKind,
  type PullDetail,
  type PullRange,
  type PullRequest
} from '../../../../shared/forge'
import type { ReleaseCommit } from '../../../../shared/releaseNotes'
import type { RepoSnapshot } from '../../../../shared/types'
import {
  isReady,
  openInBrowser,
  pullLabel,
  refreshForge,
  useForge,
  useForgeStatus
} from '../../forge'
import { useApp } from '../../store'
import { fromTerminal } from '../../ui'
import { relativeTime } from '../../time'
import Markdown from './Markdown'
import { Avatar, CheckIcon, Labels, PullIcon, VoteIcon } from './PullBits'
import { CHECK_TITLES, mergeText, voteTitle } from './pullText'

const STATE_TITLES = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' }

// Read once per pull request version while GitDom runs: reopening one is instant
const details = new Map<string, PullDetail>()
const ranges = new Map<string, { range: PullRange; commits: ReleaseCommit[] }>()

type Load<T> = { key: string; value?: T; error?: string }

/** The pull request's commits fetched, its range shown in the detail panel. */
function useChanges(
  repo: string,
  pull: PullRequest,
  kind: ForgeKind
): Load<{ range: PullRange; commits: ReleaseCommit[] }> {
  const key = `${repo}\n${pull.number}\n${pull.headSha}`
  const [state, setState] = useState<Load<{ range: PullRange; commits: ReleaseCommit[] }>>({ key })
  const cached = ranges.get(key)
  useEffect(() => {
    let alive = true
    const show = (range: PullRange): void => {
      const { compare, tabs, active } = useApp.getState()
      // Only while the pull request is still the one shown
      if (tabs[active]?.pullRequest === pull.number)
        compare({ ...range, title: `Changes of ${pullLabel(kind, pull.number)}` })
    }
    if (cached) {
      show(cached.range)
      return
    }
    void (async () => {
      const fetched = await window.api.forge.fetchPull(repo, pull.number)
      if (!alive) return
      if (!fetched.ok) return setState({ key, error: fetched.error })
      const listed = await window.api.op(
        repo,
        'releaseCommits',
        fetched.value.from,
        fetched.value.to
      )
      const value = { range: fetched.value, commits: listed.ok ? listed.value : [] }
      ranges.set(key, value)
      if (!alive) return
      setState({ key, value })
      show(value.range)
    })()
    return () => {
      alive = false
    }
    // key covers the pull request and its last commit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return cached ? { key, value: cached } : state.key === key ? state : { key }
}

function useDetail(repo: string, pull: PullRequest): Load<PullDetail> {
  const key = `${repo}\n${pull.number}\n${pull.updatedAt}`
  const [state, setState] = useState<Load<PullDetail>>({ key })
  const cached = details.get(key)
  useEffect(() => {
    if (details.has(key)) return
    let alive = true
    void window.api.forge.detail(repo, pull.number).then((result) => {
      if (!alive) return
      if (result.ok) details.set(key, result.value)
      setState(result.ok ? { key, value: result.value } : { key, error: result.error })
    })
    return () => {
      alive = false
    }
    // key covers the pull request and when it last changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return cached ? { key, value: cached } : state.key === key ? state : { key }
}

function Commits({
  snapshot,
  pull,
  kind,
  changes
}: {
  snapshot: RepoSnapshot
  pull: PullRequest
  kind: ForgeKind
  changes: Load<{ range: PullRange; commits: ReleaseCommit[] }>
}): React.JSX.Element {
  const { select, compare } = useApp.getState()
  const label = pullLabel(kind, pull.number)
  if (changes.error)
    return (
      <div className="banner-error pull-fetch-error">
        Couldn&apos;t fetch {label}: {changes.error}
      </div>
    )
  if (!changes.value) return <div className="muted">Fetching the commits…</div>
  const { range, commits } = changes.value
  return (
    <>
      <button
        className="btn btn-small"
        onClick={() => compare({ ...range, title: `Changes of ${label}` })}
        title="List the changed files in the detail panel"
      >
        <FileDiff size={13} /> All changes
      </button>
      <div className="pull-commits">
        {commits.map((c) => {
          const inGraph = snapshot.commits.some((x) => x.hash === c.hash)
          return (
            <button
              key={c.hash}
              className="pull-commit"
              title={inGraph ? 'Select it in the graph' : 'Show its changes'}
              onClick={() =>
                inGraph
                  ? select(c.hash, true)
                  : compare({
                      from: `${c.hash}^`,
                      to: c.hash,
                      title: `${c.hash.slice(0, 7)} of ${label}`
                    })
              }
            >
              <GitCommitHorizontal size={13} />
              <span className="mono muted">{c.hash.slice(0, 7)}</span>
              <span className="pull-commit-subject">{c.subject}</span>
              <span className="muted">{c.author}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function Checks({ pull }: { pull: PullRequest }): React.JSX.Element | null {
  const checks = pull.checks
  if (!checks) return null
  // Failures first, then those still running
  const order = { failure: 0, pending: 1, neutral: 2, success: 3 }
  const items = [...checks.items].sort((a, b) => order[a.state] - order[b.state])
  return (
    <section className="pull-box">
      <h3>
        <CheckIcon state={checks.state} size={15} /> {CHECK_TITLES[checks.state]}
        {checks.url && (
          <button className="row-action" onClick={() => openInBrowser(checks.url!)}>
            <ExternalLink size={12} /> Details
          </button>
        )}
      </h3>
      <div className="pull-checks">
        {items.map((c, i) => (
          <button
            key={`${c.name}${i}`}
            className="pull-check"
            disabled={!c.url}
            title={c.url ? 'Open its log' : undefined}
            onClick={() => c.url && openInBrowser(c.url)}
          >
            <CheckIcon state={c.state} size={12} /> <span>{c.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Conversation({ detail }: { detail: Load<PullDetail> }): React.JSX.Element {
  if (detail.error) return <div className="banner-error">{detail.error}</div>
  if (!detail.value) return <div className="muted">Loading the conversation…</div>
  if (!detail.value.timeline.length) return <div className="muted">No comments yet</div>
  return (
    <>
      {detail.value.timeline.map((entry, i) => (
        <div key={i} className={`pull-comment${entry.vote ? ` vote-${entry.vote}` : ''}`}>
          <div className="pull-comment-head">
            <Avatar user={entry.author} size={20} />
            <b>{entry.author.login}</b>
            {entry.vote ? (
              <span className="pull-comment-vote">
                <VoteIcon vote={entry.vote} /> {voteTitle(entry.vote)}
              </span>
            ) : entry.path ? (
              <span className="muted">
                on <span className="mono">{entry.path}</span>
                {entry.line ? `:${entry.line}` : ''}
              </span>
            ) : (
              <span className="muted">commented</span>
            )}
            <span className="muted pull-comment-date">{relativeTime(entry.date / 1000)}</span>
          </div>
          {entry.body.trim() && <Markdown text={entry.body} />}
        </div>
      ))}
    </>
  )
}

function PullPage({
  snapshot,
  pull,
  kind,
  forgePath
}: {
  snapshot: RepoSnapshot
  pull: PullRequest
  kind: ForgeKind
  /** The repository on the service: a source elsewhere is a fork, named with its owner */
  forgePath: string
}): React.JSX.Element {
  const repo = snapshot.path
  const changes = useChanges(repo, pull, kind)
  const detail = useDetail(repo, pull)
  const commits = changes.value?.commits.length
  // The detail knows better whether it can be merged
  const merge = mergeText(detail.value?.merge ?? pull.merge)
  return (
    <div className="pull-body">
      <div className="pull-summary">
        <span className={`pull-state tone-${pull.state}`}>
          <PullIcon pull={pull} size={13} /> {STATE_TITLES[pull.state]}
        </span>
        <Avatar user={pull.author} size={20} />
        <span>
          <b>{pull.author.login}</b> wants to merge
          {commits !== undefined ? ` ${commits} commit${commits === 1 ? '' : 's'}` : ''} into{' '}
          <span className="mono pull-branch">{pull.targetBranch}</span> from{' '}
          <span className="mono pull-branch">
            {sameRepoPath(pull.sourceRepo, forgePath) ? '' : `${pull.sourceRepo.split('/')[0]}:`}
            {pull.sourceBranch}
          </span>
        </span>
        <span className="muted">· opened {relativeTime(pull.createdAt / 1000)}</span>
      </div>
      <Labels pull={pull} />

      <div className="pull-columns">
        <div className="pull-main">
          <section className="pull-box pull-description">
            {detail.value ? (
              detail.value.body.trim() ? (
                <Markdown text={detail.value.body} />
              ) : (
                <div className="muted">No description</div>
              )
            ) : detail.error ? null : (
              <div className="muted">Loading…</div>
            )}
          </section>
          <section className="pull-conversation">
            <h3>
              <MessageSquare size={15} /> Conversation
            </h3>
            <Conversation detail={detail} />
          </section>
        </div>
        <div className="pull-side">
          <section className={`pull-box pull-merge ${merge.tone}`}>
            <h3>
              <GitMerge size={15} /> {merge.title}
            </h3>
            {merge.detail && <div>{merge.detail}</div>}
          </section>
          <section className="pull-box">
            <h3>Reviewers</h3>
            {pull.reviewers.length ? (
              pull.reviewers.map((r) => (
                <div key={r.user.login} className="pull-reviewer-row">
                  <Avatar user={r.user} size={20} />
                  <span>{r.user.name ?? r.user.login}</span>
                  <span className={`pull-vote vote-${r.vote}`}>
                    <VoteIcon vote={r.vote} /> {voteTitle(r.vote)}
                  </span>
                </div>
              ))
            ) : (
              <div className="muted">Nobody asked yet</div>
            )}
          </section>
          <Checks pull={pull} />
          <section className="pull-box">
            <h3>
              <GitCommitHorizontal size={15} /> Commits
            </h3>
            <Commits snapshot={snapshot} pull={pull} kind={kind} changes={changes} />
          </section>
        </div>
      </div>
    </div>
  )
}

export default function PullRequestView({
  snapshot,
  number
}: {
  snapshot: RepoSnapshot
  number: number
}): React.JSX.Element {
  const status = useForgeStatus(snapshot.path)
  const loading = useForge((s) => !!s.loading[snapshot.path])
  const openPullRequest = useApp((s) => s.openPullRequest)
  const pull = isReady(status) ? status.pulls.find((p) => p.number === number) : undefined
  const kind = status && status.state !== 'none' ? status.repo.kind : 'github'

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !fromTerminal(e) && !document.querySelector('.modal, .menu'))
        openPullRequest(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPullRequest])

  return (
    <div className="diff-view inspector pull-view">
      <div className="diff-header">
        {pull ? <PullIcon pull={pull} size={16} /> : null}
        <span className="diff-path pull-title">
          <span className="muted">{pullLabel(kind, number)}</span> {pull?.title ?? ''}
        </span>
        <span className="toolbar-spacer" />
        {pull && (
          <button className="row-action" onClick={() => openInBrowser(pull.url)}>
            <ExternalLink size={13} /> Open in {FORGE_NAMES[kind]}
          </button>
        )}
        <button
          className={`diff-close${loading ? ' spinning' : ''}`}
          onClick={() => void refreshForge(snapshot.path, true)}
          title="Read it again"
        >
          <RefreshCw size={15} />
        </button>
        <button className="diff-close" onClick={() => openPullRequest(null)} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      {pull ? (
        <PullPage
          key={pull.number}
          snapshot={snapshot}
          pull={pull}
          kind={kind}
          forgePath={isReady(status) ? status.repo.path : ''}
        />
      ) : (
        <div className="center-message">
          {isReady(status)
            ? `${pullLabel(kind, number)} is no longer open`
            : loading
              ? 'Loading…'
              : 'Connect the account to see it'}
        </div>
      )}
    </div>
  )
}
