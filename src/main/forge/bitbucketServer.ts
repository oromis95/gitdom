// Bitbucket Data Center (once Bitbucket Server), through its REST API 1.0. The list brings the pull
// requests with their reviewers and whether they conflict; checks are the build statuses of their
// last commit, read per pull request and kept while nothing changes (PerPullCache). Changes carry
// the pull request's version, read again first: Bitbucket refuses them when it's out of date.
import {
  sameRepoPath,
  type CheckState,
  type ForgeUser,
  type MergeMethod,
  type Mergeability,
  type PullChecks,
  type PullComment,
  type PullRequest,
  type PullReviewer,
  type ReviewDecision,
  type ReviewVote
} from '../../shared/forge'
import { ForgeError, jsonBody, request, requestJson, send } from './http'
import {
  PULL_LIMIT,
  PerPullCache,
  afterCreate,
  basic,
  bearer,
  mapLimit,
  overall,
  type CreatePull,
  type ForgeProvider,
  type ProviderContext
} from './provider'

/**
 * The parts of a repository path: the server's context path when it has one, the project's key
 * (~USER for a personal one) and the repository's slug. Keys are upper case, as Bitbucket keeps
 * them: clone addresses write them in lower case.
 */
export function serverParts(repoPath: string): { context: string[]; key: string; slug: string } {
  const segments = repoPath.split('/')
  return {
    context: segments.slice(0, -2),
    key: segments.at(-2)!.toUpperCase(),
    slug: segments.at(-1)!
  }
}

function urls(
  host: string,
  repoPath: string
): {
  root: string
  api: string
  repo: string
  web: string
  defaultReviewers: string
  branches: string
  builds: string
} {
  const { context, key, slug } = serverParts(repoPath)
  const root = `https://${[host, ...context.map(encodeURIComponent)].join('/')}`
  const repo = `projects/${encodeURIComponent(key)}/repos/${encodeURIComponent(slug)}`
  return {
    root,
    api: `${root}/rest/api/1.0`,
    repo: `${root}/rest/api/1.0/${repo}`,
    web: `${root}/${repo}`,
    defaultReviewers: `${root}/rest/default-reviewers/1.0/${repo}/reviewers`,
    branches: `${root}/rest/branch-utils/1.0/${repo}/branches`,
    builds: `${root}/rest/build-status/1.0/commits`
  }
}

interface User {
  name: string
  displayName?: string
  avatarUrl?: string
  active?: boolean
}

interface Participant {
  user: User
  role: 'AUTHOR' | 'REVIEWER' | 'PARTICIPANT'
  approved: boolean
  status: 'UNAPPROVED' | 'NEEDS_WORK' | 'APPROVED'
}

interface Ref {
  id: string
  displayId?: string
  latestCommit?: string
  repository: {
    slug: string
    project: { key: string }
    links?: { clone?: { href: string; name: string }[] }
  }
}

interface PullNode {
  id: number
  version: number
  title: string
  description?: string
  draft?: boolean
  state: 'OPEN' | 'MERGED' | 'DECLINED'
  createdDate: number
  updatedDate?: number
  fromRef: Ref
  toRef: Ref
  author?: Participant
  reviewers?: Participant[]
  participants?: Participant[]
  properties?: {
    mergeResult?: { outcome?: 'CLEAN' | 'CONFLICTED' | 'UNKNOWN' }
    commentCount?: number
  }
  links?: { self?: { href: string }[] }
}

interface Build {
  key: string
  name?: string
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'CANCELLED' | 'UNKNOWN'
  url?: string
}

interface Page<T> {
  values: T[]
}

const GHOST: ForgeUser = { login: 'ghost', name: null, avatarUrl: null }

