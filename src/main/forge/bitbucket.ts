// Bitbucket Cloud, through its REST API 2.0. The list brings the pull requests with their
// reviewers; checks need a request per pull request, kept while nothing changes (PerPullCache).
// Bitbucket Data Center has another API: bitbucketServer.ts.
import type {
  Candidate,
  CheckState,
  ForgeUser,
  MergeMethod,
  Mergeability,
  PullChecks,
  PullComment,
  PullRequest,
  PullReviewer,
  ReviewDecision
} from '../../shared/forge'
import { jsonBody, request, requestJson } from './http'
import {
  PerPullCache,
  PULL_LIMIT,
  afterCreate,
  basic,
  bearer,
  mapLimit,
  overall,
  toMillis,
  type ForgeProvider,
  type ProviderContext
} from './provider'

const API = 'https://api.bitbucket.org/2.0'

interface Account {
  display_name: string
  nickname?: string
  account_id?: string
  uuid?: string
  links?: { avatar?: { href?: string } }
}

interface Participant {
  user: Account
  role: 'PARTICIPANT' | 'REVIEWER'
  approved: boolean
  state: 'approved' | 'changes_requested' | null
}

interface PullNode {
  id: number
  title: string
  draft?: boolean
  author: Account | null
  created_on: string
  updated_on: string
  comment_count: number
  source: {
    branch: { name: string }
    commit: { hash: string } | null
    repository: { full_name: string } | null
  }
  destination: { branch: { name: string } }
  participants?: Participant[]
  links: { html: { href: string } }
}

interface Status {
  key: string
  name: string | null
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED'
  url: string | null
}

interface Page<T> {
  values: T[]
}

const GHOST: ForgeUser = { login: 'ghost', name: null, avatarUrl: null }

export const bitbucketUser = (account: Account | null): ForgeUser =>
  account
    ? {
        // Apps have no nickname
        login: account.nickname ?? account.display_name,
        name: account.display_name,
        avatarUrl: account.links?.avatar?.href ?? null,
        ...(account.uuid ? { id: account.uuid } : {})
      }
    : GHOST

async function api(ctx: ProviderContext, path: string, init?: RequestInit): Promise<unknown> {
  if (ctx.host !== 'bitbucket.org') throw new Error(`${ctx.host} isn't Bitbucket Cloud`)
  return requestJson(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers as Record<string, string>),
      ...bitbucket.auth(ctx)
    }
  })
}

const repoUrl = (repoPath: string): string =>
  `/repositories/${repoPath.split('/').map(encodeURIComponent).join('/')}`

const STATES: Record<Status['state'], CheckState> = {
  SUCCESSFUL: 'success',
  FAILED: 'failure',
  INPROGRESS: 'pending',
  STOPPED: 'neutral'
}

export function bitbucketChecks(statuses: Status[]): PullChecks | null {
  if (!statuses.length) return null
  const items = statuses.map((s) => ({
    name: s.name ?? s.key,
    state: STATES[s.state] ?? 'pending',
    url: s.url
  }))
  return { state: overall(items.map((i) => i.state)), items, url: null }
}

export function bitbucketPull(
  node: PullNode,
  repoPath: string,
  checks: PullChecks | null
): PullRequest {
  const reviewers: PullReviewer[] = []
  for (const p of node.participants ?? []) {
    const vote =
      p.state === 'changes_requested'
        ? 'changes'
        : p.approved || p.state === 'approved'
          ? 'approved'
          : p.role === 'REVIEWER'
            ? 'requested'
            : null
    // Someone who only commented
    if (vote) reviewers.push({ user: bitbucketUser(p.user), vote })
  }
  const review: ReviewDecision = reviewers.some((r) => r.vote === 'changes')
    ? 'changes'
    : reviewers.some((r) => r.vote === 'approved')
      ? 'approved'
      : reviewers.length
        ? 'required'
        : null
  // Bitbucket doesn't say in the list whether it can be merged: the detail looks for conflicts
  const merge: Mergeability = node.draft
    ? { state: 'draft', reason: 'Draft: not ready for review' }
    : {
        state: 'unknown',
        reason:
          review === 'changes'
            ? 'Changes requested'
            : checks?.state === 'failure'
              ? 'Some checks are failing'
              : null
      }
  return {
    number: node.id,
    title: node.title,
    url: node.links.html.href,
    state: node.draft ? 'draft' : 'open',
    author: bitbucketUser(node.author),
    sourceBranch: node.source.branch.name,
    sourceRepo: node.source.repository?.full_name ?? repoPath,
    targetBranch: node.destination.branch.name,
    // Bitbucket gives 12 characters of it
    headSha: node.source.commit?.hash ?? '',
    createdAt: toMillis(node.created_on),
    updatedAt: toMillis(node.updated_on),
    review,
    reviewers,
    checks,
    merge,
    comments: node.comment_count ?? 0,
    labels: []
  }
}

