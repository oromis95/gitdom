// Words and states of pull requests shared by the components: badge tones and titles.
import type {
  CheckState,
  ForgeUser,
  Mergeability,
  MergeState,
  PullRequest,
  ReviewVote
} from '../../../../shared/forge'

/** Where a pull request stands, in one word, for the colour of its badge */
export type PullTone = 'draft' | 'open' | 'approved' | 'changes' | 'conflicts'

export function pullTone(pull: PullRequest): PullTone {
  if (pull.state === 'draft') return 'draft'
  if (pull.merge.state === 'conflicts') return 'conflicts'
  if (pull.review === 'changes') return 'changes'
  if (pull.review === 'approved') return 'approved'
  return 'open'
}

export const TONE_TITLES: Record<PullTone, string> = {
  draft: 'Draft',
  open: 'Open',
  approved: 'Approved',
  changes: 'Changes requested',
  conflicts: 'Conflicts'
}

export const CHECK_TITLES: Record<CheckState, string> = {
  success: 'Checks passed',
  failure: 'Checks failed',
  pending: 'Checks running',
  neutral: 'Checks skipped or cancelled'
}

export const VOTE_TITLES: Record<ReviewVote, string> = {
  approved: 'approved',
  changes: 'requested changes',
  commented: 'commented',
  requested: 'review requested'
}

export const voteTitle = (vote: ReviewVote): string => VOTE_TITLES[vote]

export const MERGE_TITLES: Record<MergeState, string> = {
  clean: 'Ready to merge',
  conflicts: 'Has conflicts',
  blocked: "Can't be merged yet",
  behind: 'Behind the target branch',
  draft: 'Draft',
  unknown: 'Mergeability not known yet'
}

/**
 * The title and the detail of whether a pull request can be merged, and the class of its colour:
 * one that can be merged with something to know (failing checks) is a warning, not a go-ahead.
 */
export function mergeText(merge: Mergeability): {
  title: string
  detail: string | null
  tone: string
} {
  const detail = merge.reason && merge.reason !== MERGE_TITLES[merge.state] ? merge.reason : null
  if (merge.state === 'clean' && detail)
    return { title: 'Can be merged', detail, tone: 'merge-warning' }
  return { title: MERGE_TITLES[merge.state], detail, tone: `merge-${merge.state}` }
}

/** How a person is named: the login, unless it's an email (Azure DevOps), then the name. */
export const who = (user: ForgeUser): string =>
  user.login.includes('@') ? (user.name ?? user.login) : user.login

/** A branch name as a title: "feature/login-form" gives "Login form". */
export function titleOfBranch(branch: string): string {
  const words = (branch.split('/').pop() ?? branch).replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
