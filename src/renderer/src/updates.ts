// New versions and what's new: the startup check against GitHub releases, and the changelog shown
// once after an update and from Help > What's New.
import { create } from 'zustand'
import changelogText from '../../../CHANGELOG.md?raw'
import type { ReleaseInfo } from '../../shared/api'
import { compareVersions, parseChangelog, type ChangelogEntry } from '../../shared/releases'
import { useSettings } from './settings'
import { notify } from './ui'

const LAST_VERSION_KEY = 'gitdom.lastVersion'
const SKIPPED_KEY = 'gitdom.skippedVersion'
/** The check waits for startup to settle: it's never urgent */
const CHECK_DELAY = 5000

export const CHANGELOG = parseChangelog(changelogText)

interface WhatsNew {
  title: string
  entries: ChangelogEntry[]
}

interface UpdatesState {
  /** Newer release found on GitHub, until dismissed */
  available: ReleaseInfo | null
  whatsNew: WhatsNew | null
}

export const useUpdates = create<UpdatesState>(() => ({ available: null, whatsNew: null }))

export const showWhatsNew = (
  whatsNew: WhatsNew = { title: "What's new", entries: CHANGELOG }
): void => useUpdates.setState({ whatsNew })

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
    useUpdates.setState({ available: release })
  } else if (manual) {
    notify('success', `GitDom ${__APP_VERSION__} is the latest version`)
  }
}

export const dismissUpdate = (): void => useUpdates.setState({ available: null })

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
  if (last && compareVersions(__APP_VERSION__, last) > 0) {
    const entries = CHANGELOG.filter(
      (e) =>
        compareVersions(e.version, last) > 0 && compareVersions(e.version, __APP_VERSION__) <= 0
    )
    if (entries.length) showWhatsNew({ title: `GitDom updated to ${__APP_VERSION__}`, entries })
  }
  if (useSettings.getState().checkUpdates) setTimeout(() => void checkForUpdates(), CHECK_DELAY)
}
