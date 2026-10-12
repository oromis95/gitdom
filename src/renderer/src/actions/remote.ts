// Fetch, pull and push, remotes, submodules and LFS.
import type { PullMode } from '../../../shared/api'
import { isAuthFailure } from '../../../shared/askpass'
import type { RepoSnapshot, Submodule } from '../../../shared/types'
import { confirm, notify, prompt, showForm } from '../ui'
import { fail, reportOutcome, run, runBusy } from './core'

// --- Sync -----------------------------------------------------------------------------------

/** Repositories whose periodic fetch was told it needs credentials: told once */
const needCredentials = new Set<string>()

/**
 * Fetches every remote. A silent fetch reports nothing; a background one (the periodic fetch) also
 * never asks for credentials, and says once when it needs them.
 */
export async function fetchAll(repo: string, silent = false, background = silent): Promise<void> {
  const result = await runBusy(repo, 'Fetching', 'fetch', background)
  if (result.ok) needCredentials.delete(repo)
  else if (background && isAuthFailure(`${result.error}\n${result.details ?? ''}`)) {
    if (!needCredentials.has(repo)) {
      needCredentials.add(repo)
      const name = repo.split(/[\\/]/).filter(Boolean).pop()
      notify(
        'warning',
        `The periodic fetch of ${name} needs credentials: use Fetch all to enter them`
      )
    }
  }
  if (silent) return
  if (result.ok) notify('success', 'Fetched all remotes')
  else fail(result)
}

export async function pull(repo: string, mode: PullMode): Promise<void> {
  const result = await runBusy(repo, 'Pulling', 'pull', mode)
  if (result.ok) {
    const { output } = result.value
    reportOutcome(
      result.value,
      'Pull',
      /Already up to date/i.test(output) ? 'Already up to date' : 'Pulled'
    )
  } else if (
    mode === 'ff-only' &&
    /Not possible to fast-forward|diverg/i.test(result.details ?? result.error)
  ) {
    notify(
      'error',
      'Cannot fast-forward: the branch has diverged. Pull with merge or rebase.',
      result.details
    )
  } else {
    fail(result)
  }
}

const PUSH_REJECTED = /\[rejected\]|non-fast-forward|fetch first|stale info/

export async function push(repo: string): Promise<void> {
  let result = await runBusy(repo, 'Pushing', 'push', false)
  if (!result.ok && PUSH_REJECTED.test(result.details ?? '')) {
    const force = await confirm(
      'Push rejected',
      'The remote branch has commits you do not have. Pull first, or force push to overwrite them ' +
        '(with lease: it fails if someone pushed after your last fetch).',
      'Force push',
      true
    )
    if (!force) return
    result = await runBusy(repo, 'Pushing', 'push', true)
  }
  if (result.ok) notify('success', 'Pushed', result.value)
  else fail(result)
}

// --- Remotes --------------------------------------------------------------------------------

export async function addRemote(repo: string): Promise<void> {
  const values = await showForm({
    title: 'Add remote',
    fields: [
      { key: 'name', label: 'Name', initial: 'origin' },
      { key: 'url', label: 'URL', placeholder: 'https://github.com/user/repo.git' }
    ],
    confirmLabel: 'Add remote'
  })
  if (!values) return
  const name = String(values.name).trim()
  if (await run(repo, 'addRemote', name, String(values.url).trim())) {
    // New remotes have no branches yet: fetch them right away, asking for credentials if needed
    await fetchAll(repo, true, false)
  }
}

export async function editRemote(
  repo: string,
  snapshot: RepoSnapshot,
  name: string
): Promise<void> {
  const current = snapshot.remotes.find((r) => r.name === name)
  const values = await showForm({
    title: `Edit remote ${name}`,
    fields: [
      { key: 'name', label: 'Name', initial: name },
      { key: 'url', label: 'URL', initial: current?.fetchUrl ?? '' }
    ],
    confirmLabel: 'Save'
  })
  if (!values) return
  const newName = String(values.name).trim()
  const url = String(values.url).trim()
  if (url !== current?.fetchUrl && !(await run(repo, 'setRemoteUrl', name, url))) return
  if (newName !== name) await run(repo, 'renameRemote', name, newName)
}

