// Azure DevOps Services and Azure DevOps Server, through the REST API 7.1. The list brings the pull
// requests with their reviewers' votes; checks are the pull request's statuses and its build
// policies, read per pull request and kept while nothing changes. The other policies (reviewers,
// comments, work items) say why it can't be merged.
import type {
  CheckState,
  ForgeUser,
  MergeMethod,
  Mergeability,
  PullCheck,
  PullChecks,
  PullComment,
  PullRequest,
  PullReviewer,
  ReviewDecision,
  ReviewVote
} from '../../shared/forge'
import { ForgeError, jsonBody, requestJson } from './http'
import {
  PULL_LIMIT,
  PerPullCache,
  afterCreate,
  basic,
  bearer,
  mapLimit,
  overall,
  toMillis,
  type ForgeProvider,
  type ProviderContext
} from './provider'

/**
 * The parts of a repository path: org/project/repo on dev.azure.com, collection/project/repo on a
 * server, where the collection may have several segments (tfs/DefaultCollection).
 */
export function azureParts(repoPath: string): {
  collection: string[]
  project: string
  repo: string
} {
  const segments = repoPath.split('/')
  return { collection: segments.slice(0, -2), project: segments.at(-2)!, repo: segments.at(-1)! }
}

const join = (segments: string[]): string => segments.map(encodeURIComponent).join('/')

function urls(
  host: string,
  repoPath: string
): { collection: string; project: string; repo: string; web: string } {
  const { collection, project, repo } = azureParts(repoPath)
  const root = `https://${host}/${join(collection)}`
  const projectUrl = `${root}/${encodeURIComponent(project)}`
  return {
    collection: root,
    project: projectUrl,
    repo: `${projectUrl}/_apis/git/repositories/${encodeURIComponent(repo)}`,
    web: `${projectUrl}/_git/${encodeURIComponent(repo)}`
  }
}

/** Azure DevOps' path of a repository in git URLs, as Git Credential Manager keys its tokens. */
export function azureGitPath(repoPath: string): string {
  const { collection, project, repo } = azureParts(repoPath)
  return [...collection, project, '_git', repo].join('/')
}

interface Identity {
  id?: string
  displayName: string
  uniqueName?: string
  imageUrl?: string
  isContainer?: boolean
}

interface Reviewer extends Identity {
  vote: number
  isRequired?: boolean
  hasDeclined?: boolean
}

interface PullNode {
  pullRequestId: number
  title: string
  description?: string
  isDraft?: boolean
  createdBy: Identity | null
  creationDate: string
  sourceRefName: string
  targetRefName: string
  mergeStatus?: 'notSet' | 'queued' | 'conflicts' | 'succeeded' | 'rejectedByPolicy' | 'failure'
  lastMergeSourceCommit?: { commitId: string }
  reviewers?: Reviewer[]
  labels?: { name: string; active?: boolean }[]
  repository: { project: { id: string } }
  forkSource?: { repository: { name: string; project?: { name: string }; remoteUrl?: string } }
}

interface Status {
  id: number
  state: 'notSet' | 'pending' | 'succeeded' | 'failed' | 'error' | 'notApplicable'
  description?: string
  context: { name: string; genre?: string }
  targetUrl?: string
}

interface Evaluation {
  status: 'queued' | 'running' | 'approved' | 'rejected' | 'notApplicable' | 'broken'
  configuration: {
    isBlocking: boolean
    isEnabled?: boolean
    type: { displayName: string }
    settings?: { displayName?: string }
  }
  context?: { buildId?: number; buildDefinitionName?: string }
}

const GHOST: ForgeUser = { login: 'ghost', name: null, avatarUrl: null }

export const azureUser = (identity: Identity | null): ForgeUser =>
  identity
    ? {
        login: identity.uniqueName ?? identity.displayName,
        name: identity.displayName,
        avatarUrl: identity.imageUrl ?? null,
        ...(identity.id ? { id: identity.id } : {})
      }
    : GHOST