interface Comment {
  content: { raw: string }
  created_on: string
  user: Account | null
  deleted: boolean
  pending?: boolean
  inline?: { path: string; to: number | null; from: number | null } | null
}

// Bitbucket's merge strategies, as GitDom names them; two of them squash
const STRATEGIES: [string, MergeMethod][] = [
  ['merge_commit', 'merge'],
  ['squash', 'squash'],
  ['squash_fast_forward', 'squash'],
  ['fast_forward', 'fastForward'],
  ['rebase_fast_forward', 'rebase'],
  ['rebase_merge', 'rebaseMerge']
]

interface BranchStrategies {
  merge_strategies?: string[]
  default_merge_strategy?: string
}

/** The methods a target branch allows, its default first, and the strategy behind each. */
export function bitbucketMethods(branch: BranchStrategies): Map<MergeMethod, string> {
  const allowed = branch.merge_strategies ?? ['merge_commit', 'squash', 'fast_forward']
  const order = [branch.default_merge_strategy, ...STRATEGIES.map(([strategy]) => strategy)].filter(
    (s): s is string => !!s && allowed.includes(s)
  )
  const methods = new Map<MergeMethod, string>()
  for (const strategy of order) {
    const method = STRATEGIES.find(([s]) => s === strategy)?.[1]
    if (method && !methods.has(method)) methods.set(method, strategy)
  }
  return methods
}

const branchUrl = (repoPath: string, branch: string): string =>
  `${repoUrl(repoPath)}/refs/branches/${encodeURIComponent(branch)}`

// The members of each workspace, read once: Bitbucket can't search them by name
const members = new Map<string, Promise<Candidate[]>>()

async function workspaceMembers(ctx: ProviderContext, workspace: string): Promise<Candidate[]> {
  const people: Candidate[] = []
  let page: string | null = `/workspaces/${encodeURIComponent(workspace)}/members?pagelen=100`
  // Three pages at most: a big workspace is searched among its first 300
  for (let i = 0; page && i < 3; i++) {
    const answer = (await api(ctx, page)) as { values: { user: Account }[]; next?: string }
    for (const { user } of answer.values)
      if (user.uuid) people.push({ id: user.uuid, user: bitbucketUser(user) })
    page = answer.next ? answer.next.replace(API, '') : null
  }
  return people
}

const checksCache = new PerPullCache<PullChecks | null>((checks) => checks?.state !== 'pending')

