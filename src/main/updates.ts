// Updates: reads GitDom's latest release from GitHub and downloads the exe for this copy, checked
// against the release's SHA-256. The portable exe is put in place of the running one; the installed
// GitDom runs the new installer silently. Both at a restart or when GitDom closes. Other builds
// (development, unpacked) only tell the user and link the download.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { open, readdir, rename, rm } from 'fs/promises'
import { dirname, join } from 'path'
import { app, net } from 'electron'
import type { ReleaseInfo, UpdateProgress } from '../shared/api'
import {
  compareVersions,
  parseChangelog,
  releaseAssets,
  tagOfReleaseUrl,
  type ReleaseKind
} from '../shared/releases'
import { checksumFor, cleanUpAfterUpdate, downloadPathOf, swapExecutable } from './updateFiles'

export const REPO_URL = 'https://github.com/oromis95/gitdom'
const LATEST_RELEASE = 'https://api.github.com/repos/oromis95/gitdom/releases/latest'
/** The same, from the website: not limited like the API, which many people behind one office
 * address soon use up (60 requests an hour) */
const LATEST_PAGE = `${REPO_URL}/releases/latest`
const RAW_FILES = 'https://raw.githubusercontent.com/oromis95/gitdom'
const PROGRESS_INTERVAL = 200

interface GitHubRelease {
  tag_name?: unknown
  html_url?: unknown
  body?: unknown
  assets?: { name?: unknown; browser_download_url?: unknown }[]
}

/** Only links to GitDom's repository are opened from what GitHub returns. */
export const isRepoUrl = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith(`${REPO_URL}/`)

/** The exe the user started: the portable build runs from a temporary copy and says where it is. */
const portableExe = (): string | null => process.env.PORTABLE_EXECUTABLE_FILE || null

/** The installer leaves its uninstaller next to GitDom */
const installed = (): boolean =>
  app.isPackaged && existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`))

/** How this copy updates itself; null when it can't (development, unpacked) */
function kind(): ReleaseKind | null {
  return portableExe() ? 'portable' : installed() ? 'setup' : null
}

export const canSelfUpdate = (): boolean => kind() !== null

/** Where the new installer is downloaded: the temporary folder, removed at the next start */
const setupPathOf = (name: string): string => join(app.getPath('temp'), name)
const SETUP_FILE = /^GitDom-[\w.-]+-setup\.exe(\.download)?$/

/** The release the renderer was last told about: the one a download fetches. */
let latest: (ReleaseInfo & { exeName: string | null }) | null = null
let downloading: AbortController | null = null
/** Version downloaded and checked, put in place at the next restart or when GitDom closes */
let ready: string | null = null
/** The installer of that version, for the installed GitDom */
let setup: string | null = null

export async function latestRelease(): Promise<ReleaseInfo> {
  // net.fetch goes through the system proxy, like the browser
  const response = await net.fetch(LATEST_RELEASE, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitDom' }
  })
  // Over the API's limit for this address: the website tells the same
  if (response.status === 403 || response.status === 429)
    return remember(await releaseFromWebsite())
  if (!response.ok) throw new Error(`GitHub answered ${response.status} ${response.statusText}`)
  const release = (await response.json()) as GitHubRelease
  if (typeof release.tag_name !== 'string' || !isRepoUrl(release.html_url)) {
    throw new Error('Unexpected answer from GitHub')
  }
  const asset = (suffix: string): { name: string; url: string } | null => {
    const found = release.assets?.find((a) => typeof a.name === 'string' && a.name.endsWith(suffix))
    return found && isRepoUrl(found.browser_download_url)
      ? { name: found.name as string, url: found.browser_download_url }
      : null
  }
  // A copy that can't update itself links the portable exe
  const suffix = `-${kind() ?? 'portable'}.exe`
  const exe = asset(suffix)
  const checksum = asset(`${suffix}.sha256`)
  const info: ReleaseInfo = {
    version: release.tag_name.replace(/^v/, ''),
    url: release.html_url,
    downloadUrl: exe?.url ?? null,
    checksumUrl: checksum?.url ?? null,
    notes: typeof release.body === 'string' ? release.body : '',
    readyToInstall: false
  }
  return remember(info, exe?.name ?? null)
}

function remember(info: ReleaseInfo, exeName: string | null = null): ReleaseInfo {
  latest = {
    ...info,
    exeName:
      exeName ?? (info.downloadUrl ? releaseAssets(info.version, kind() ?? 'portable').exe : null)
  }
  return { ...info, readyToInstall: ready === info.version }
}

/**
 * The latest release from the pages anyone can read: /releases/latest leads to the tag, the notes
 * are that version's section of the changelog, the files have fixed addresses.
 */
async function releaseFromWebsite(): Promise<ReleaseInfo> {
  const headers = { 'User-Agent': 'GitDom' }
  const page = await net.fetch(LATEST_PAGE, { headers })
  const tag = isRepoUrl(page.url) ? tagOfReleaseUrl(page.url) : null
  void page.body?.cancel()
  if (!page.ok || !tag) throw new Error(`GitHub answered ${page.status} ${page.statusText}`)
  const version = tag.replace(/^v/, '')
  const { exe, checksum } = releaseAssets(version, kind() ?? 'portable')
  const download = `${REPO_URL}/releases/download/${encodeURIComponent(tag)}`
  // The files come a few minutes after the release, once built: only offered when there
  const attached = await net
    .fetch(`${download}/${checksum}`, { method: 'HEAD', headers })
    .then((r) => r.ok)
    .catch(() => false)
  const notes = await net
    .fetch(`${RAW_FILES}/${encodeURIComponent(tag)}/CHANGELOG.md`, { headers })
    .then((r) => (r.ok ? r.text() : ''))
    .then((text) => parseChangelog(text).find((e) => e.version === version)?.body ?? '')
    .catch(() => '')
  return {
    version,
    url: page.url,
    downloadUrl: attached ? `${download}/${exe}` : null,
    checksumUrl: attached ? `${download}/${checksum}` : null,
    notes,
    readyToInstall: false
  }
}

async function fetchOk(url: string, signal: AbortSignal): Promise<Response> {
  const response = await net.fetch(url, { headers: { 'User-Agent': 'GitDom' }, signal })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} ${response.statusText}`)
  return response
}

