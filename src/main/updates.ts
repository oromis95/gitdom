// New version check: reads GitDom's latest release from GitHub. The portable exe can't replace
// itself, so the renderer only tells the user and links the download.
import { net } from 'electron'
import type { ReleaseInfo } from '../shared/api'

export const REPO_URL = 'https://github.com/oromis95/gitdom'
const LATEST_RELEASE = 'https://api.github.com/repos/oromis95/gitdom/releases/latest'

interface GitHubRelease {
  tag_name?: unknown
  html_url?: unknown
  body?: unknown
  assets?: { name?: unknown; browser_download_url?: unknown }[]
}

/** Only links to GitDom's repository are opened from what GitHub returns. */
export const isRepoUrl = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith(`${REPO_URL}/`)

export async function latestRelease(): Promise<ReleaseInfo> {
  // net.fetch goes through the system proxy, like the browser
  const response = await net.fetch(LATEST_RELEASE, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitDom' }
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} ${response.statusText}`)
  const release = (await response.json()) as GitHubRelease
  if (typeof release.tag_name !== 'string' || !isRepoUrl(release.html_url)) {
    throw new Error('Unexpected answer from GitHub')
  }
  const exe = release.assets?.find(
    (a) => typeof a.name === 'string' && a.name.endsWith('-portable.exe')
  )
  return {
    version: release.tag_name.replace(/^v/, ''),
    url: release.html_url,
    downloadUrl: isRepoUrl(exe?.browser_download_url) ? exe.browser_download_url : null,
    notes: typeof release.body === 'string' ? release.body : ''
  }
}