export const bitbucket: ForgeProvider = {
  async viewer(ctx: ProviderContext) {
    return bitbucketUser((await api(ctx, '/user')) as Account)
  },

  async load(ctx, repoPath) {
    const [viewer, page] = await Promise.all([
      api(ctx, '/user') as Promise<Account>,
      api(
        ctx,
        `${repoUrl(repoPath)}/pullrequests?state=OPEN&pagelen=${PULL_LIMIT}&fields=%2Bvalues.participants`
      ) as Promise<Page<PullNode>>
    ])
    const pulls = await mapLimit(page.values, 6, async (node) => {
      const checks = await checksCache
        .get(`${repoPath}#${node.id}@${node.source.commit?.hash}`, async () =>
          bitbucketChecks(
            (
              (await api(
                ctx,
                `${repoUrl(repoPath)}/pullrequests/${node.id}/statuses?pagelen=50`
              )) as Page<Status>
            ).values
          )
        )
        // Checks the token can't read leave the pull request without them
        .catch(() => null)
      return bitbucketPull(node, repoPath, checks)
    })
    return { viewer: bitbucketUser(viewer), pulls }
  },

  async detail(ctx, repoPath, number) {
    const base = `${repoUrl(repoPath)}/pullrequests/${number}`
    const [pull, comments, commits, diffstat] = await Promise.all([
      api(ctx, base) as Promise<PullNode & { description?: string }>,
      api(ctx, `${base}/comments?pagelen=100`) as Promise<Page<Comment>>,
      api(ctx, `${base}/commits?pagelen=100`) as Promise<Page<{ hash: string }>>,
      (api(ctx, `${base}/diffstat?pagelen=100`) as Promise<Page<{ status: string }>>).catch(
        () => null
      )
    ])
    const timeline: PullComment[] = comments.values
      .filter((c) => !c.deleted && !c.pending)
      .map((c) => ({
        author: bitbucketUser(c.user),
        body: c.content.raw,
        date: toMillis(c.created_on),
        ...(c.inline
          ? { path: c.inline.path, line: c.inline.to ?? c.inline.from ?? undefined }
          : {})
      }))
      .sort((a, b) => a.date - b.date)
    // Files changed on both sides show as "merge conflict", "local deleted" or "remote deleted"
    const conflicts = diffstat?.values.some((f) =>
      /conflict|local deleted|remote deleted/.test(f.status)
    )
    return {
      number,
      body: pull.description ?? '',
      ...(conflicts
        ? { merge: { state: 'conflicts', reason: 'Conflicts with the target branch' } }
        : {}),
      timeline,
      // Newest first in Bitbucket's answer
      commits: commits.values.map((c) => c.hash).reverse()
    }
  },

  headRef: () => null,

  auth: (ctx) => {
    if (!ctx.username) return bearer(ctx)
    return basic(ctx.username, ctx.token)
  },

  async info(ctx, repoPath, target) {
    const repo = (await api(ctx, repoUrl(repoPath))) as { mainbranch?: { name: string } }
    const defaultBranch = repo.mainbranch?.name ?? 'main'
    const branch = (await api(ctx, branchUrl(repoPath, target ?? defaultBranch)).catch(
      () => ({})
    )) as BranchStrategies
    return {
      defaultBranch,
      methods: [...bitbucketMethods(branch).keys()],
      deleteBranch: false,
      autoMerge: false,
      labels: false,
      reopen: false
    }
  },

  async candidates(ctx, repoPath, query) {
    const workspace = repoPath.split('/')[0]
    let all = members.get(workspace)
    if (!all) {
      all = workspaceMembers(ctx, workspace)
      members.set(workspace, all)
      all.catch(() => members.delete(workspace))
    }
    const q = query.trim().toLowerCase()
    return (await all)
      .filter(
        (c) =>
          !q || c.user.login.toLowerCase().includes(q) || c.user.name?.toLowerCase().includes(q)
      )
      .slice(0, 20)
  },

  labels: async () => [],

  async create(ctx, repoPath, pull) {
    const created = (await api(
      ctx,
      `${repoUrl(repoPath)}/pullrequests`,
      jsonBody(
        'POST',
        {},
        {
          title: pull.title,
          description: pull.body,
          source: {
            branch: { name: pull.sourceBranch },
            repository: { full_name: pull.sourceRepo }
          },
          destination: { branch: { name: pull.targetBranch } },
          reviewers: pull.reviewers.map((r) => ({ uuid: r.id })),
          draft: pull.draft
        }
      )
    )) as { id: number; links: { html: { href: string } } }
    return afterCreate({ number: created.id, url: created.links.html.href }, [])
  },

  async update(ctx, repoPath, pull, change) {
    const base = `${repoUrl(repoPath)}/pullrequests/${pull.number}`
    if (change.state === 'open') throw new Error("Bitbucket can't reopen a declined pull request")
    if (change.state === 'closed') await api(ctx, `${base}/decline`, jsonBody('POST', {}, {}))
    const reviewers = change.reviewers?.length
      ? [
          ...new Set([
            ...pull.reviewers.flatMap((r) => (r.user.id ? [r.user.id] : [])),
            ...change.reviewers.map((r) => r.id)
          ])
        ].map((uuid) => ({ uuid }))
      : undefined
    if (
      change.title === undefined &&
      change.body === undefined &&
      change.draft === undefined &&
      !reviewers
    )
      return
    await api(
      ctx,
      base,
      jsonBody(
        'PUT',
        {},
        {
          // The title always goes: Bitbucket wants it in every update
          title: change.title ?? pull.title,
          ...(change.body !== undefined ? { description: change.body } : {}),
          ...(change.draft !== undefined ? { draft: change.draft } : {}),
          ...(reviewers ? { reviewers } : {})
        }
      )
    )
  },

  async merge(ctx, repoPath, pull, options) {
    if (options.auto) throw new Error("Bitbucket doesn't merge by itself")
    const branch = (await api(ctx, branchUrl(repoPath, pull.targetBranch)).catch(
      () => ({})
    )) as BranchStrategies
    const strategy = bitbucketMethods(branch).get(options.method) ?? 'merge_commit'
    const message = options.message.trim()
    const answer = await request(
      `${API}${repoUrl(repoPath)}/pullrequests/${pull.number}/merge`,
      jsonBody('POST', bitbucket.auth(ctx), {
        type: 'pullrequest',
        merge_strategy: strategy,
        close_source_branch: options.deleteBranch,
        ...(message ? { message } : {})
      })
    )
    // A merge queue, or a merge that takes a while: Bitbucket finishes it by itself
    return answer.status === 202 ? 'queued' : 'merged'
  }
}
