// GitHub and GitHub Enterprise, through the GraphQL API: one query brings the pull requests with
// their reviews, checks and mergeability. Changes go through the REST API, except what only
// GraphQL does (draft or ready, merging by itself).
import type {
  CheckState,
  ForgeUser,
  MergeMethod,
  Mergeability,
  PullCheck,
  PullComment,
  PullRequest,
  PullReviewer,
  ReviewDecision,
  ReviewVote
} from '../../shared/forge'
import { ForgeError, graphql, jsonBody, requestJson } from './http'
import {
  afterCreate,
  bearer,
  splitMessage,
  toMillis,
  type ForgeProvider,
  type ProviderContext
} from './provider'

export const githubEndpoint = (host: string): string =>
  host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`

const restBase = (host: string): string =>
  host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`

/** A REST request on a repository, e.g. rest(ctx, 'acme/app', '/pulls'). */
function rest<T>(
  ctx: ProviderContext,
  repoPath: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const [owner, name] = repoPath.split('/').map(encodeURIComponent)
  return requestJson<T>(`${restBase(ctx.host)}/repos/${owner}/${name}${path}`, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string>),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...bearer(ctx)
    }
  })
}

const sameRepo = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export const READY_MUTATION = `mutation($id: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } }
}`

export const DRAFT_MUTATION = `mutation($id: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { id } }
}`

export const AUTO_MERGE_MUTATION = `mutation($id: ID!, $method: PullRequestMergeMethod!, $headline: String, $body: String) {
  enablePullRequestAutoMerge(
    input: { pullRequestId: $id, mergeMethod: $method, commitHeadline: $headline, commitBody: $body }
  ) { pullRequest { id } }
}`

const GRAPHQL_METHODS: Partial<Record<MergeMethod, string>> = {
  merge: 'MERGE',
  squash: 'SQUASH',
  rebase: 'REBASE'
}

interface Actor {
  login: string
  avatarUrl: string | null
  name?: string | null
}

const ACTOR = 'login avatarUrl ... on User { name }'

// Teams asked to review: reading them needs the read:org scope, which Git Credential Manager's
// tokens don't have. Without it they're left out.
const TEAM = '... on Team { teamName: name slug teamAvatar: avatarUrl }'

export const PULLS_QUERY = `query($owner: String!, $name: String!, $limit: Int!) {
  viewer { ${ACTOR} }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title url isDraft createdAt updatedAt
        author { ${ACTOR} }
        headRefName headRefOid baseRefName
        headRepository { nameWithOwner }
        reviewDecision mergeable totalCommentsCount
        labels(first: 10) { nodes { name color } }
        reviewRequests(first: 10) {
          nodes { requestedReviewer { ... on User { login avatarUrl name } ${TEAM} } }
        }
        latestOpinionatedReviews(first: 10) { nodes { state author { ${ACTOR} } } }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 25) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl }
                    ... on StatusContext { context state targetUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`

const PULLS_QUERY_NO_TEAMS = PULLS_QUERY.replace(TEAM, '')

/**
 * Pull requests read at a time: fewer than on other services, since GitHub works out their checks
 * and reviews within a time limit
 */
const GITHUB_LIMIT = 20

/** Hosts whose token can't read teams: asked without them from then on */
const noTeams = new Set<string>()

