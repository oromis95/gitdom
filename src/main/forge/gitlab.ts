// GitLab.com and self-managed GitLab, through the GraphQL API: like GitHub's, one query brings the
// merge requests with their approvals, pipeline and mergeability.
import type {
  CheckState,
  ForgeUser,
  Mergeability,
  PullComment,
  PullRequest,
  PullReviewer,
  ReviewDecision,
  ReviewVote
} from '../../shared/forge'
import { ForgeError, graphql } from './http'
import { PULL_LIMIT, toMillis, type ForgeProvider, type ProviderContext } from './provider'

export const gitlabEndpoint = (host: string): string => `https://${host}/api/graphql`

interface Person {
  username: string
  name: string | null
  avatarUrl: string | null
}

const PERSON = 'username name avatarUrl'

export const PULLS_QUERY = `query($path: ID!, $limit: Int!) {
  currentUser { ${PERSON} }
  project(fullPath: $path) {
    webUrl
    mergeRequests(state: opened, first: $limit, sort: UPDATED_DESC) {
      nodes {
        iid title webUrl draft createdAt updatedAt
        author { ${PERSON} }
        sourceBranch targetBranch diffHeadSha
        sourceProject { fullPath }
        detailedMergeStatus conflicts userNotesCount
        approved approvalsLeft
        approvedBy { nodes { ${PERSON} } }
        reviewers { nodes { ${PERSON} mergeRequestInteraction { reviewState approved } } }
        labels { nodes { title color } }
        headPipeline { status path jobs(first: 60) { nodes { name status webPath } } }
      }
    }
  }
}`

export const DETAIL_QUERY = `query($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      iid description
      commits(first: 250) { nodes { sha } }
      notes(first: 100) {
        nodes { body system createdAt author { ${PERSON} } position { filePath newLine oldLine } }
      }
    }
  }
}`

interface MergeRequestNode {
  iid: string
  title: string
  webUrl: string
  draft: boolean
  createdAt: string
  updatedAt: string
  author: Person | null
  sourceBranch: string
  targetBranch: string
  diffHeadSha: string | null
  sourceProject: { fullPath: string } | null
  detailedMergeStatus: string | null
  conflicts: boolean
  userNotesCount: number | null
  approved: boolean
  approvalsLeft: number | null
  approvedBy: { nodes: Person[] } | null
  reviewers: {
    nodes: (Person & {
      mergeRequestInteraction: { reviewState: string; approved: boolean } | null
    })[]
  } | null
  labels: { nodes: { title: string; color: string }[] } | null
  headPipeline: {
    status: string
    path: string | null
    jobs: { nodes: { name: string; status: string; webPath: string | null }[] } | null
  } | null
}

const GHOST: ForgeUser = { login: 'ghost', name: null, avatarUrl: null }

/** Avatars of uploaded pictures come as paths on the server. */
const absolute = (host: string, url: string | null): string | null =>
  !url ? null : url.startsWith('/') ? `https://${host}${url}` : url

export const gitlabUser = (host: string, person: Person | null): ForgeUser =>
  person
    ? { login: person.username, name: person.name, avatarUrl: absolute(host, person.avatarUrl) }
    : GHOST

function pipelineState(status: string): CheckState {
  const s = status.toUpperCase()
  if (s === 'SUCCESS') return 'success'
  if (s === 'FAILED') return 'failure'
  if (s === 'CANCELED' || s === 'CANCELING' || s === 'SKIPPED' || s === 'MANUAL') return 'neutral'
  return 'pending'
}

const REVIEW_STATES: Record<string, ReviewVote> = {
  APPROVED: 'approved',
  REQUESTED_CHANGES: 'changes',
  REVIEWED: 'commented'
}

// What keeps a merge request from being merged, in GitLab's words
const BLOCKERS: Record<string, string> = {
  NOT_APPROVED: 'Approval required',
  REQUESTED_CHANGES: 'Changes requested',
  DISCUSSIONS_NOT_RESOLVED: 'Open threads must be resolved',
  CI_MUST_PASS: 'The pipeline must succeed',
  CI_STILL_RUNNING: 'Waiting for the pipeline',
  BLOCKED_STATUS: 'Blocked by another merge request',
  EXTERNAL_STATUS_CHECKS: 'External status checks must pass',
  JIRA_ASSOCIATION_MISSING: 'The title or description must mention a Jira issue',
  TITLE_NOT_MATCHING: "The title doesn't match the project's rules",
  SECURITY_POLICIES_VIOLATIONS: 'Security policies are violated',
  LOCKED_PATHS: 'It changes locked files',
  LOCKED_LFS_FILES: 'It changes locked LFS files',
  COMMITS_STATUS: 'The source branch is missing or empty',
  MERGE_TIME: 'It can only be merged at a later time',
  NOT_OPEN: 'Not open'
}

function mergeability(node: MergeRequestNode): Mergeability {
  const status = node.detailedMergeStatus ?? ''
  if (node.draft || status === 'DRAFT_STATUS')
    return { state: 'draft', reason: 'Draft: not ready to merge' }
  if (node.conflicts || status === 'CONFLICT')
    return { state: 'conflicts', reason: 'Conflicts with the target branch' }
  if (status === 'MERGEABLE') return { state: 'clean', reason: null }
  if (status === 'NEED_REBASE')
    return { state: 'behind', reason: 'It must be rebased onto the target branch' }
  if (BLOCKERS[status]) return { state: 'blocked', reason: BLOCKERS[status] }
  return { state: 'unknown', reason: null }
}

