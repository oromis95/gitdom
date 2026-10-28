// Bitbucket Cloud, through its REST API 2.0. The list brings the pull requests with their
// reviewers; checks need a request per pull request, kept while nothing changes (PerPullCache).
// Bitbucket Data Center has another API and isn't supported.
import type {
  CheckState,
  ForgeUser,
  Mergeability,
  PullChecks,
  PullComment,
  PullRequest,
  PullReviewer,
  ReviewDecision
} from '../../shared/forge'
import { requestJson } from './http'
import {
  PerPullCache,
  PULL_LIMIT,
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
        avatarUrl: account.links?.avatar?.href ?? null
      }
    : GHOST

async function api(ctx: ProviderContext, path: string): Promise<unknown> {
  if (ctx.host !== 'bitbucket.org')
    throw new Error(`${ctx.host}: Bitbucket Data Center isn't supported yet`)
  return requestJson(`${API}${path}`, {
    headers: { Accept: 'application/json', ...bitbucket.auth(ctx) }
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
  }
}