/** A person; the server gives pictures from its own root, made absolute here. */
export function serverUser(root: string, user: User | null | undefined): ForgeUser {
  if (!user) return GHOST
  const avatar = user.avatarUrl
  return {
    login: user.name,
    name: user.displayName ?? null,
    avatarUrl: !avatar
      ? null
      : /^https?:\/\//i.test(avatar)
        ? avatar
        : avatar.startsWith('/')
          ? `${new URL(root).origin}${avatar}`
          : `${root}/${avatar}`
  }
}

const branch = (ref: Ref): string =>
  ref.id.startsWith('refs/heads/') ? ref.id.slice('refs/heads/'.length) : (ref.displayId ?? ref.id)

const VOTES: Record<Participant['status'], ReviewVote> = {
  APPROVED: 'approved',
  NEEDS_WORK: 'changes',
  UNAPPROVED: 'requested'
}

const STATES: Record<Build['state'], CheckState> = {
  SUCCESSFUL: 'success',
  FAILED: 'failure',
  INPROGRESS: 'pending',
  CANCELLED: 'neutral',
  UNKNOWN: 'neutral'
}

export function bitbucketServerChecks(builds: Build[]): PullChecks | null {
  // Newest first: a build posted again under its key counts once
  const latest = new Map<string, Build>()
  for (const b of builds) if (!latest.has(b.key)) latest.set(b.key, b)
  if (!latest.size) return null
  const items = [...latest.values()].map((b) => ({
    name: b.name || b.key,
    state: STATES[b.state] ?? 'pending',
    url: b.url ?? null
  }))
  return { state: overall(items.map((i) => i.state)), items, url: null }
}

export function bitbucketServerPull(
  node: PullNode,
  host: string,
  repoPath: string,
  checks: PullChecks | null
): PullRequest {
  const at = urls(host, repoPath)
  const reviewers: PullReviewer[] = (node.reviewers ?? []).map((r) => ({
    user: serverUser(at.root, r.user),
    vote: VOTES[r.status] ?? 'requested'
  }))
  // Anyone can approve or ask for changes, not only the reviewers asked
  for (const p of node.participants ?? [])
    if (p.status === 'APPROVED' || p.status === 'NEEDS_WORK')
      reviewers.push({ user: serverUser(at.root, p.user), vote: VOTES[p.status] })
  const review: ReviewDecision = reviewers.some((r) => r.vote === 'changes')
    ? 'changes'
    : reviewers.some((r) => r.vote === 'approved')
      ? 'approved'
      : reviewers.length
        ? 'required'
        : null
  // The merge checks that may veto it are read with the detail
  const merge: Mergeability = node.draft
    ? { state: 'draft', reason: 'Draft: not ready for review' }
    : node.properties?.mergeResult?.outcome === 'CONFLICTED'
      ? { state: 'conflicts', reason: 'Conflicts with the target branch' }
      : {
          state: 'unknown',
          reason:
            review === 'changes'
              ? 'Changes requested'
              : checks?.state === 'failure'
                ? 'Some checks are failing'
                : null
        }
  const source = node.fromRef.repository
  const sourceRepo = [...serverParts(repoPath).context, source.project.key, source.slug].join('/')
  const fork = !sameRepoPath(sourceRepo, repoPath)
  const clone = source.links?.clone?.find((c) => c.name === 'http')?.href
  return {
    number: node.id,
    title: node.title,
    url: node.links?.self?.[0]?.href ?? `${at.web}/pull-requests/${node.id}`,
    state: node.draft ? 'draft' : 'open',
    author: serverUser(at.root, node.author?.user),
    sourceBranch: branch(node.fromRef),
    sourceRepo: fork ? sourceRepo : repoPath,
    ...(fork && clone ? { sourceUrl: clone } : {}),
    targetBranch: branch(node.toRef),
    headSha: node.fromRef.latestCommit ?? '',
    createdAt: node.createdDate ?? 0,
    updatedAt: node.updatedDate ?? node.createdDate ?? 0,
    review,
    reviewers,
    checks,
    merge,
    comments: node.properties?.commentCount ?? 0,
    labels: []
  }
}

