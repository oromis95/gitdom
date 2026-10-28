// Pull requests of the services hosting a repository (INT-01, INT-03, SIDE-07): GitHub, GitLab,
// Bitbucket (Cloud and Data Center) and Azure DevOps, read in the main process and shown in a shape
// common to them all.

export type ForgeKind = 'github' | 'gitlab' | 'bitbucket' | 'bitbucketServer' | 'azure'

export const FORGE_NAMES: Record<ForgeKind, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  bitbucketServer: 'Bitbucket Data Center',
  azure: 'Azure DevOps'
}

/** What the service calls a pull request */
export const PULL_NOUN: Record<ForgeKind, { name: string; short: string; prefix: string }> = {
  github: { name: 'pull request', short: 'PR', prefix: '#' },
  gitlab: { name: 'merge request', short: 'MR', prefix: '!' },
  bitbucket: { name: 'pull request', short: 'PR', prefix: '#' },
  bitbucketServer: { name: 'pull request', short: 'PR', prefix: '#' },
  azure: { name: 'pull request', short: 'PR', prefix: '!' }
}

/** The services' own hosts: a server of one's own is named by its host too */
export const PUBLIC_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'dev.azure.com'])

/**
 * A server of the user's own (GitHub Enterprise, GitLab self-managed, Bitbucket Data Center, Azure
 * DevOps Server), set in the preferences.
 */
export interface ForgeHost {
  host: string
  kind: ForgeKind
}

/** The repository on the service whose pull requests GitDom reads. */
export interface ForgeRepo {
  kind: ForgeKind
  /** e.g. github.com, or a server of the user's */
  host: string
  /** owner/name on GitHub, the namespace path on GitLab (group/subgroup/name) */
  path: string
  /** The remote it was found from: upstream when there's one, origin otherwise */
  remote: string
  webUrl: string
}

export interface ForgeUser {
  login: string
  name: string | null
  /** Absolute URL; GitDom loads it in the main process (see ForgeApi.avatar) */
  avatarUrl: string | null
  /** What the service's API names the person by, where it isn't the login (ids, uuids) */
  id?: string
}

export type PullState = 'open' | 'draft' | 'merged' | 'closed'

/** A reviewer's latest word; `requested` when asked and not answered yet */
export type ReviewVote = 'approved' | 'changes' | 'commented' | 'requested'

export interface PullReviewer {
  user: ForgeUser
  vote: ReviewVote
}

export type CheckState = 'success' | 'failure' | 'pending' | 'neutral'

export interface PullCheck {
  name: string
  state: CheckState
  /** Its log or page on the service */
  url: string | null
}

export interface PullChecks {
  state: CheckState
  items: PullCheck[]
  /** The pipeline or checks page */
  url: string | null
}

export type MergeState = 'clean' | 'conflicts' | 'blocked' | 'behind' | 'draft' | 'unknown'

export interface Mergeability {
  state: MergeState
  /** Why it can't be merged, or what to know though it can, e.g. "Some checks are failing" */
  reason: string | null
}

/** Where the pull request stands with its reviews overall */
export type ReviewDecision = 'approved' | 'changes' | 'required' | null

export interface PullLabel {
  name: string
  /** CSS colour, null when the service has none */
  color: string | null
}

export interface PullRequest {
  number: number
  title: string
  url: string
  state: PullState
  author: ForgeUser
  sourceBranch: string
  /** Repository the source branch is in (its path, as in ForgeRepo): another one for a fork */
  sourceRepo: string
  /** Where to fetch a fork's branch from, when the service says (Azure DevOps) */
  sourceUrl?: string
  targetBranch: string
  /** Last commit of the source branch */
  headSha: string
  /** Unix milliseconds */
  createdAt: number
  updatedAt: number
  review: ReviewDecision
  reviewers: PullReviewer[]
  checks: PullChecks | null
  merge: Mergeability
  comments: number
  labels: PullLabel[]
}

export interface PullComment {
  author: ForgeUser
  body: string
  date: number
  /** Set for a review: its verdict */
  vote?: ReviewVote
  /** Set for a comment on a line of the diff */
  path?: string
  line?: number
}

export interface PullDetail {
  number: number
  /** Markdown */
  body: string
  /** Mergeability worked out more exactly than in the list, when the service does so */
  merge?: Mergeability
  /** Comments and reviews, oldest first */
  timeline: PullComment[]
  /** Hashes of the commits, oldest first */
  commits: string[]
}

/** Where a token came from: Git Credential Manager's, a device login, or typed in */
export type TokenSource = 'gcm' | 'oauth' | 'token'

export interface ForgeAccount {
  host: string
  kind: ForgeKind
  user: ForgeUser
  source: TokenSource
}

