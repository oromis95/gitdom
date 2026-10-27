// The hover card of a pull request: who opened it, its reviews, checks and whether it can be merged.
import { GitMerge, MessageSquare } from 'lucide-react'
import type { ForgeKind, PullRequest } from '../../../../shared/forge'
import { pullLabel } from '../../forge'
import { relativeTime } from '../../time'
import { Avatar, CheckIcon, Labels, PullIcon, VoteIcon } from './PullBits'
import { CHECK_TITLES, mergeText, voteTitle } from './pullText'

/** Failed checks are listed by name; this many at most */
const SHOWN_CHECKS = 4

export default function PullCard({
  pull,
  kind,
  hint
}: {
  pull: PullRequest
  kind: ForgeKind
  hint?: string
}): React.JSX.Element {
  const failed = pull.checks?.items.filter((c) => c.state === 'failure') ?? []
  const running = pull.checks?.items.filter((c) => c.state === 'pending').length ?? 0
  const merge = mergeText(pull.merge)
  return (
    <>
      <div className="hover-title">
        <PullIcon pull={pull} />
        <span className="hover-name">
          {pullLabel(kind, pull.number)} {pull.title}
        </span>
      </div>
      <div className="muted pull-card-line">
        <Avatar user={pull.author} size={16} /> {pull.author.login} wants to merge{' '}
        <span className="mono">{pull.sourceBranch}</span> into{' '}
        <span className="mono">{pull.targetBranch}</span>
      </div>
      <div className="muted">
        Opened {relativeTime(pull.createdAt / 1000)}, updated {relativeTime(pull.updatedAt / 1000)}
        {pull.comments > 0 && (
          <>
            {' · '}
            <MessageSquare size={11} /> {pull.comments}
          </>
        )}
      </div>
      <Labels pull={pull} />
      {pull.reviewers.length > 0 && (
        <div className="hover-facts pull-card-reviews">
          {pull.reviewers.map((r) => (
            <div key={r.user.login} className="pull-card-line">
              <VoteIcon vote={r.vote} /> <Avatar user={r.user} size={16} />
              {r.user.login} <span className="muted">{voteTitle(r.vote)}</span>
            </div>
          ))}
        </div>
      )}
      {pull.checks && (
        <div className="hover-facts">
          <div className="pull-card-line">
            <CheckIcon state={pull.checks.state} /> {CHECK_TITLES[pull.checks.state]}
            {running > 0 && pull.checks.state !== 'pending' && (
              <span className="muted">, {running} still running</span>
            )}
          </div>
          {failed.slice(0, SHOWN_CHECKS).map((c) => (
            <div key={c.name} className="pull-card-line pull-card-check">
              <CheckIcon state="failure" size={11} /> {c.name}
            </div>
          ))}
          {failed.length > SHOWN_CHECKS && (
            <div className="muted pull-card-check">and {failed.length - SHOWN_CHECKS} more</div>
          )}
        </div>
      )}
      <div className={`hover-note pull-merge ${merge.tone}`}>
        <GitMerge size={13} /> {merge.title}
        {merge.detail ? `: ${merge.detail}` : ''}
      </div>
      {hint && <div className="hover-hint">{hint}</div>}
    </>
  )
}