interface Mergeable {
  canMerge?: boolean
  conflicted?: boolean
  outcome?: 'CLEAN' | 'CONFLICTED' | 'UNKNOWN'
  vetoes?: { summaryMessage?: string; detailedMessage?: string }[]
}

/** Whether it can be merged, with the merge checks that veto it, as `…/merge` says. */
export function bitbucketServerMergeability(answer: Mergeable): Mergeability | undefined {
  if (answer.conflicted || answer.outcome === 'CONFLICTED')
    return { state: 'conflicts', reason: 'Conflicts with the target branch' }
  const vetoes = (answer.vetoes ?? [])
    .map((v) => v.summaryMessage || v.detailedMessage)
    .filter((v): v is string => !!v)
  if (vetoes.length) return { state: 'blocked', reason: vetoes.join('; ') }
  if (answer.canMerge || answer.outcome === 'CLEAN') return { state: 'clean', reason: null }
  return undefined
}

interface Comment {
  id: number
  text: string
  author?: User
  createdDate: number
  pending?: boolean
  comments?: Comment[]
}

interface Activity {
  action: string
  commentAction?: 'ADDED' | 'EDITED' | 'DELETED'
  comment?: Comment
  commentAnchor?: { path?: string; line?: number }
}

/** The comments among a pull request's activities, with their replies, oldest first. */
export function bitbucketServerTimeline(root: string, activities: Activity[]): PullComment[] {
  const seen = new Set<number>()
  const timeline: PullComment[] = []
  const add = (comment: Comment, anchor: Activity['commentAnchor']): void => {
    // A reply may come both in its thread and as an activity of its own
    if (seen.has(comment.id) || comment.pending) return
    seen.add(comment.id)
    timeline.push({
      author: serverUser(root, comment.author),
      body: comment.text,
      date: comment.createdDate,
      ...(anchor?.path ? { path: anchor.path, line: anchor.line } : {})
    })
    for (const reply of comment.comments ?? []) add(reply, anchor)
  }
  for (const a of activities)
    if (a.action === 'COMMENTED' && a.comment && a.commentAction !== 'DELETED')
      add(a.comment, a.commentAnchor)
  return timeline.sort((a, b) => a.date - b.date)
}

// Bitbucket Data Center's merge strategies, as GitDom names them
const STRATEGIES: [string, MergeMethod][] = [
  ['no-ff', 'merge'],
  ['squash', 'squash'],
  ['squash-ff-only', 'squash'],
  ['ff-only', 'fastForward'],
  ['rebase-ff-only', 'rebase'],
  ['rebase-no-ff', 'rebaseMerge'],
  // Fast-forward when it can, a merge commit otherwise
  ['ff', 'merge']
]

interface MergeConfig {
  defaultStrategy?: { id: string }
  strategies?: { id: string; enabled?: boolean }[]
}

/** The methods the repository allows, its default first, and the strategy behind each. */
export function bitbucketServerMethods(config: MergeConfig | undefined): Map<MergeMethod, string> {
  const enabled = config?.strategies
    ? config.strategies.filter((s) => s.enabled !== false).map((s) => s.id)
    : [config?.defaultStrategy?.id ?? 'no-ff']
  const order = [config?.defaultStrategy?.id, ...STRATEGIES.map(([strategy]) => strategy)].filter(
    (s): s is string => !!s && enabled.includes(s)
  )
  const methods = new Map<MergeMethod, string>()
  for (const strategy of order) {
    const method = STRATEGIES.find(([s]) => s === strategy)?.[1]
    if (method && !methods.has(method)) methods.set(method, strategy)
  }
  return methods
}

const auth = (ctx: ProviderContext): Record<string, string> =>
  // Git Credential Manager's username and password (or token); an HTTP access token alone
  ctx.username ? basic(ctx.username, ctx.token) : bearer(ctx)

