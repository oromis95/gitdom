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
  else if (host === 'dev.azure.com') path = path.replace('/_git/', '/')
  else if (host.endsWith('.visualstudio.com')) {
    // org.visualstudio.com[/DefaultCollection]/project/_git/repo
    const org = host.slice(0, -'.visualstudio.com'.length)
    path = `${org}/${path.replace(/^DefaultCollection\//i, '').replace('/_git/', '/')}`
    host = 'dev.azure.com'
  }
  host = ALIASES[host] ?? host
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

function webUrl(kind: ForgeKind, location: RemoteLocation): string {
  if (kind === 'azure') {
    const [org, project, ...name] = location.path.split('/')
    return `https://dev.azure.com/${org}/${project}/_git/${name.join('/')}`
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
    const location = parseRemoteUrl(remote.fetchUrl)
    const kind = location && forgeKind(location.host, custom)
    if (location && kind) {
      return {
        kind,
        host: location.host,
        path: location.path,
        remote: remote.name,
        webUrl: webUrl(kind, location)
      }
    }
  }
  return null
}

/** Remotes on the same host as `repo`, and the repository path each one is. */
export function remotesOn(remotes: Remote[], repo: ForgeRepo): Record<string, string> {
  const result: Record<string, string> = {}
  for (const remote of remotes) {
    const location = parseRemoteUrl(remote.fetchUrl)
    if (location?.host === repo.host) result[remote.name] = location.path
  }
  return result
}