export function gitlabPull(host: string, node: MergeRequestNode, repoPath: string): PullRequest {
  const reviewers: PullReviewer[] = (node.reviewers?.nodes ?? []).map((r) => ({
    user: gitlabUser(host, r),
    vote: r.mergeRequestInteraction?.approved
      ? 'approved'
      : (REVIEW_STATES[r.mergeRequestInteraction?.reviewState ?? ''] ?? 'requested')
  }))
  // Approvals by people who weren't asked count too
  for (const person of node.approvedBy?.nodes ?? []) {
    const known = reviewers.find((r) => r.user.login === person.username)
    if (known) known.vote = 'approved'
    else reviewers.push({ user: gitlabUser(host, person), vote: 'approved' })
  }
  const review: ReviewDecision = reviewers.some((r) => r.vote === 'changes')
    ? 'changes'
    : node.approved &&
        (node.approvalsLeft ?? 0) === 0 &&
        reviewers.some((r) => r.vote === 'approved')
      ? 'approved'
      : (node.approvalsLeft ?? 0) > 0
        ? 'required'
        : null

  const pipeline = node.headPipeline
  const url = (path: string | null): string | null => (path ? `https://${host}${path}` : null)
  return {
    number: Number(node.iid),
    title: node.title,
    url: node.webUrl,
    state: node.draft ? 'draft' : 'open',
    author: gitlabUser(host, node.author),
    sourceBranch: node.sourceBranch,
    sourceRepo: node.sourceProject?.fullPath ?? repoPath,
    targetBranch: node.targetBranch,
    headSha: node.diffHeadSha ?? '',
    createdAt: toMillis(node.createdAt),
    updatedAt: toMillis(node.updatedAt),
    review,
    reviewers,
    checks: pipeline
      ? {
          state: pipelineState(pipeline.status),
          items: (pipeline.jobs?.nodes ?? []).map((j) => ({
            name: j.name,
            state: pipelineState(j.status),
            url: url(j.webPath)
          })),
          url: url(pipeline.path)
        }
      : null,
    merge: mergeability(node),
    comments: node.userNotesCount ?? 0,
    labels: (node.labels?.nodes ?? []).map((l) => ({ name: l.title, color: l.color }))
  }
}

interface DetailNode {
  iid: string
  description: string | null
  commits: { nodes: { sha: string }[] } | null
  notes: {
    nodes: {
      body: string
      system: boolean
      createdAt: string
      author: Person | null
      position: { filePath: string; newLine: number | null; oldLine: number | null } | null
    }[]
  }
}

export const gitlab: ForgeProvider = {
  async viewer(ctx: ProviderContext) {
    const data = await graphql<{ currentUser: Person | null }>(
      gitlabEndpoint(ctx.host),
      ctx.token,
      `query { currentUser { ${PERSON} } }`,
      {}
    )
    // GitLab answers anonymous queries too: a refused token shows as no user
    if (!data.currentUser) throw new ForgeError(`${ctx.host} refused the token`, 401, true)
    return gitlabUser(ctx.host, data.currentUser)
  },

  async load(ctx, repoPath) {
    const data = await graphql<{
      currentUser: Person | null
      project: { mergeRequests: { nodes: MergeRequestNode[] } } | null
    }>(gitlabEndpoint(ctx.host), ctx.token, PULLS_QUERY, { path: repoPath, limit: PULL_LIMIT })
    if (!data.currentUser) throw new ForgeError(`${ctx.host} refused the token`, 401, true)
    if (!data.project)
      throw new Error(`${repoPath} isn't on ${ctx.host}, or the account can't see it`)
    return {
      viewer: gitlabUser(ctx.host, data.currentUser),
      pulls: data.project.mergeRequests.nodes.map((n) => gitlabPull(ctx.host, n, repoPath))
    }
  },

  async detail(ctx, repoPath, number) {
    const data = await graphql<{ project: { mergeRequest: DetailNode | null } | null }>(
      gitlabEndpoint(ctx.host),
      ctx.token,
      DETAIL_QUERY,
      { path: repoPath, iid: String(number) }
    )
    const mr = data.project?.mergeRequest
    if (!mr) throw new Error(`Merge request !${number} not found`)
    const timeline: PullComment[] = mr.notes.nodes
      .filter((n) => !n.system)
      .map((n) => ({
        author: gitlabUser(ctx.host, n.author),
        body: n.body,
        date: toMillis(n.createdAt),
        ...(n.position
          ? {
              path: n.position.filePath,
              line: n.position.newLine ?? n.position.oldLine ?? undefined
            }
          : {})
      }))
      .sort((a, b) => a.date - b.date)
    return {
      number: Number(mr.iid),
      body: mr.description ?? '',
      timeline,
      // Newest first in GitLab's answer
      commits: (mr.commits?.nodes ?? []).map((c) => c.sha).reverse()
    }
  },

  headRef: (number) => `refs/merge-requests/${number}/head`
}
