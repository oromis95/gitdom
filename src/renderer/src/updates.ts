// New versions and what's new: the startup check against GitHub releases, and the changelog shown
// once after an update and from Help > What's New.
import { create } from 'zustand'
import type { ReleaseInfo } from '../../shared/api'
import { compareVersions, parseChangelog, type ChangelogEntry } from '../../shared/releases'
import { useSettings } from './settings'
import { notify } from './ui'

const LAST_VERSION_KEY = 'gitdom.lastVersion'
const SKIPPED_KEY = 'gitdom.skippedVersion'
/** The check waits for startup to settle: it's never urgent */
const CHECK_DELAY = 5000

/** The bundled changelog, loaded on demand: there's nothing to show at most starts */
export const changelog = (): Promise<ChangelogEntry[]> =>
  import('../../../CHANGELOG.md?raw').then((m) => parseChangelog(m.default))

interface WhatsNew {
  title: string
  entries: ChangelogEntry[]
}

/** The in-app update of the portable exe or of the installed GitDom */
export type UpdateDownload =
  | { state: 'idle' }
  | { state: 'downloading'; received: number; total: number | null }
  | { state: 'ready' }
  | { state: 'failed'; error: string }

interface UpdatesState {
  /** Newer release found on GitHub, until dismissed */
  available: ReleaseInfo | null
  /** Whether GitDom can download and install it itself, instead of linking the download */
  selfUpdate: boolean
  download: UpdateDownload
  whatsNew: WhatsNew | null
}

export const useUpdates = create<UpdatesState>(() => ({
  available: null,
  selfUpdate: false,
  download: { state: 'idle' },
  whatsNew: null
}))

export async function showWhatsNew(whatsNew?: WhatsNew): Promise<void> {
  useUpdates.setState({
    whatsNew: whatsNew ?? { title: "What's new", entries: await changelog() }
  })
}

export const closeWhatsNew = (): void => useUpdates.setState({ whatsNew: null })

/** Asks GitHub for the latest release; a manual check also reports being up to date, or failing. */
export async function checkForUpdates(manual = false): Promise<void> {
  const result = await window.api.app.latestRelease()
  if (!result.ok) {
    if (manual) notify('error', `Could not check for updates: ${result.error}`)
    return
  }
  const release = result.value
  const newer = compareVersions(release.version, __APP_VERSION__) > 0
  if (newer && (manual || localStorage.getItem(SKIPPED_KEY) !== release.version)) {
    // Needs the portable exe or the installed GitDom, and a release with its checksum
    const selfUpdate =
      !!release.downloadUrl && !!release.checksumUrl && (await window.api.app.canSelfUpdate())
    const { download } = useUpdates.getState()
    useUpdates.setState({
      available: release,
      selfUpdate,
      download: release.readyToInstall
        ? { state: 'ready' }
        : download.state === 'downloading'
          ? download
          : { state: 'idle' }
    })
  } else if (manual) {
    notify('success', `GitDom ${__APP_VERSION__} is the latest version`)
  }
}

export const dismissUpdate = (): void => useUpdates.setState({ available: null })

/** Downloads the new exe and checks it; it's installed at a restart or when GitDom closes. */
export async function downloadUpdate(): Promise<void> {
  const release = useUpdates.getState().available
  if (!release) return
  useUpdates.setState({ download: { state: 'downloading', received: 0, total: null } })
  const stop = window.api.app.onUpdateProgress((progress) =>
    useUpdates.setState({ download: { state: 'downloading', ...progress } })
  )
  const result = await window.api.app.downloadUpdate()
  stop()
  if (result.ok) {
    useUpdates.setState({ download: { state: 'ready' } })
    // The notice may have been closed in the meantime
    if (!useUpdates.getState().available)
      notify('success', `GitDom ${release.version} is ready: it's installed when you close GitDom`)
  } else if (result.error === 'Download cancelled') {
    useUpdates.setState({ download: { state: 'idle' } })
  } else {
    useUpdates.setState({ download: { state: 'failed', error: result.error } })
  }
}

export const cancelUpdateDownload = (): void => window.api.app.cancelUpdate()

export async function installUpdate(): Promise<void> {
  const result = await window.api.app.installUpdate()
  if (!result.ok) notify('error', `Could not install the update: ${result.error}`)
}

/** Stops the startup notice for this release; the next one shows again. */
export function skipUpdate(): void {
  const { available } = useUpdates.getState()
  if (available) localStorage.setItem(SKIPPED_KEY, available.version)
  dismissUpdate()
}

/** The notes published with a newer release: the bundled changelog stops at this version. */
export function showReleaseNotes(release: ReleaseInfo): void {
  showWhatsNew({
    title: `What's new in GitDom ${release.version}`,
    entries: [{ version: release.version, date: '', body: release.notes.trim() }]
  })
}

/**
 * At startup: shows what changed since the version last run, then checks for a newer one.
 * Versions before 0.6.0 didn't record themselves: existing settings tell an update from a first run.
 */
export function startupChecks(): void {
  const last =
    localStorage.getItem(LAST_VERSION_KEY) ??
    (localStorage.getItem('gitdom.tabs') || localStorage.getItem('gitdom.recent') ? '0.5.0' : null)
  localStorage.setItem(LAST_VERSION_KEY, __APP_VERSION__)
  if (last && compareVersions(__APP_VERSION__, last) > 0)
    void changelog().then((all) => {
      const entries = all.filter(
        (e) =>
          compareVersions(e.version, last) > 0 && compareVersions(e.version, __APP_VERSION__) <= 0
      )
      if (entries.length)
        void showWhatsNew({ title: `GitDom updated to ${__APP_VERSION__}`, entries })
    })
  if (useSettings.getState().checkUpdates) setTimeout(() => void checkForUpdates(), CHECK_DELAY)
}
