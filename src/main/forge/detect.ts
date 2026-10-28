// The service a repository is on, from the URLs of its remotes.
import type { Remote } from '../../shared/types'
import type { ForgeHost, ForgeKind, ForgeRepo } from '../../shared/forge'

export interface RemoteLocation {
  host: string
  /** Path of the repository on the host, without .git; for Azure DevOps org/project/repo */
  path: string
}

// Hosts that are another name of a known one
const ALIASES: Record<string, string> = {
  'ssh.github.com': 'github.com',
  'altssh.gitlab.com': 'gitlab.com',
  'altssh.bitbucket.org': 'bitbucket.org',
  'ssh.dev.azure.com': 'dev.azure.com',
  'vs-ssh.visualstudio.com': 'dev.azure.com'
}

const trimPath = (path: string): string =>
  path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')

/**
 * Host and repository path of a remote URL: https://, ssh:// and scp-like (git@host:path) ones.
 * Null for local paths and URLs without a repository path.
 */
export function parseRemoteUrl(url: string): RemoteLocation | null {
  const text = url.trim()
  let host: string
  let path: string
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(text)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      return null
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return null
    host = parsed.hostname
    path = decodeURIComponent(parsed.pathname)
  } else if (scp && !/^[a-z]$/i.test(scp[1])) {
    // A single letter before the colon is a Windows drive, C:\repo
    host = scp[1]
    path = scp[2]
  } else return null

  host = host.toLowerCase().replace(/^www\./, '')
  path = trimPath(path)
  // Azure DevOps over SSH: v3/org/project/repo
  if (host === 'ssh.dev.azure.com' || host === 'vs-ssh.visualstudio.com')
    path = path.replace(/^v3\//, '')
  else if (host.endsWith('.visualstudio.com')) {
    // org.visualstudio.com[/DefaultCollection]/project/_git/repo
    const org = host.slice(0, -'.visualstudio.com'.length)
    path = `${org}/${path.replace(/^DefaultCollection\//i, '').replace('/_git/', '/')}`
    host = 'dev.azure.com'
  }
  host = ALIASES[host] ?? host
  // Azure DevOps (and Azure DevOps Server, on any host): collection/project/_git/repo
  path = path.replace('/_git/', '/')
  if (!path.includes('/')) return null
  return { host, path }
}

/** The service on a host: the well-known ones, or a server listed in the preferences. */
export function forgeKind(host: string, custom: ForgeHost[]): ForgeKind | null {
  if (host === 'github.com') return 'github'
  if (host === 'gitlab.com') return 'gitlab'
  if (host === 'bitbucket.org') return 'bitbucket'
  if (host === 'dev.azure.com') return 'azure'
  return custom.find((h) => h.host === host)?.kind ?? null
}

// Bitbucket Data Center's addresses: https://host[/context]/scm/KEY/slug.git, and ssh on its port
const SERVER_HTTP = /^(?:(.+)\/)?scm\/([^/]+\/[^/]+)$/
const SERVER_SSH = /^ssh:\/\/[^/]*:7999\//i

/** A Bitbucket Data Center repository's path, without the scm of its address: [context/]KEY/slug. */
export function serverPath(path: string): string {
  const match = SERVER_HTTP.exec(path)
  if (!match) return path
  return match[1] ? `${match[1]}/${match[2]}` : match[2]
}

/**
 * The service a remote is on: a well-known host, a server listed in the preferences, or else a
 * Bitbucket Data Center told by its addresses.
 */
function locate(url: string, custom: ForgeHost[]): (RemoteLocation & { kind: ForgeKind }) | null {
  const location = parseRemoteUrl(url)
  if (!location) return null
  const looksLikeServer =
    SERVER_HTTP.test(location.path) ||
    (SERVER_SSH.test(url.trim()) && location.path.split('/').length === 2)
  const kind = forgeKind(location.host, custom) ?? (looksLikeServer ? 'bitbucketServer' : null)
  if (!kind) return null
  const path = kind === 'bitbucketServer' ? serverPath(location.path) : location.path
  return { kind, host: location.host, path }
}

function webUrl(kind: ForgeKind, location: RemoteLocation): string {
  if (kind === 'azure' || kind === 'bitbucketServer') {
    // The last two segments are the project and the repository, the rest the organization or
    // the server's collection on Azure DevOps, the server's context path on Bitbucket
    const segments = location.path.split('/').map(encodeURIComponent)
    const repo = segments.pop()
    if (kind === 'azure') return `https://${location.host}/${segments.join('/')}/_git/${repo}`
    // Project keys are upper case on the server's pages, lower case in clone addresses
    const project = segments.pop()?.toUpperCase()
    const root = [location.host, ...segments].join('/')
    return `https://${root}/projects/${project}/repos/${repo}`
  }
  return `https://${location.host}/${location.path}`
}

/**
 * The repository whose pull requests to show: upstream's when there's one (the repository is a
 * fork, and pull requests go there), otherwise origin's, otherwise the first remote on a service.
 */
export function detectForge(remotes: Remote[], custom: ForgeHost[]): ForgeRepo | null {
  const order = [
    ...remotes.filter((r) => r.name === 'upstream'),
    ...remotes.filter((r) => r.name === 'origin'),
    ...remotes.filter((r) => r.name !== 'upstream' && r.name !== 'origin')
  ]
  for (const remote of order) {
    const location = locate(remote.fetchUrl, custom)
    if (location) {
      const { kind, host, path } = location
      return { kind, host, path, remote: remote.name, webUrl: webUrl(kind, location) }
    }
  }
  return null
}

/** Remotes on the same host as `repo`, and the repository path each one is. */
export function remotesOn(remotes: Remote[], repo: ForgeRepo): Record<string, string> {
  const result: Record<string, string> = {}
  for (const remote of remotes) {
    const location = parseRemoteUrl(remote.fetchUrl)
    if (location?.host === repo.host)
      result[remote.name] =
        repo.kind === 'bitbucketServer' ? serverPath(location.path) : location.path
  }
  return result
}
