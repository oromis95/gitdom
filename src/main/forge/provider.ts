// What every service's module offers, in the shapes of shared/forge.ts.
import type {
  Candidate,
  CheckState,
  CreatedPull,
  ForgeRepoInfo,
  ForgeUser,
  MergeOptions,
  MergeOutcome,
  NewPull,
  PullChange,
  PullDetail,
  PullLabel,
  PullRequest
} from '../../shared/forge'

export interface ProviderContext {
  host: string
  token: string
  /** Sent with the token as a username and password, where the service wants that (Bitbucket) */
  username?: string
}

export interface ForgeProvider {
  /**
   * The account the token belongs to; a ForgeError with `auth` when it's refused. `repoPath` is a
   * repository on the host, for services whose accounts are per organization (Azure DevOps).
   */
  viewer(ctx: ProviderContext, repoPath: string): Promise<ForgeUser>
  /** The open pull requests of a repository, most recently updated first, and the viewer. */
  load(ctx: ProviderContext, repoPath: string): Promise<{ viewer: ForgeUser; pulls: PullRequest[] }>
  detail(ctx: ProviderContext, repoPath: string, number: number): Promise<PullDetail>
  /**
   * The ref to fetch for a pull request's commits from the repository it targets, null when the
   * service has none and the source branch is fetched instead.
   */
  headRef(number: number): string | null
  /** Headers authenticating a request with the account's token. */
  auth(ctx: ProviderContext): Record<string, string>
  /**
   * What the repository allows; `target` is the branch a pull request goes into, for services
   * whose merge methods depend on it (Bitbucket).
   */
  info(ctx: ProviderContext, repoPath: string, target?: string): Promise<ForgeRepoInfo>
  /** People who can be asked to review, matching what was typed. */
  candidates(ctx: ProviderContext, repoPath: string, query: string): Promise<Candidate[]>
  /** The repository's labels, empty where the service has none to pick from. */
  labels(ctx: ProviderContext, repoPath: string): Promise<PullLabel[]>
  /** Opens a pull request from a branch already on the service, in `sourceRepo` (a fork too). */
  create(ctx: ProviderContext, repoPath: string, pull: CreatePull): Promise<Created>
  update(
    ctx: ProviderContext,
    repoPath: string,
    pull: PullRequest,
    change: PullChange
  ): Promise<void>
  merge(
    ctx: ProviderContext,
    repoPath: string,
    pull: PullRequest,
    options: MergeOptions
  ): Promise<MergeOutcome>
}

/** A new pull request, with where its branch is on the service. */
export interface CreatePull extends Omit<NewPull, 'branch'> {
  sourceRepo: string
  sourceBranch: string
}

export type Created = CreatedPull

/** Runs the steps after a pull request was created; what fails becomes the warning. */
export async function afterCreate(
  created: Omit<Created, 'warning'>,
  steps: (() => Promise<unknown>)[]
): Promise<Created> {
  const failures: string[] = []
  for (const step of steps) {
    try {
      await step()
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e))
    }
  }
  return failures.length ? { ...created, warning: failures.join('; ') } : created
}

/** A commit message as its first line and the rest. */
export function splitMessage(message: string): { title: string; body: string } {
  const [title, ...rest] = message.trim().split('\n')
  return { title: title?.trim() ?? '', body: rest.join('\n').trim() }
}

export const bearer = (ctx: ProviderContext): Record<string, string> => ({
  Authorization: `Bearer ${ctx.token}`
})

export const basic = (username: string, password: string): Record<string, string> => ({
  Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
})

/** Runs `work` on every item, at most `limit` at a time, keeping the order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}

/**
 * What a service needs a request per pull request for (its checks): kept while the pull request's
 * last commit is the same and `settled` says nothing will change by itself, asked again otherwise.
 */
export class PerPullCache<T> {
  private entries = new Map<string, T>()

  constructor(private readonly settled: (value: T) => boolean) {}

  async get(key: string, read: () => Promise<T>): Promise<T> {
    if (this.entries.has(key)) {
      const known = this.entries.get(key)!
      if (this.settled(known)) return known
    }
    const value = await read()
    // Pull requests come and go: forget the oldest after a while
    if (this.entries.size > 500) this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(key, value)
    return value
  }
}

/** Open pull requests read at a time: more are rare, and the service is asked every minute */
export const PULL_LIMIT = 30

export const toMillis = (date: string | null | undefined): number =>
  date ? Date.parse(date) || 0 : 0

/** The summary of several checks: failed if any failed, running if any runs, passed otherwise. */
export function overall(states: CheckState[]): CheckState {
  if (states.includes('failure')) return 'failure'
  if (states.includes('pending')) return 'pending'
  if (states.includes('success')) return 'success'
  return 'neutral'
}
