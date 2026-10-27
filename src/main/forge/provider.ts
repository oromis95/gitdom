// What every service's module offers, in the shapes of shared/forge.ts.
import type { ForgeUser, PullDetail, PullRequest } from '../../shared/forge'

export interface ProviderContext {
  host: string
  token: string
}

export interface ForgeProvider {
  /** The account the token belongs to; a ForgeError with `auth` when it's refused. */
  viewer(ctx: ProviderContext): Promise<ForgeUser>
  /** The open pull requests of a repository, most recently updated first, and the viewer. */
  load(ctx: ProviderContext, repoPath: string): Promise<{ viewer: ForgeUser; pulls: PullRequest[] }>
  detail(ctx: ProviderContext, repoPath: string, number: number): Promise<PullDetail>
  /**
   * The ref to fetch for a pull request's commits from the repository it targets, null when the
   * service has none and the source branch is fetched instead.
   */
  headRef(number: number): string | null
}

/** Open pull requests read at a time: more are rare, and the service is asked every minute */
export const PULL_LIMIT = 30

export const toMillis = (date: string | null | undefined): number =>
  date ? Date.parse(date) || 0 : 0