/**
 * Downloads the latest release's exe, checking its SHA-256 on the way: next to the running one for
 * the portable exe, in the temporary folder for the installer. A download that fails, is cancelled
 * or doesn't match is deleted.
 */
export async function downloadUpdate(
  onProgress: (progress: UpdateProgress) => void
): Promise<void> {
  const how = kind()
  if (!how) throw new Error('Only the portable exe and the installed GitDom can update themselves')
  const release = latest
  if (!release?.downloadUrl || !release.exeName) throw new Error('This release has no exe')
  if (!release.checksumUrl) {
    throw new Error('This release has no checksum to verify it: download it from its page')
  }
  if (compareVersions(release.version, app.getVersion()) <= 0) {
    throw new Error(`GitDom ${app.getVersion()} is already up to date`)
  }
  if (ready === release.version) return
  if (downloading) throw new Error('The update is already downloading')
  // The name becomes a path in the temporary folder: only the installer's own pattern
  if (how === 'setup' && !SETUP_FILE.test(release.exeName))
    throw new Error('This release has no installer')

  const controller = new AbortController()
  downloading = controller
  const exe = how === 'portable' ? (portableExe() as string) : setupPathOf(release.exeName)
  const target = downloadPathOf(exe)
  try {
    const listing = await (await fetchOk(release.checksumUrl, controller.signal)).text()
    const expected = checksumFor(listing, release.exeName)
    if (!expected) throw new Error('The checksum file does not list the exe')

    let file
    try {
      file = await open(target, 'w')
    } catch {
      throw new Error(
        `GitDom can't write in ${dirname(exe)}: move it to a folder of yours, or download the update from its page`
      )
    }
    const hash = createHash('sha256')
    try {
      const response = await fetchOk(release.downloadUrl, controller.signal)
      if (!response.body) throw new Error('Empty answer from GitHub')
      const total = Number(response.headers.get('content-length')) || null
      let received = 0
      let reported = 0
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        await file.write(value)
        received += value.length
        if (Date.now() - reported > PROGRESS_INTERVAL) {
          reported = Date.now()
          onProgress({ received, total })
        }
      }
      onProgress({ received, total })
    } finally {
      await file.close()
    }
    if (hash.digest('hex') !== expected) {
      throw new Error('The download is damaged (its checksum does not match): try again')
    }
    if (how === 'setup') {
      await rename(target, exe)
      setup = exe
    }
    ready = release.version
  } catch (e) {
    await rm(target, { force: true }).catch(() => undefined)
    if (controller.signal.aborted) throw new Error('Download cancelled')
    throw e
  } finally {
    downloading = null
  }
}

export const cancelUpdate = (): void => downloading?.abort()

/**
 * Installs the downloaded update; false when there's nothing to install. The portable exe swaps
 * files; the installer runs silently once GitDom has closed (it waits for it), and with `start`
 * opens the new version when done.
 */
function applyUpdate(start: boolean): boolean {
  if (!ready) return false
  const exe = portableExe()
  if (exe) swapExecutable(exe, downloadPathOf(exe))
  else if (setup)
    spawn(setup, ['/S', '--updated', ...(start ? ['--force-run'] : [])], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  else return false
  ready = null
  return true
}

/** Installs the downloaded update and starts the new version. */
export function installUpdateNow(): void {
  if (!applyUpdate(true)) throw new Error('No update is ready to install')
  const exe = portableExe()
  // The installer starts the new version itself
  if (exe) app.relaunch({ execPath: exe, args: [] })
  app.quit()
}

/** At startup, removes what the last update left; when GitDom closes, installs a pending one. */
export function registerUpdateLifecycle(): void {
  const how = kind()
  if (!how) return
  const exe = portableExe()
  if (exe) void cleanUpAfterUpdate(exe)
  else void removeOldInstallers()
  app.on('will-quit', () => {
    try {
      applyUpdate(false)
    } catch {
      // The exe is in use or read-only: the update is downloaded again next time
    }
  })
}

/** The installers downloaded by earlier updates, done by now */
async function removeOldInstallers(): Promise<void> {
  const temp = app.getPath('temp')
  const files = await readdir(temp).catch(() => [] as string[])
  for (const file of files.filter((f) => SETUP_FILE.test(f)))
    await rm(join(temp, file), { force: true }).catch(() => undefined)
}