export const DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number body isDraft reviewDecision mergeable mergeStateStatus
      last: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      comments(first: 100) { nodes { body createdAt author { ${ACTOR} } } }
      reviews(first: 100) {
        nodes {
          state body submittedAt createdAt author { ${ACTOR} }
          comments(first: 50) { nodes { body path line originalLine createdAt author { ${ACTOR} } } }
        }
      }
      commits(first: 250) { nodes { commit { oid } } }
    }
  }
}`

type Context =
  | {
      __typename: 'CheckRun'
      name: string
      status: string
      conclusion: string | null
      detailsUrl: string | null
    }
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null }

interface PullNode {
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  author: Actor | null
  headRefName: string
  headRefOid: string
  baseRefName: string
  headRepository: { nameWithOwner: string } | null
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  totalCommentsCount: number | null
  labels: { nodes: { name: string; color: string }[] }
  reviewRequests: {
    nodes: {
      requestedReviewer:
        | { login: string; avatarUrl: string | null; name: string | null }
        | { teamName: string; slug: string; teamAvatar: string | null }
        | null
    }[]
  }
  latestOpinionatedReviews: { nodes: { state: string; author: Actor | null }[] }
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: { state: string; contexts: { nodes: (Context | null)[] } } | null
      }
    }[]
  }
}

const GHOST: ForgeUser = { login: 'ghost', name: null, avatarUrl: null }

export const githubUser = (actor: Actor | null): ForgeUser =>
  actor
    ? { login: actor.login, name: actor.name ?? null, avatarUrl: actor.avatarUrl ?? null }
    : GHOST

function checkState(context: Context): CheckState {
  if (context.__typename === 'StatusContext') {
    if (context.state === 'SUCCESS') return 'success'
    if (context.state === 'FAILURE' || context.state === 'ERROR') return 'failure'
    return 'pending'
  }
  if (context.status !== 'COMPLETED') return 'pending'
  if (context.conclusion === 'SUCCESS') return 'success'
  if (['NEUTRAL', 'SKIPPED', 'STALE'].includes(context.conclusion ?? '')) return 'neutral'
  return 'failure'
}

const ROLLUP: Record<string, CheckState> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  PENDING: 'pending',
  EXPECTED: 'pending'
}

const VOTES: Record<string, ReviewVote> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  COMMENTED: 'commented'
}

const DECISIONS: Record<string, ReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  REVIEW_REQUIRED: 'required'
}

interface MergeFacts {
  isDraft: boolean
  reviewDecision: string | null
  mergeable: string
  /**
   * GitHub's own verdict: only asked for one pull request at a time, since working it out for a
   * whole list can take GitHub longer than it allows (502 on big repositories)
   */
  mergeStateStatus?: string
}

function blockedReason(facts: MergeFacts, checks: CheckState | null): string | null {
  if (facts.reviewDecision === 'CHANGES_REQUESTED') return 'Changes requested'
  if (facts.reviewDecision === 'REVIEW_REQUIRED') return 'Review required'
  if (checks === 'failure') return 'Some checks are failing'
  if (checks === 'pending') return 'Waiting for the checks'
  return null
}

export function mergeability(facts: MergeFacts, checks: CheckState | null): Mergeability {
  if (facts.isDraft) return { state: 'draft', reason: 'Draft: not ready for review' }
  if (facts.mergeable === 'CONFLICTING' || facts.mergeStateStatus === 'DIRTY')
    return { state: 'conflicts', reason: 'Conflicts with the target branch' }
  if (facts.mergeStateStatus === undefined) {
    // From the list: what is known without GitHub's verdict
    const reason = blockedReason(facts, checks)
    if (facts.reviewDecision === 'CHANGES_REQUESTED' || facts.reviewDecision === 'REVIEW_REQUIRED')
      return { state: 'blocked', reason }
    return facts.mergeable === 'MERGEABLE'
      ? { state: 'clean', reason }
      : { state: 'unknown', reason: null }
  }
  switch (facts.mergeStateStatus) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { state: 'clean', reason: null }
    case 'UNSTABLE':
      return { state: 'clean', reason: 'Some checks are failing' }
    case 'BEHIND':
      return { state: 'behind', reason: 'Behind the target branch: it needs updating' }
    case 'BLOCKED':
      return {
        state: 'blocked',
        reason: blockedReason(facts, checks) ?? 'Blocked by the branch rules'
      }
    default:
      return { state: 'unknown', reason: null }
  }
}

export function githubPull(node: PullNode, repoPath: string): PullRequest {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup ?? null
  const items: PullCheck[] = (rollup?.contexts.nodes ?? [])
    .filter((c): c is Context => c !== null)
    .map((c) =>
      c.__typename === 'CheckRun'
        ? { name: c.name, state: checkState(c), url: c.detailsUrl }
        : { name: c.context, state: checkState(c), url: c.targetUrl }
    )
  const checkSummary = rollup ? (ROLLUP[rollup.state] ?? 'pending') : null

  const reviewers: PullReviewer[] = []
  for (const review of node.latestOpinionatedReviews.nodes) {
    const vote = VOTES[review.state]
    if (vote && review.author) reviewers.push({ user: githubUser(review.author), vote })
  }
  for (const { requestedReviewer: r } of node.reviewRequests.nodes) {
    if (!r) continue
    const user: ForgeUser =
      'login' in r
        ? { login: r.login, name: r.name, avatarUrl: r.avatarUrl }
        : { login: r.slug, name: r.teamName, avatarUrl: r.teamAvatar }
    // Asked again after reviewing: the request is what counts now
    const index = reviewers.findIndex((x) => x.user.login === user.login)
    if (index >= 0) reviewers.splice(index, 1)
    reviewers.push({ user, vote: 'requested' })
  }

  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.isDraft ? 'draft' : 'open',
    author: githubUser(node.author),
    sourceBranch: node.headRefName,
    // A deleted fork leaves no repository: the branch can only be read through the pull ref
    sourceRepo: node.headRepository?.nameWithOwner ?? repoPath,
    targetBranch: node.baseRefName,
    headSha: node.headRefOid,
    createdAt: toMillis(node.createdAt),
    updatedAt: toMillis(node.updatedAt),
    review: node.reviewDecision ? DECISIONS[node.reviewDecision] : null,
    reviewers,
    checks: rollup ? { state: checkSummary ?? 'pending', items, url: `${node.url}/checks` } : null,
    merge: mergeability(node, checkSummary),
    comments: node.totalCommentsCount ?? 0,
    labels: node.labels.nodes.map((l) => ({ name: l.name, color: `#${l.color}` }))
  }
}