export type ForgeStatus =
  /** No remote on a service GitDom knows */
  | { state: 'none' }
  /** On a known service, without an account for it yet */
  | { state: 'signedOut'; repo: ForgeRepo; device: boolean }
  | {
      state: 'ready'
      repo: ForgeRepo
      viewer: ForgeUser
      pulls: PullRequest[]
      /** Remotes on the same service and the repository each is (its path): the fork, upstream */
      remotes: Record<string, string>
      /** What the repository allows; null until it could be read */
      info: ForgeRepoInfo | null
      /** Unix milliseconds */
      fetchedAt: number
    }
  /** `auth` when the account's token was refused: it has to be connected again */
  | { state: 'error'; repo: ForgeRepo; error: string; auth: boolean; device: boolean }

export type MergeMethod = 'merge' | 'squash' | 'rebase' | 'rebaseMerge' | 'fastForward'

export const MERGE_METHODS: Record<MergeMethod, { name: string; detail: string }> = {
  merge: { name: 'Merge commit', detail: 'All the commits, joined by a merge commit' },
  squash: { name: 'Squash', detail: 'The changes in a single commit' },
  rebase: { name: 'Rebase', detail: 'The commits replayed on the target branch, no merge commit' },
  rebaseMerge: {
    name: 'Rebase, then merge commit',
    detail: 'The commits replayed on the target branch, then a merge commit'
  },
  fastForward: { name: 'Fast-forward', detail: 'The target branch moved to the last commit' }
}

/** What a repository on the service allows. */
export interface ForgeRepoInfo {
  defaultBranch: string
  /** Merge methods allowed, the default first; on Bitbucket they depend on the target branch */
  methods: MergeMethod[]
  /** Whether the source branch is deleted after a merge by default */
  deleteBranch: boolean
  /** Merging by itself once the checks pass and the reviews are in */
  autoMerge: boolean
  labels: boolean
  /** A closed pull request can be opened again (not on Bitbucket) */
  reopen: boolean
}

/** Someone who can be asked to review: `id` is what the service's API takes */
export interface Candidate {
  id: string
  user: ForgeUser
}

export interface NewPull {
  /** A local branch; GitDom finds the remote it's published to */
  branch: string
  targetBranch: string
  title: string
  body: string
  draft: boolean
  reviewers: Candidate[]
  labels: string[]
}

/** What to change on an open pull request; reviewers are added to those already asked. */
export interface PullChange {
  title?: string
  body?: string
  draft?: boolean
  state?: 'open' | 'closed'
  reviewers?: Candidate[]
}

export interface MergeOptions {
  method: MergeMethod
  /** The commit message, empty for the service's own */
  message: string
  deleteBranch: boolean
  /** Merge by itself once it can, instead of now */
  auto: boolean
}

export interface CreatedPull {
  number: number
  url: string
  /** Something that didn't work once the pull request was open, e.g. asking a reviewer */
  warning?: string
}

/** Where a pull request's branch is, to check it out */
export interface PullSource {
  /** A remote of the repository with the branch: origin, or a fork already added */
  remote: string | null
  /** Otherwise the fork's address, null when it can't be told */
  url: string | null
  branch: string
  /** Who the fork is of, to name a remote after them */
  owner: string
}

/** Merged now, set to merge by itself, or waiting in the service's merge queue */
export type MergeOutcome = 'merged' | 'auto' | 'queued'

/** A device login in progress: the code to type on the service's page. */
export interface DeviceLogin {
  id: number
  userCode: string
  verificationUri: string
  /** Seconds */
  expiresIn: number
}

/** The revisions a pull request's changes are between, fetched into the repository. */
export interface PullRange {
  /** Where the source branch left the target one (their merge base) */
  from: string
  /** The source branch's last commit */
  to: string
}

/** Compares repository paths on a service, which treats them case-insensitively. */
export const sameRepoPath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * "git.example.com gitlab" lines, as written in the preferences; unknown lines are skipped. Bitbucket
 * on a server of one's own is Bitbucket Data Center: Bitbucket Cloud is only bitbucket.org.
 */
export function parseForgeHosts(text: string): ForgeHost[] {
  const hosts: ForgeHost[] = []
  const kinds = new Map(Object.keys(FORGE_NAMES).map((k) => [k.toLowerCase(), k as ForgeKind]))
  for (const line of text.split(/\r?\n/)) {
    const [host, word] = line.trim().split(/\s+/)
    const name = host
      ?.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
    let kind = word ? kinds.get(word.toLowerCase()) : undefined
    if (kind === 'bitbucket' && name !== 'bitbucket.org') kind = 'bitbucketServer'
    if (name && kind) hosts.push({ host: name, kind })
  }
  return hosts
}

/**
 * Who a fork is of, as a remote can be named after them: the owner on GitHub, GitLab and Bitbucket,
 * the project on Azure DevOps, the project's key on Bitbucket Data Center (a personal one, ~USER,
 * without its tilde, which git refuses in a remote's name).
 */
export function forkOwner(kind: ForgeKind, path: string): string {
  const segments = path.split('/')
  if (kind === 'azure') return segments.at(-2) ?? path
  if (kind === 'bitbucketServer') return (segments.at(-2) ?? path).replace(/^~/, '').toLowerCase()
  return segments[0]
}