function get<T>(ctx: ProviderContext, url: string): Promise<T> {
  return requestJson<T>(url, { headers: { Accept: 'application/json', ...auth(ctx) } })
}

/** A change, with its JSON body; Bitbucket's XSRF check lets requests that say so through. */
function change<T>(
  ctx: ProviderContext,
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  body: unknown
): Promise<T> {
  return requestJson<T>(
    url,
    jsonBody(method, { ...auth(ctx), 'X-Atlassian-Token': 'no-check' }, body)
  )
}

/** A branch of a repository, as a new pull request names its two ends */
function refOf(branch: string, repoPath: string): object {
  const { key, slug } = serverParts(repoPath)
  return { id: `refs/heads/${branch}`, repository: { slug, project: { key } } }
}

/** The username a request was made as, which Bitbucket says in every answer to a login. */
function answeredAs(headers: Headers): string | null {
  const name = headers.get('x-ausername')
  if (!name) return null
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** The username of the account; a ForgeError with `auth` when the server refuses it. */
async function username(ctx: ProviderContext, repoPath: string): Promise<string> {
  const at = urls(ctx.host, repoPath)
  // Only for someone logged in: a refused token is told here
  const { headers } = await request(`${at.api}/users?limit=1`, {
    headers: { Accept: 'application/json', ...auth(ctx) }
  })
  const name = answeredAs(headers)
  if (name) return name
  const response = await send(`${at.root}/plugins/servlet/applinks/whoami`, { headers: auth(ctx) })
  const text = response.ok ? (await response.text()).trim() : ''
  // The account was let in above: the server just doesn't say its name
  if (!text || text.includes('<')) throw new ForgeError(`${ctx.host} didn't say who you are`, 0)
  return text
}

// The people the accounts are, read once: the list is read every minute
const people = new Map<string, Promise<ForgeUser>>()

function person(ctx: ProviderContext, repoPath: string, name: string): Promise<ForgeUser> {
  const key = `${ctx.host}\n${name}`
  let found = people.get(key)
  if (!found) {
    const at = urls(ctx.host, repoPath)
    found = get<Page<User>>(
      ctx,
      `${at.api}/users?filter=${encodeURIComponent(name)}&avatarSize=64&limit=25`
    ).then((page) => {
      const user = page.values.find((u) => u.name.toLowerCase() === name.toLowerCase())
      return user ? serverUser(at.root, user) : { login: name, name: null, avatarUrl: null }
    })
    people.set(key, found)
    found.catch(() => people.delete(key))
  }
  return found
}

/**
 * The repository's default reviewers for a new pull request, as Bitbucket's page proposes them.
 * Depending on the version, the answer is the people, or the conditions they come from.
 */
async function defaultReviewers(
  ctx: ProviderContext,
  repoPath: string,
  pull: CreatePull
): Promise<string[]> {
  const at = urls(ctx.host, repoPath)
  const [target, source] = await Promise.all([
    get<{ id: number }>(ctx, at.repo),
    sameRepoPath(pull.sourceRepo, repoPath)
      ? null
      : get<{ id: number }>(ctx, urls(ctx.host, pull.sourceRepo).repo)
  ])
  const params = new URLSearchParams({
    sourceRepoId: String((source ?? target).id),
    targetRepoId: String(target.id),
    sourceRefId: `refs/heads/${pull.sourceBranch}`,
    targetRefId: `refs/heads/${pull.targetBranch}`
  })
  const answer = await get<{ name?: string; reviewers?: User[] }[]>(
    ctx,
    `${at.defaultReviewers}?${params}`
  )
  return answer.flatMap((item) =>
    item.reviewers ? item.reviewers.map((u) => u.name) : item.name ? [item.name] : []
  )
}

const checksCache = new PerPullCache<PullChecks | null>((checks) => checks?.state !== 'pending')

export const bitbucketServer: ForgeProvider = {
  async viewer(ctx, repoPath) {
    return person(ctx, repoPath, await username(ctx, repoPath))
  },

  async load(ctx, repoPath) {
    const at = urls(ctx.host, repoPath)
    const answer = await request(
      `${at.repo}/pull-requests?state=OPEN&limit=${PULL_LIMIT}&avatarSize=64`,
      { headers: { Accept: 'application/json', ...auth(ctx) } }
    )
    const name = answeredAs(answer.headers) ?? (await username(ctx, repoPath))
    const viewer = await person(ctx, repoPath, name)
    const nodes = (answer.body as Page<PullNode>).values
    const pulls = await mapLimit(nodes, 6, async (node) => {
      const sha = node.fromRef.latestCommit
      const checks = sha
        ? await checksCache
            .get(`${ctx.host}/${repoPath}#${node.id}@${sha}`, async () =>
              bitbucketServerChecks(
                (
                  await get<Page<Build>>(
                    ctx,
                    `${at.builds}/${encodeURIComponent(sha)}?orderBy=NEWEST&limit=50`
                  )
                ).values
              )
            )
            // Checks the account can't read leave the pull request without them
            .catch(() => null)
        : null
      return bitbucketServerPull(node, ctx.host, repoPath, checks)
    })
    return { viewer, pulls: pulls.sort((a, b) => b.updatedAt - a.updatedAt) }
  },

  async detail(ctx, repoPath, number) {
    const at = urls(ctx.host, repoPath)
    const base = `${at.repo}/pull-requests/${number}`
    const [pull, activities, commits, mergeable] = await Promise.all([
      get<PullNode>(ctx, base),
      get<Page<Activity>>(ctx, `${base}/activities?limit=100&avatarSize=64`),
      get<Page<{ id: string }>>(ctx, `${base}/commits?limit=250`),
      get<Mergeable>(ctx, `${base}/merge`).catch(() => null)
    ])
    const merge = mergeable && !pull.draft ? bitbucketServerMergeability(mergeable) : undefined
    return {
      number,
      body: pull.description ?? '',
      ...(merge ? { merge } : {}),
      timeline: bitbucketServerTimeline(at.root, activities.values),
      // Newest first in Bitbucket's answer
      commits: commits.values.map((c) => c.id).reverse()
    }
  },

  headRef: () => null,

  auth,

  async info(ctx, repoPath) {
    const at = urls(ctx.host, repoPath)
    const [branch, settings, autoMerge] = await Promise.all([
      // default-branch since 7.5, branches/default before
      get<{ displayId?: string }>(ctx, `${at.repo}/default-branch`)
        .catch(() => get<{ displayId?: string }>(ctx, `${at.repo}/branches/default`))
        .catch(() => ({ displayId: undefined })),
      get<{ mergeConfig?: MergeConfig }>(ctx, `${at.repo}/settings/pull-requests`),
      // Since 8.15
      get<{ enabled?: boolean }>(ctx, `${at.repo}/settings/auto-merge`).catch(() => ({
        enabled: false
      }))
    ])
    return {
      defaultBranch: branch.displayId ?? 'main',
      methods: [...bitbucketServerMethods(settings.mergeConfig).keys()],
      deleteBranch: false,
      autoMerge: autoMerge.enabled === true,
      labels: false,
      reopen: true
    }
  },

  async candidates(ctx, repoPath, query) {
    const at = urls(ctx.host, repoPath)
    const { key, slug } = serverParts(repoPath)
    // The people who can read the repository
    const params = new URLSearchParams({
      'permission.1': 'REPO_READ',
      'permission.1.projectKey': key,
      'permission.1.repositorySlug': slug,
      avatarSize: '64',
      limit: '20'
    })
    if (query.trim()) params.set('filter', query.trim())
    const page = await get<Page<User>>(ctx, `${at.api}/users?${params}`)
    return page.values
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u.name, user: serverUser(at.root, u) }))
  },

  labels: async () => [],

  async create(ctx, repoPath, pull) {
    const at = urls(ctx.host, repoPath)
    // Bitbucket refuses the author as a reviewer
    const [defaults, me] = await Promise.all([
      defaultReviewers(ctx, repoPath, pull).catch(() => []),
      username(ctx, repoPath).catch(() => null)
    ])
    const names = [...new Set([...pull.reviewers.map((r) => r.id), ...defaults])].filter(
      (name) => name.toLowerCase() !== me?.toLowerCase()
    )
    const created = await change<PullNode>(ctx, 'POST', `${at.repo}/pull-requests`, {
      title: pull.title,
      description: pull.body,
      fromRef: refOf(pull.sourceBranch, pull.sourceRepo),
      toRef: refOf(pull.targetBranch, repoPath),
      reviewers: names.map((name) => ({ user: { name } })),
      ...(pull.draft ? { draft: true } : {})
    })
    return afterCreate(
      {
        number: created.id,
        url: created.links?.self?.[0]?.href ?? `${at.web}/pull-requests/${created.id}`
      },
      []
    )
  },

  async update(ctx, repoPath, pull, edit) {
    const base = `${urls(ctx.host, repoPath).repo}/pull-requests/${pull.number}`
    const current = (): Promise<PullNode> => get<PullNode>(ctx, base)
    if (edit.state) {
      const { version } = await current()
      const action = edit.state === 'closed' ? 'decline' : 'reopen'
      await change(ctx, 'POST', `${base}/${action}?version=${version}`, { version })
    }
    if (edit.title !== undefined || edit.body !== undefined || edit.draft !== undefined) {
      const node = await current()
      await change(ctx, 'PUT', base, {
        version: node.version,
        title: edit.title ?? node.title,
        description: edit.body ?? node.description ?? '',
        // Left out, the reviewers would be removed
        reviewers: (node.reviewers ?? []).map((r) => ({ user: { name: r.user.name } })),
        ...(edit.draft !== undefined ? { draft: edit.draft } : {})
      })
    }
    for (const reviewer of edit.reviewers ?? [])
      await change(ctx, 'POST', `${base}/participants`, {
        user: { name: reviewer.id },
        role: 'REVIEWER'
      })
  },

  async merge(ctx, repoPath, pull, options) {
    const at = urls(ctx.host, repoPath)
    const base = `${at.repo}/pull-requests/${pull.number}`
    const [node, settings] = await Promise.all([
      get<PullNode>(ctx, base),
      get<{ mergeConfig?: MergeConfig }>(ctx, `${at.repo}/settings/pull-requests`).catch(() => ({
        mergeConfig: undefined
      }))
    ])
    // What was reviewed is what gets merged
    if (pull.headSha && node.fromRef.latestCommit && node.fromRef.latestCommit !== pull.headSha)
      throw new Error(`${pull.sourceBranch} has new commits: refresh and read them, then merge`)
    // Without the settings, Bitbucket uses the repository's default strategy
    const strategyId =
      settings.mergeConfig && bitbucketServerMethods(settings.mergeConfig).get(options.method)
    const message = options.message.trim()
    const merged = await change<PullNode>(ctx, 'POST', `${base}/merge?version=${node.version}`, {
      version: node.version,
      ...(strategyId ? { strategyId } : {}),
      ...(message ? { message } : {}),
      ...(options.auto ? { autoMerge: true } : {})
    })
    // Set to merge by itself once the merge checks pass
    if (merged.state !== 'MERGED') return options.auto ? 'auto' : 'queued'
    // Only a branch of the repository itself, and only if nobody pushed to it meanwhile
    if (options.deleteBranch && sameRepoPath(pull.sourceRepo, repoPath))
      await change(ctx, 'DELETE', at.branches, {
        name: `refs/heads/${pull.sourceBranch}`,
        endPoint: node.fromRef.latestCommit
      }).catch(() => undefined)
    return 'merged'
  }
}
