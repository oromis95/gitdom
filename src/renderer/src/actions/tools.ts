// Tool dialogs, patches and bisect.
import type { BisectMark, CleanScope, PatchSource } from '../../../shared/api'
import type { RepoSnapshot } from '../../../shared/types'
import { notify, showForm, useUi } from '../ui'
import { fail, run, runBusy, runOutcome, runValue } from './core'

/** Opens the ignored files of a repository, checking a path first when given. */
export function showIgnoredFiles(repo: string, path: string): void {
  useUi.setState({ ignored: { repo, path } })
}

/** Opens the overview of the local branches. */
export function showBranchOverview(repo: string): void {
  useUi.setState({ branches: { repo } })
}

/** Opens the repository health: its size, the heaviest files, and maintenance. */
export function showRepoHealth(repo: string): void {
  useUi.setState({ health: { repo } })
}

// --- Patches (ADV-07) ------------------------------------------------------------------------

/** A file name for a patch, from the subject of its first commit as git format-patch makes it. */
function patchName(subject: string, index = 1): string {
  const slug = subject
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52)
  return `${String(index).padStart(4, '0')}-${slug || 'patch'}.patch`
}

/** Saves some commits, or the changes not committed yet, as a patch file. */
export async function savePatch(repo: string, source: PatchSource, name: string): Promise<void> {
  const dest = await window.api.tools.pickSavePath('Save patch', name)
  if (!dest) return
  if (await run(repo, 'savePatch', dest, source)) notify('success', 'Patch saved', dest)
}

export function saveCommitsPatch(snapshot: RepoSnapshot, hashes: string[]): Promise<void> {
  const first = snapshot.commits.find((c) => c.hash === hashes[hashes.length - 1])
  return savePatch(
    snapshot.path,
    { commits: hashes },
    hashes.length === 1 ? patchName(first?.subject ?? hashes[0].slice(0, 7)) : 'commits.patch'
  )
}

export async function copyPatch(repo: string, source: PatchSource): Promise<void> {
  const text = await runValue(repo, 'patchText', source)
  if (text === undefined) return
  if (!text) notify('info', 'No changes to copy')
  else {
    void navigator.clipboard.writeText(text)
    notify('info', 'Patch copied to the clipboard')
  }
}

/** Shows a patch file before applying it; asks for one when none is given. */
export async function openPatch(repo: string, path?: string): Promise<void> {
  const file = path ?? (await window.api.tools.pickPatchFile())
  if (file) useUi.setState({ patch: { repo, path: file } })
}

/** Applies a patch file: as commits, or as changes to the working tree (and index). */
export async function applyPatch(
  repo: string,
  path: string,
  how: 'commits' | 'worktree' | 'stage'
): Promise<boolean> {
  const name = path.split(/[\\/]/).pop() ?? path
  const outcome =
    how === 'commits'
      ? await runOutcome(repo, 'Applying the patch', `${name} applied as commits`, 'amPatch', path)
      : await runOutcome(
          repo,
          'Applying the patch',
          how === 'stage' ? `${name} applied and staged` : `${name} applied to the working tree`,
          'applyPatchFile',
          path,
          how === 'stage'
        )
  return outcome !== undefined
}

/** Opens the hooks of the repository. */
export function showHooks(repo: string): void {
  useUi.setState({ hooks: { repo } })
}

/** Opens the clean up of untracked or ignored files. */
export function showCleanUp(repo: string, scope: CleanScope = 'untracked'): void {
  useUi.setState({ clean: { repo, scope } })
}

/** Opens the release notes of the commits up to a tag, or HEAD. */
export function showReleaseNotes(repo: string, to: string): void {
  useUi.setState({ releaseNotes: { repo, to } })
}

// --- Bisect (ADV-06) -------------------------------------------------------------------------

const BISECT_COMMAND_KEY = 'gitdom.bisectCommand'

/** Starts looking for the commit that brought a problem in, from one that has it. */
export async function startBisect(snapshot: RepoSnapshot, bad: string): Promise<void> {
  const result = await runBusy(snapshot.path, 'Starting bisect', 'bisectStart', bad, null)
  if (!result.ok) fail(result)
}

export async function markBisect(
  repo: string,
  mark: BisectMark,
  hash: string | null = null
): Promise<void> {
  const result = await runBusy(repo, 'Bisecting', 'bisectMark', mark, hash)
  if (!result.ok) fail(result)
}

export async function stopBisect(repo: string): Promise<void> {
  const result = await runBusy(repo, 'Stopping bisect', 'bisectReset')
  if (!result.ok) fail(result)
}

/** Lets a command test each commit, until the first bad one is found. */
export async function runBisect(repo: string): Promise<void> {
  const values = await showForm({
    title: 'Test each commit with a command',
    fields: [
      {
        key: 'command',
        label: 'Command, run in the repository folder',
        initial: localStorage.getItem(BISECT_COMMAND_KEY) ?? 'npm test'
      }
    ],
    message:
      'It runs on every commit to test: exiting with 0 means good, 125 skips the commit, any other code up to 127 means bad. The output is in the activity log.',
    confirmLabel: 'Run'
  })
  const command = values ? String(values.command).trim() : ''
  if (!command) return
  localStorage.setItem(BISECT_COMMAND_KEY, command)
  const result = await runBusy(repo, 'Bisecting', 'bisectRun', command)
  if (!result.ok) fail(result)
}