export async function removeRemote(repo: string, name: string): Promise<void> {
  const ok = await confirm(
    'Remove remote',
    `Remove the remote "${name}"? Its remote-tracking branches are removed too; nothing changes on the server.`,
    'Remove',
    true
  )
  if (ok) await run(repo, 'removeRemote', name)
}

// --- Submodules and LFS ---------------------------------------------------------------------

/** Clones and checks out submodules at their recorded commits; all of them when none is given. */
export async function updateSubmodules(repo: string, paths: string[] = []): Promise<void> {
  const result = await runBusy(repo, 'Updating submodules', 'submoduleUpdate', paths)
  if (result.ok)
    notify('success', paths.length === 1 ? `Updated ${paths[0]}` : 'Updated submodules')
  else fail(result)
}

/** Adds a repository as a submodule, in a folder named after it by default. */
export async function addSubmodule(repo: string): Promise<void> {
  const values = await showForm({
    title: 'Add submodule',
    message: 'Clones a repository into a folder of this one, pinned at its current commit.',
    fields: [
      { key: 'url', label: 'Repository URL', placeholder: 'https://github.com/owner/library.git' },
      {
        key: 'path',
        label: 'Folder',
        placeholder: 'Empty: named after the repository, e.g. libs/library',
        optional: true
      }
    ],
    confirmLabel: 'Add submodule'
  })
  if (!values) return
  const url = String(values.url).trim()
  const path =
    String(values.path).trim() ||
    (
      url
        .replace(/[\\/]+$/, '')
        .split(/[\\/:]/)
        .pop() ?? ''
    ).replace(/\.git$/, '')
  if (!url || !path) return
  const result = await runBusy(repo, 'Adding submodule', 'submoduleAdd', url, path)
  if (result.ok) notify('success', `Added ${path}: commit it together with .gitmodules`)
  else fail(result)
}

/** Copies the submodule URLs from .gitmodules to the configuration, after they changed there. */
export async function syncSubmodules(repo: string, paths: string[] = []): Promise<void> {
  const result = await runBusy(repo, 'Syncing submodules', 'submoduleSync', paths)
  if (result.ok) notify('success', paths.length === 1 ? `Synced ${paths[0]}` : 'Synced submodules')
  else fail(result)
}

export const submodulePath = (repo: string, sub: Submodule): string => `${repo}/${sub.path}`

/** The LFS pattern suggested for a file: its extension, or the file itself. */
export function lfsPatternFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `*${name.slice(dot)}` : path
}

export async function lfsTrack(repo: string, pattern?: string): Promise<void> {
  const value =
    pattern ?? (await prompt('Track with Git LFS', 'Pattern, e.g. *.psd or assets/**', '', 'Track'))
  if (!value?.trim()) return
  if (await run(repo, 'lfsTrack', value.trim())) {
    notify('success', `Files matching ${value.trim()} are stored with LFS: commit .gitattributes`)
  }
}

export async function lfsPull(repo: string): Promise<void> {
  const result = await runBusy(repo, 'Downloading LFS files', 'lfsPull')
  if (result.ok) notify('success', 'LFS files downloaded')
  else fail(result)
}

export async function lfsPush(repo: string, remote: string): Promise<void> {
  const result = await runBusy(repo, 'Uploading LFS files', 'lfsPush', remote)
  if (result.ok) notify('success', `LFS files uploaded to ${remote}`)
  else fail(result)
}

export async function lfsUntrack(repo: string, pattern: string): Promise<void> {
  if (await run(repo, 'lfsUntrack', pattern)) {
    notify('info', `${pattern} is no longer tracked with LFS: commit .gitattributes`)
  }
}

// --- Preferences ----------------------------------------------------------------------------

const PULL_MODE_KEY = 'gitdom.pullMode'

export function savedPullMode(): PullMode {
  const saved = localStorage.getItem(PULL_MODE_KEY)
  return saved === 'ff-only' || saved === 'rebase' ? saved : 'ff'
}

export function savePullMode(mode: PullMode): void {
  localStorage.setItem(PULL_MODE_KEY, mode)
}
