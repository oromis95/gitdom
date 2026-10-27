// Small pieces of pull requests used in the graph, the sidebar, the hover card and the view.
import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CircleX,
  GitPullRequest,
  GitPullRequestDraft,
  MessageSquare,
  X
} from 'lucide-react'
import type {
  CheckState,
  ForgeKind,
  ForgeUser,
  PullRequest,
  ReviewVote
} from '../../../../shared/forge'
import { pullLabel, useAvatar } from '../../forge'
import { CHECK_TITLES, TONE_TITLES, VOTE_TITLES, pullTone } from './pullText'
import { readableOn } from '../../themes'

export function CheckIcon({
  state,
  size = 13
}: {
  state: CheckState
  size?: number
}): React.JSX.Element {
  const Icon =
    state === 'success'
      ? CircleCheck
      : state === 'failure'
        ? CircleX
        : state === 'pending'
          ? CircleDashed
          : CircleMinus
  return <Icon size={size} className={`check-${state}`} aria-label={CHECK_TITLES[state]} />
}

/** The pull request icon, drawn as a draft or open */
export function PullIcon({
  pull,
  size = 14
}: {
  pull: PullRequest
  size?: number
}): React.JSX.Element {
  const Icon = pull.state === 'draft' ? GitPullRequestDraft : GitPullRequest
  return <Icon size={size} className={`pull-icon tone-${pullTone(pull)}`} />
}

/** "#42" with the colour of its state and a dot for its checks: on branch labels and in lists. */
export function PullBadge({
  pull,
  kind,
  onOpen
}: {
  pull: PullRequest
  kind: ForgeKind
  onOpen?: () => void
}): React.JSX.Element {
  const tone = pullTone(pull)
  return (
    <span
      className={`pull-badge tone-${tone}`}
      title={`${pullLabel(kind, pull.number)} ${pull.title}\n${TONE_TITLES[tone]}${
        pull.checks ? ` · ${CHECK_TITLES[pull.checks.state]}` : ''
      }${onOpen ? '\nClick to open' : ''}`}
      role={onOpen ? 'button' : undefined}
      onClick={
        onOpen
          ? (e) => {
              e.stopPropagation()
              onOpen()
            }
          : undefined
      }
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {pullLabel(kind, pull.number)}
      {pull.checks && <span className={`pull-check-dot check-${pull.checks.state}`} />}
    </span>
  )
}

const initials = (user: ForgeUser): string =>
  (user.name ?? user.login)
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

const AVATAR_COLORS = ['#5b6bc0', '#2e8b6e', '#b5651d', '#8e44ad', '#c0392b', '#2874a6', '#7d8c2e']

function colorOf(login: string): string {
  let hash = 0
  for (const ch of login) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function Avatar({ user, size = 20 }: { user: ForgeUser; size?: number }): React.JSX.Element {
  const image = useAvatar(user.avatarUrl)
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  if (image) return <img className="forge-avatar" src={image} style={style} alt="" />
  const background = colorOf(user.login)
  return (
    <span className="forge-avatar" style={{ ...style, background, color: readableOn(background) }}>
      {initials(user)}
    </span>
  )
}

export function VoteIcon({
  vote,
  size = 12
}: {
  vote: ReviewVote
  size?: number
}): React.JSX.Element {
  if (vote === 'approved') return <Check size={size} className="vote-approved" />
  if (vote === 'changes') return <X size={size} className="vote-changes" />
  if (vote === 'commented') return <MessageSquare size={size} className="vote-commented" />
  return <CircleDot size={size} className="vote-requested" />
}

export function Reviewers({ pull }: { pull: PullRequest }): React.JSX.Element | null {
  if (!pull.reviewers.length) return null
  return (
    <span className="pull-reviewers">
      {pull.reviewers.map((r) => (
        <span
          key={r.user.login}
          className={`pull-reviewer vote-${r.vote}`}
          title={`${r.user.name ?? r.user.login}: ${VOTE_TITLES[r.vote]}`}
        >
          <Avatar user={r.user} size={18} />
          <VoteIcon vote={r.vote} size={10} />
        </span>
      ))}
    </span>
  )
}

export function Labels({ pull }: { pull: PullRequest }): React.JSX.Element | null {
  if (!pull.labels.length) return null
  return (
    <span className="pull-labels">
      {pull.labels.map((l) => (
        <span
          key={l.name}
          className="pull-label"
          style={l.color ? { background: l.color, color: readableOn(l.color) } : undefined}
        >
          {l.name}
        </span>
      ))}
    </span>
  )
}
