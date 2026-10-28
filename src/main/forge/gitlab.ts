// GitLab.com and self-managed GitLab, through the GraphQL API: like GitHub's, one query brings the
// merge requests with their approvals, pipeline and mergeability. Changes go through the REST API.
import type {
  CheckState,
  ForgeUser,
  MergeMethod,
  Mergeability,
  PullComment,
  PullRequest,
  PullReviewer,
  ReviewDecision,
  ReviewVote
} from '../../shared/forge'
import { ForgeError, graphql, jsonBody, requestJson } from './http'
import {
  PULL_LIMIT,
  afterCreate,
  bearer,
  toMillis,
  type ForgeProvider,
  type ProviderContext
} from './provider'

export const gitlabEndpoint = (host: string): string => `https://${host}/api/graphql`

interface Person {
  /** gid://gitlab/User/123 */
  id?: string
  username: string
  name: string | null
  avatarUrl: string | null
}

const PERSON = 'id username name avatarUrl'

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
    ? {
        login: person.username,
        name: person.name,
        avatarUrl: absolute(host, person.avatarUrl),
        // The REST API takes the number of the global id
        ...(person.id ? { id: person.id.replace(/^gid:\/\/gitlab\/User\//, '') } : {})
      }
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

/** A REST request on a project, e.g. rest(ctx, 'group/app', '/merge_requests'). */
function rest<T>(
  ctx: ProviderContext,
  repoPath: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  return requestJson<T>(
    `https://${ctx.host}/api/v4/projects/${encodeURIComponent(repoPath)}${path}`,
    { ...init, headers: { ...(init?.headers as Record<string, string>), ...bearer(ctx) } }
  )
}

const DRAFT = /^\s*(\[draft\]|\(draft\)|draft:|draft\s*-|wip:)\s*/i

/** A merge request's title as a draft or not: GitLab tells drafts by the title. */
export function draftTitle(title: string, draft: boolean): string {
  const bare = title.replace(DRAFT, '')
  return draft ? `Draft: ${bare}` : bare
}

// The project's merge method; squashing is chosen per merge request
const PROJECT_METHODS: Record<string, MergeMethod> = {
  merge: 'merge',
  rebase_merge: 'rebaseMerge',
  ff: 'fastForward'
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

  headRef: (number) => `refs/merge-requests/${number}/head`,

  auth: bearer,

  async info(ctx, repoPath) {
    const project = await rest<{
      default_branch: string
      merge_method?: string
      squash_option?: 'never' | 'always' | 'default_on' | 'default_off'
      remove_source_branch_after_merge?: boolean
    }>(ctx, repoPath, '')
    const method = PROJECT_METHODS[project.merge_method ?? 'merge'] ?? 'merge'
    const methods: MergeMethod[] =
      project.squash_option === 'always'
        ? ['squash']
        : project.squash_option === 'never'
          ? [method]
          : project.squash_option === 'default_on'
            ? ['squash', method]
            : [method, 'squash']
    return {
      defaultBranch: project.default_branch,
      methods,
      deleteBranch: project.remove_source_branch_after_merge ?? true,
      autoMerge: true,
      labels: true,
      reopen: true
    }
  },

  async candidates(ctx, repoPath, query) {
    const people = await rest<
      { id: number; username: string; name: string; avatar_url: string | null }[]
    >(ctx, repoPath, `/users?per_page=20&search=${encodeURIComponent(query.trim())}`)
    return people.map((p) => ({
      id: String(p.id),
      user: { login: p.username, name: p.name, avatarUrl: p.avatar_url, id: String(p.id) }
    }))
  },

  async labels(ctx, repoPath) {
    const labels = await rest<{ name: string; color: string }[]>(
      ctx,
      repoPath,
      '/labels?per_page=100'
    )
    return labels.map((l) => ({ name: l.name, color: l.color }))
  },

  async create(ctx, repoPath, pull) {
    const fork = pull.sourceRepo.toLowerCase() !== repoPath.toLowerCase()
    // From a fork, the merge request is opened on the fork and points at the project
    const target = fork ? (await rest<{ id: number }>(ctx, repoPath, '')).id : undefined
    const created = await rest<{ iid: number; web_url: string }>(
      ctx,
      pull.sourceRepo,
      '/merge_requests',
      jsonBody(
        'POST',
        {},
        {
          source_branch: pull.sourceBranch,
          target_branch: pull.targetBranch,
          title: draftTitle(pull.title, pull.draft),
          description: pull.body,
          ...(target ? { target_project_id: target } : {}),
          ...(pull.reviewers.length
            ? { reviewer_ids: pull.reviewers.map((r) => Number(r.id)) }
            : {}),
          ...(pull.labels.length ? { labels: pull.labels.join(',') } : {})
        }
      )
    )
    return afterCreate({ number: created.iid, url: created.web_url }, [])
  },

  async update(ctx, repoPath, pull, change) {
    const reviewers = change.reviewers?.length
      ? [
          ...new Set([
            ...pull.reviewers.flatMap((r) => (r.user.id ? [Number(r.user.id)] : [])),
            ...change.reviewers.map((r) => Number(r.id))
          ])
        ]
      : undefined
    const title = change.title ?? (change.draft !== undefined ? pull.title : undefined)
    await rest(
      ctx,
      repoPath,
      `/merge_requests/${pull.number}`,
      jsonBody(
        'PUT',
        {},
        {
          ...(title !== undefined
            ? { title: draftTitle(title, change.draft ?? pull.state === 'draft') }
            : {}),
          ...(change.body !== undefined ? { description: change.body } : {}),
          ...(change.state ? { state_event: change.state === 'closed' ? 'close' : 'reopen' } : {}),
          ...(reviewers ? { reviewer_ids: reviewers } : {})
        }
      )
    )
  },

  async merge(ctx, repoPath, pull, options) {
    const squash = options.method === 'squash'
    const message = options.message.trim()
    const merged = await rest<{ state: string }>(
      ctx,
      repoPath,
      `/merge_requests/${pull.number}/merge`,
      jsonBody(
        'PUT',
        {},
        {
          squash,
          should_remove_source_branch: options.deleteBranch,
          // Refused if someone pushed since: what was reviewed is what gets merged
          sha: pull.headSha,
          ...(message
            ? { [squash ? 'squash_commit_message' : 'merge_commit_message']: message }
            : {}),
          // auto_merge since GitLab 17.11; older servers know the other name
          ...(options.auto ? { auto_merge: true, merge_when_pipeline_succeeds: true } : {})
        }
      )
    )
    if (merged.state === 'merged') return 'merged'
    return options.auto ? 'auto' : 'queued'
  }
}