interface DetailNode extends MergeFacts {
  number: number
  body: string
  last: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
  comments: { nodes: { body: string; createdAt: string; author: Actor | null }[] }
  reviews: {
    nodes: {
      state: string
      body: string
      submittedAt: string | null
      createdAt: string
      author: Actor | null
      comments: {
        nodes: {
          body: string
          path: string
          line: number | null
          originalLine: number | null
          createdAt: string
          author: Actor | null
        }[]
      }
    }[]
  }
  commits: { nodes: { commit: { oid: string } }[] }
}

function split(repoPath: string): { owner: string; name: string } {
  const [owner, name] = repoPath.split('/')
  return { owner, name }
}

export const github: ForgeProvider = {
  async viewer(ctx: ProviderContext) {
    const data = await graphql<{ viewer: Actor }>(
      githubEndpoint(ctx.host),
      ctx.token,
      `query { viewer { ${ACTOR} } }`,
      {}
    )
    return githubUser(data.viewer)
  },

  async load(ctx, repoPath) {
    type Answer = {
      viewer: Actor
      repository: { pullRequests: { nodes: PullNode[] } } | null
    }
    const ask = async (query: string): Promise<Answer> => {
      try {
        return await graphql<Answer>(githubEndpoint(ctx.host), ctx.token, query, {
          ...split(repoPath),
          limit: GITHUB_LIMIT
        })
      } catch (e) {
        // Too much work for GitHub on a big repository: half as many
        if (!(e instanceof ForgeError && (e.status === 502 || e.status === 504))) throw e
        return graphql<Answer>(githubEndpoint(ctx.host), ctx.token, query, {
          ...split(repoPath),
          limit: GITHUB_LIMIT / 2
        })
      }
    }
    let data: Answer
    if (noTeams.has(ctx.host)) data = await ask(PULLS_QUERY_NO_TEAMS)
    else {
      try {
        data = await ask(PULLS_QUERY)
      } catch (e) {
        if (!(e instanceof ForgeError && e.auth && e.message.includes('read:org'))) throw e
        noTeams.add(ctx.host)
        data = await ask(PULLS_QUERY_NO_TEAMS)
      }
    }
    if (!data.repository)
      throw new Error(`${repoPath} isn't on ${ctx.host}, or the account can't see it`)
    return {
      viewer: githubUser(data.viewer),
      pulls: data.repository.pullRequests.nodes.map((n) => githubPull(n, repoPath))
    }
  },

  async detail(ctx, repoPath, number) {
    const data = await graphql<{ repository: { pullRequest: DetailNode | null } | null }>(
      githubEndpoint(ctx.host),
      ctx.token,
      DETAIL_QUERY,
      { ...split(repoPath), number }
    )
    const pull = data.repository?.pullRequest
    if (!pull) throw new Error(`Pull request #${number} not found`)
    const timeline: PullComment[] = pull.comments.nodes.map((c) => ({
      author: githubUser(c.author),
      body: c.body,
      date: toMillis(c.createdAt)
    }))
    for (const review of pull.reviews.nodes) {
      const vote = VOTES[review.state]
      // A review that only holds line comments says nothing by itself
      if (vote && (vote !== 'commented' || review.body.trim()))
        timeline.push({
          author: githubUser(review.author),
          body: review.body,
          date: toMillis(review.submittedAt ?? review.createdAt),
          vote
        })
      for (const c of review.comments.nodes)
        timeline.push({
          author: githubUser(c.author),
          body: c.body,
          date: toMillis(c.createdAt),
          path: c.path,
          line: c.line ?? c.originalLine ?? undefined
        })
    }
    timeline.sort((a, b) => a.date - b.date)
    const rollup = pull.last.nodes[0]?.commit.statusCheckRollup
    return {
      number: pull.number,
      body: pull.body,
      merge: mergeability(pull, rollup ? (ROLLUP[rollup.state] ?? 'pending') : null),
      timeline,
      commits: pull.commits.nodes.map((n) => n.commit.oid)
    }
  },

  headRef: (number) => `refs/pull/${number}/head`,

  auth: bearer,

  async info(ctx, repoPath) {
    const repo = await rest<{
      default_branch: string
      allow_merge_commit?: boolean
      allow_squash_merge?: boolean
      allow_rebase_merge?: boolean
      allow_auto_merge?: boolean
      delete_branch_on_merge?: boolean
    }>(ctx, repoPath, '')
    // The allow_* fields come only to those who can push: without them, every method is offered
    const allowed: [MergeMethod, boolean | undefined][] = [
      ['merge', repo.allow_merge_commit],
      ['squash', repo.allow_squash_merge],
      ['rebase', repo.allow_rebase_merge]
    ]
    return {
      defaultBranch: repo.default_branch,
      methods: allowed.filter(([, allow]) => allow !== false).map(([method]) => method),
      deleteBranch: repo.delete_branch_on_merge ?? false,
      autoMerge: repo.allow_auto_merge ?? false,
      labels: true,
      reopen: true
    }
  },

  async candidates(ctx, repoPath, query) {
    // Those who can be assigned can review: the people of the repository
    const people = await rest<{ login: string; avatar_url: string | null }[]>(
      ctx,
      repoPath,
      '/assignees?per_page=100'
    )
    const q = query.trim().toLowerCase()
    return people
      .filter((p) => !q || p.login.toLowerCase().includes(q))
      .slice(0, 20)
      .map((p) => ({ id: p.login, user: { login: p.login, name: null, avatarUrl: p.avatar_url } }))
  },

  async labels(ctx, repoPath) {
    const labels = await rest<{ name: string; color: string }[]>(
      ctx,
      repoPath,
      '/labels?per_page=100'
    )
    return labels.map((l) => ({ name: l.name, color: `#${l.color}` }))
  },

  async create(ctx, repoPath, pull) {
    const owner = pull.sourceRepo.split('/')[0]
    const created = await rest<{ number: number; html_url: string }>(
      ctx,
      repoPath,
      '/pulls',
      jsonBody(
        'POST',
        {},
        {
          title: pull.title,
          body: pull.body,
          // A fork's branch is named with its owner
          head: sameRepo(pull.sourceRepo, repoPath)
            ? pull.sourceBranch
            : `${owner}:${pull.sourceBranch}`,
          base: pull.targetBranch,
          draft: pull.draft
        }
      )
    )
    const steps: (() => Promise<unknown>)[] = []
    if (pull.reviewers.length)
      steps.push(() =>
        rest(
          ctx,
          repoPath,
          `/pulls/${created.number}/requested_reviewers`,
          jsonBody('POST', {}, { reviewers: pull.reviewers.map((r) => r.id) })
        )
      )
    if (pull.labels.length)
      steps.push(() =>
        rest(
          ctx,
          repoPath,
          `/issues/${created.number}/labels`,
          jsonBody('POST', {}, { labels: pull.labels })
        )
      )
    return afterCreate({ number: created.number, url: created.html_url }, steps)
  },

  async update(ctx, repoPath, pull, change) {
    const fields = {
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.body !== undefined ? { body: change.body } : {}),
      ...(change.state ? { state: change.state } : {})
    }
    if (Object.keys(fields).length)
      await rest(ctx, repoPath, `/pulls/${pull.number}`, jsonBody('PATCH', {}, fields))
    if (change.draft !== undefined) {
      const { node_id } = await rest<{ node_id: string }>(ctx, repoPath, `/pulls/${pull.number}`)
      await graphql(
        githubEndpoint(ctx.host),
        ctx.token,
        change.draft ? DRAFT_MUTATION : READY_MUTATION,
        { id: node_id }
      )
    }
    if (change.reviewers?.length)
      await rest(
        ctx,
        repoPath,
        `/pulls/${pull.number}/requested_reviewers`,
        jsonBody('POST', {}, { reviewers: change.reviewers.map((r) => r.id) })
      )
  },

  async merge(ctx, repoPath, pull, options) {
    const { title, body } = splitMessage(options.message)
    if (options.auto) {
      const { node_id } = await rest<{ node_id: string }>(ctx, repoPath, `/pulls/${pull.number}`)
      await graphql(githubEndpoint(ctx.host), ctx.token, AUTO_MERGE_MUTATION, {
        id: node_id,
        method: GRAPHQL_METHODS[options.method] ?? 'MERGE',
        headline: title || null,
        body: body || null
      })
      return 'auto'
    }
    await rest(
      ctx,
      repoPath,
      `/pulls/${pull.number}/merge`,
      jsonBody(
        'PUT',
        {},
        {
          merge_method: GRAPHQL_METHODS[options.method] ? options.method : 'merge',
          // Refused if someone pushed since: what was reviewed is what gets merged
          sha: pull.headSha,
          ...(title ? { commit_title: title } : {}),
          ...(body ? { commit_message: body } : {})
        }
      )
    )
    // Only a branch of the repository itself: a fork's belongs to its owner
    if (options.deleteBranch && sameRepo(pull.sourceRepo, repoPath)) {
      const ref = pull.sourceBranch.split('/').map(encodeURIComponent).join('/')
      await rest(ctx, repoPath, `/git/refs/heads/${ref}`, { method: 'DELETE' }).catch(
        () => undefined
      )
    }
    return 'merged'
  }
}