const branch = (ref: string): string => ref.replace(/^refs\/heads\//, '')

/** 10 approved, 5 approved with suggestions, -5 waiting for the author, -10 rejected */
function vote(reviewer: Reviewer): ReviewVote {
  if (reviewer.vote >= 5) return 'approved'
  if (reviewer.vote < 0) return 'changes'
  return 'requested'
}

const STATUS_STATES: Record<Status['state'], CheckState> = {
  notSet: 'pending',
  pending: 'pending',
  succeeded: 'success',
  failed: 'failure',
  error: 'failure',
  notApplicable: 'neutral'
}

const POLICY_STATES: Record<Evaluation['status'], CheckState> = {
  queued: 'pending',
  running: 'pending',
  approved: 'success',
  rejected: 'failure',
  broken: 'failure',
  notApplicable: 'neutral'
}

// What a policy that isn't met keeps from merging, in words
const POLICY_REASONS: Record<string, string> = {
  'Minimum number of reviewers': 'Review required',
  'Required reviewers': 'Required reviewers must approve',
  'Comment requirements': 'Open comments must be resolved',
  'Work item linking': 'A work item must be linked',
  Build: 'Required builds must pass',
  Status: 'Required status checks must pass'
}

export interface AzureChecks {
  checks: PullChecks | null
  /** Why blocking policies keep it from being merged */
  blockers: string[]
}

export function azureChecks(
  statuses: Status[],
  evaluations: Evaluation[],
  projectUrl: string
): AzureChecks {
  // A status is posted again for each push: the latest of each context counts
  const latest = new Map<string, Status>()
  for (const s of [...statuses].sort((a, b) => a.id - b.id))
    latest.set(`${s.context.genre ?? ''}/${s.context.name}`, s)
  const items: PullCheck[] = [...latest.values()].map((s) => ({
    name:
      s.description || (s.context.genre ? `${s.context.genre}/${s.context.name}` : s.context.name),
    state: STATUS_STATES[s.state] ?? 'pending',
    url: s.targetUrl ?? null
  }))
  const blockers: string[] = []
  for (const e of evaluations) {
    if (e.configuration.isEnabled === false) continue
    const type = e.configuration.type.displayName
    if (type === 'Build')
      items.push({
        name: e.configuration.settings?.displayName || e.context?.buildDefinitionName || 'Build',
        state: POLICY_STATES[e.status] ?? 'pending',
        url: e.context?.buildId ? `${projectUrl}/_build/results?buildId=${e.context.buildId}` : null
      })
    if (
      e.configuration.isBlocking &&
      ['queued', 'running', 'rejected', 'broken'].includes(e.status)
    )
      blockers.push(POLICY_REASONS[type] ?? `The "${type}" policy isn't met`)
  }
  const checks = items.length
    ? { state: overall(items.map((i) => i.state)), items, url: null }
    : null
  return { checks, blockers: [...new Set(blockers)] }
}

export function azurePull(
  node: PullNode,
  host: string,
  repoPath: string,
  extra: AzureChecks
): PullRequest {
  const reviewers: PullReviewer[] = (node.reviewers ?? [])
    .filter((r) => !r.hasDeclined)
    .map((r) => ({ user: azureUser(r), vote: vote(r) }))
  const required = (node.reviewers ?? []).filter((r) => r.isRequired && !r.hasDeclined)
  const review: ReviewDecision = reviewers.some((r) => r.vote === 'changes')
    ? 'changes'
    : required.some((r) => vote(r) !== 'approved') || extra.blockers.includes('Review required')
      ? 'required'
      : reviewers.some((r) => r.vote === 'approved')
        ? 'approved'
        : null

  let merge: Mergeability
  if (node.isDraft) merge = { state: 'draft', reason: 'Draft: not ready for review' }
  else if (node.mergeStatus === 'conflicts')
    merge = { state: 'conflicts', reason: 'Conflicts with the target branch' }
  else if (extra.blockers.length || node.mergeStatus === 'rejectedByPolicy')
    merge = { state: 'blocked', reason: extra.blockers[0] ?? 'Blocked by the branch policies' }
  else if (node.mergeStatus === 'succeeded')
    merge = {
      state: 'clean',
      reason: extra.checks?.state === 'failure' ? 'Some checks are failing' : null
    }
  else
    merge = {
      state: 'unknown',
      reason: node.mergeStatus === 'failure' ? 'The trial merge failed' : null
    }

  const fork = node.forkSource?.repository
  const { collection, project } = azureParts(repoPath)
  return {
    number: node.pullRequestId,
    title: node.title,
    url: `${urls(host, repoPath).web}/pullrequest/${node.pullRequestId}`,
    state: node.isDraft ? 'draft' : 'open',
    author: azureUser(node.createdBy),
    sourceBranch: branch(node.sourceRefName),
    sourceRepo: fork
      ? [...collection, fork.project?.name ?? project, fork.name].join('/')
      : repoPath,
    ...(fork?.remoteUrl ? { sourceUrl: fork.remoteUrl } : {}),
    targetBranch: branch(node.targetRefName),
    headSha: node.lastMergeSourceCommit?.commitId ?? '',
    createdAt: toMillis(node.creationDate),
    // Azure DevOps doesn't say when a pull request last changed
    updatedAt: toMillis(node.creationDate),
    review,
    reviewers,
    checks: extra.checks,
    merge,
    comments: 0,
    labels: (node.labels ?? [])
      .filter((l) => l.active !== false)
      .map((l) => ({ name: l.name, color: null }))
  }
}

interface Thread {
  isDeleted?: boolean
  threadContext?: {
    filePath: string
    rightFileStart?: { line: number }
    leftFileStart?: { line: number }
  } | null
  comments: {
    author: Identity | null
    content?: string
    publishedDate: string
    commentType?: string
    isDeleted?: boolean
  }[]
}

const API = 'api-version=7.1'

function get<T>(ctx: ProviderContext, url: string): Promise<T> {
  return requestJson<T>(`${url}${url.includes('?') ? '&' : '?'}${API}`, {
    headers: { Accept: 'application/json', ...azure.auth(ctx) }
  })
}

/** A change to the repository's pull requests: its JSON body, with the account's token. */
function send<T>(
  ctx: ProviderContext,
  method: 'POST' | 'PUT' | 'PATCH',
  url: string,
  body: unknown
): Promise<T> {
  return requestJson<T>(
    `${url}${url.includes('?') ? '&' : '?'}${API}`,
    jsonBody(method, azure.auth(ctx), body)
  )
}

const STRATEGIES: Record<MergeMethod, string> = {
  merge: 'noFastForward',
  squash: 'squash',
  rebase: 'rebase',
  rebaseMerge: 'rebaseMerge',
  // Azure DevOps has no plain fast-forward: a rebase is one when nothing else came in
  fastForward: 'rebase'
}

// Settled once every check has finished; votes change the reviewer policies, and are in the key
const checksCache = new PerPullCache<AzureChecks>((c) => c.checks?.state !== 'pending')

export const azure: ForgeProvider = {
  async viewer(ctx: ProviderContext, repoPath: string) {
    const data = await requestJson<{
      authenticatedUser?: {
        id?: string
        providerDisplayName?: string
        properties?: { Account?: { $value?: string } }
      }
    }>(`${urls(ctx.host, repoPath).collection}/_apis/connectionData?api-version=7.1-preview`, {
      headers: { Accept: 'application/json', ...azure.auth(ctx) }
    })
    const user = data.authenticatedUser
    const account = user?.properties?.Account?.$value
    // Without a valid token the answer is the anonymous user
    if (!user || !account) throw new ForgeError(`${ctx.host} refused the token`, 401, true)
    return {
      login: account,
      name: user.providerDisplayName ?? null,
      avatarUrl: null,
      ...(user.id ? { id: user.id } : {})
    }
  },

  async load(ctx, repoPath) {
    const at = urls(ctx.host, repoPath)
    const [viewer, list] = await Promise.all([
      azure.viewer(ctx, repoPath),
      get<{ value: PullNode[] }>(
        ctx,
        `${at.repo}/pullrequests?searchCriteria.status=active&$top=${PULL_LIMIT}`
      )
    ])
    const pulls = await mapLimit(list.value, 6, async (node) => {
      const votes = (node.reviewers ?? []).map((r) => r.vote).join()
      const extra = await checksCache
        .get(
          `${repoPath}#${node.pullRequestId}@${node.lastMergeSourceCommit?.commitId}:${votes}`,
          async () => {
            const artifact = `vstfs:///CodeReview/CodeReviewId/${node.repository.project.id}/${node.pullRequestId}`
            const [statuses, evaluations] = await Promise.all([
              get<{ value: Status[] }>(
                ctx,
                `${at.repo}/pullRequests/${node.pullRequestId}/statuses`
              ),
              requestJson<{ value: Evaluation[] }>(
                `${at.project}/_apis/policy/evaluations?artifactId=${encodeURIComponent(artifact)}&api-version=7.1-preview.1`,
                { headers: { Accept: 'application/json', ...azure.auth(ctx) } }
              ).catch(() => ({ value: [] }))
            ])
            return azureChecks(statuses.value, evaluations.value, at.project)
          }
        )
        // Checks the token can't read leave the pull request without them
        .catch((): AzureChecks => ({ checks: null, blockers: [] }))
      return azurePull(node, ctx.host, repoPath, extra)
    })
    return { viewer, pulls }
  },

  async detail(ctx, repoPath, number) {
    const at = urls(ctx.host, repoPath)
    const [pull, threads, commits] = await Promise.all([
      get<PullNode>(ctx, `${at.repo}/pullrequests/${number}`),
      get<{ value: Thread[] }>(ctx, `${at.repo}/pullRequests/${number}/threads`),
      get<{ value: { commitId: string }[] }>(
        ctx,
        `${at.repo}/pullRequests/${number}/commits?$top=250`
      )
    ])
    const timeline: PullComment[] = []
    for (const thread of threads.value) {
      if (thread.isDeleted) continue
      const context = thread.threadContext
      for (const c of thread.comments) {
        // System comments are votes, pushes and merges, already shown elsewhere
        if (c.isDeleted || c.commentType !== 'text' || !c.content) continue
        timeline.push({
          author: azureUser(c.author),
          body: c.content,
          date: toMillis(c.publishedDate),
          ...(context
            ? {
                path: context.filePath.replace(/^\//, ''),
                line: context.rightFileStart?.line ?? context.leftFileStart?.line
              }
            : {})
        })
      }
    }
    timeline.sort((a, b) => a.date - b.date)
    return {
      number,
      body: pull.description ?? '',
      timeline,
      // Newest first in Azure DevOps' answer
      commits: commits.value.map((c) => c.commitId).reverse()
    }
  },

  headRef: () => null,

  async info(ctx, repoPath) {
    const repo = await get<{ defaultBranch?: string }>(ctx, urls(ctx.host, repoPath).repo)
    return {
      defaultBranch: branch(repo.defaultBranch ?? 'refs/heads/main'),
      // The branch policies may allow fewer: Azure DevOps refuses the others when merging
      methods: ['merge', 'squash', 'rebase', 'rebaseMerge'],
      deleteBranch: false,
      autoMerge: true,
      labels: true,
      reopen: true
    }
  },

  async candidates(ctx, repoPath, query) {
    const q = query.trim()
    if (!q) return []
    const { collection } = azureParts(repoPath)
    // On dev.azure.com people live in the organization's directory service (vssps)
    const base =
      ctx.host === 'dev.azure.com'
        ? `https://vssps.dev.azure.com/${encodeURIComponent(collection[0])}`
        : urls(ctx.host, repoPath).collection
    const found = await get<{
      value: {
        id: string
        providerDisplayName?: string
        properties?: { Mail?: { $value?: string }; Account?: { $value?: string } }
      }[]
    }>(
      ctx,
      `${base}/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(q)}&queryMembership=None`
    )
    return found.value.slice(0, 20).map((i) => {
      const login = i.properties?.Mail?.$value || i.properties?.Account?.$value || i.id
      return {
        id: i.id,
        user: { login, name: i.providerDisplayName ?? null, avatarUrl: null, id: i.id }
      }
    })
  },

  labels: async () => [],

  async create(ctx, repoPath, pull) {
    const at = urls(ctx.host, repoPath)
    const fork = pull.sourceRepo.toLowerCase() !== repoPath.toLowerCase()
    const forkId = fork
      ? (await get<{ id: string }>(ctx, urls(ctx.host, pull.sourceRepo).repo)).id
      : undefined
    const created = await send<{ pullRequestId: number }>(ctx, 'POST', `${at.repo}/pullrequests`, {
      sourceRefName: `refs/heads/${pull.sourceBranch}`,
      targetRefName: `refs/heads/${pull.targetBranch}`,
      title: pull.title,
      description: pull.body,
      isDraft: pull.draft,
      reviewers: pull.reviewers.map((r) => ({ id: r.id })),
      labels: pull.labels.map((name) => ({ name })),
      ...(forkId ? { forkSource: { repository: { id: forkId } } } : {})
    })
    return afterCreate(
      { number: created.pullRequestId, url: `${at.web}/pullrequest/${created.pullRequestId}` },
      []
    )
  },

  async update(ctx, repoPath, pull, change) {
    const at = urls(ctx.host, repoPath)
    const fields = {
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.body !== undefined ? { description: change.body } : {}),
      ...(change.draft !== undefined ? { isDraft: change.draft } : {}),
      ...(change.state ? { status: change.state === 'closed' ? 'abandoned' : 'active' } : {})
    }
    if (Object.keys(fields).length)
      await send(ctx, 'PATCH', `${at.repo}/pullrequests/${pull.number}`, fields)
    for (const reviewer of change.reviewers ?? [])
      await send(
        ctx,
        'PUT',
        `${at.repo}/pullRequests/${pull.number}/reviewers/${encodeURIComponent(reviewer.id)}`,
        { vote: 0 }
      )
  },

  async merge(ctx, repoPath, pull, options) {
    const at = urls(ctx.host, repoPath)
    const message = options.message.trim()
    const completionOptions = {
      mergeStrategy: STRATEGIES[options.method],
      deleteSourceBranch: options.deleteBranch,
      ...(message ? { mergeCommitMessage: message } : {})
    }
    if (options.auto) {
      // Auto-complete is set by someone: the account's identity
      const viewer = await azure.viewer(ctx, repoPath)
      await send(ctx, 'PATCH', `${at.repo}/pullrequests/${pull.number}`, {
        autoCompleteSetBy: { id: viewer.id },
        completionOptions
      })
      return 'auto'
    }
    const done = await send<{ status?: string }>(
      ctx,
      'PATCH',
      `${at.repo}/pullrequests/${pull.number}`,
      {
        status: 'completed',
        // Refused if someone pushed since: what was reviewed is what gets merged
        lastMergeSourceCommit: { commitId: pull.headSha },
        completionOptions
      }
    )
    // Completing takes Azure DevOps a moment: it may still be at work when it answers
    return done.status === 'completed' ? 'merged' : 'queued'
  },

  auth: (ctx) =>
    // Microsoft Entra tokens (Git Credential Manager's, by default) are JWTs; personal access
    // tokens go as a password with any username
    /^eyJ[\w-]*\.[\w-]+\.[\w-]*$/.test(ctx.token) ? bearer(ctx) : basic('', ctx.token)
}
