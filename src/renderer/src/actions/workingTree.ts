// The working tree: stash, ignore, discard, conflicts and operations in progress, files.
import type { DiffSource, FileChange, Stash } from '../../../shared/types'
import { extensionOf, folderOf, ignorePattern, type IgnoreKind } from '../../../shared/ignore'
import { useApp } from '../store'
import { confirm, notify, showForm, type MenuItem } from '../ui'
import { call, capitalize, fail, reportOutcome, run, snapshotOf } from './core'

// --- Stash ----------------------------------------------------------------------------------

export async function stash(repo: string): Promise<void> {
  const staged = snapshotOf(repo)?.status.staged.length ?? 0
  const values = await showForm({
    title: 'Stash changes',
    fields: [{ key: 'message', label: 'Message', placeholder: 'WIP', optional: true }],
    checks: [
      { key: 'untracked', label: 'Include untracked files', initial: true },
      ...(staged > 0
        ? [{ key: 'staged', label: 'Only the staged changes, keeping the others here' }]
        : [])
    ],
    confirmLabel: 'Stash'
  })
  if (!values) return
  const options = { staged: !!values.staged }
  if (await run(repo, 'stashPush', String(values.message), !!values.untracked, options)) {
    notify('success', options.staged ? 'Staged changes stashed' : 'Changes stashed')
  }
}

/** Stashes the changes to some files only (STASH-05), untracked ones included. */
export async function stashFiles(repo: string, files: FileChange[]): Promise<void> {
  const what = files.length === 1 ? files[0].path : `${files.length} files`
  const values = await showForm({
    title: 'Stash changes',
    message: `Stash the changes to ${what}, staged or not; the other changes stay here.`,
    fields: [{ key: 'message', label: 'Message', placeholder: 'WIP', optional: true }],
    confirmLabel: 'Stash'
  })
  if (!values) return
  const paths = files.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]))
  const untracked = files.some((f) => f.status === '?')
  if (await run(repo, 'stashPush', String(values.message), untracked, { paths })) {
    notify('success', `Stashed ${what}`)
  }
}

export async function stashPop(repo: string, entry: Stash): Promise<void> {
  if (await run(repo, 'stashPop', entry.selector)) notify('success', 'Stash applied and removed')
}

export async function stashDrop(repo: string, entry: Stash): Promise<void> {
  const ok = await confirm(
    'Delete stash',
    `Delete "${entry.message}"? It cannot be recovered.`,
    'Delete',
    true
  )
  if (ok) await run(repo, 'stashDrop', entry.selector)
}

// --- Ignore ---------------------------------------------------------------------------------

/** Adds a file, its extension or its folder to the root .gitignore (COMMIT-11). */
export async function ignoreFile(repo: string, file: FileChange): Promise<void> {
  const tracked = file.status !== '?'
  const extension = extensionOf(file.path)
  const folder = folderOf(file.path)
  const kinds: { value: IgnoreKind; label: string }[] = [
    { value: 'file', label: `This file: ${ignorePattern(file.path, 'file')}` },
    ...(extension
      ? [{ value: 'extension' as const, label: `Every .${extension} file: *.${extension}` }]
      : []),
    ...(folder
      ? [{ value: 'folder' as const, label: `Its folder: ${ignorePattern(file.path, 'folder')}` }]
      : [])
  ]
  const values = await showForm({
    title: 'Add to .gitignore',
    message: tracked
      ? `${file.path} is tracked: .gitignore only affects untracked files, so it must also stop being tracked. It stays on disk, and the next commit removes it from the repository.`
      : undefined,
    fields: [
      { key: 'kind', label: 'Ignore', options: kinds, initial: 'file' },
      {
        key: 'custom',
        label: 'Or a pattern of your own',
        placeholder: 'e.g. *.log',
        optional: true
      }
    ],
    confirmLabel: tracked ? 'Stop tracking and ignore' : 'Ignore',
    danger: tracked
  })
  if (!values) return
  const custom = String(values.custom).trim()
  const kind = values.kind as IgnoreKind
  const pattern = custom || ignorePattern(file.path, kind)
  // A tracked folder stops being tracked as a whole, anything else only this file
  const untrack = !tracked ? [] : !custom && kind === 'folder' ? [folder!] : [file.path]
  if (await run(repo, 'ignore', pattern, untrack))
    notify('success', `Added ${pattern} to .gitignore`)
}

// --- Working tree ---------------------------------------------------------------------------

export async function discardFiles(repo: string, files: FileChange[]): Promise<void> {
  const what = files.length === 1 ? `"${files[0].path}"` : `${files.length} files`
  const ok = await confirm(
    'Discard changes',
    `Discard all changes to ${what}? New files are deleted. This cannot be undone.`,
    'Discard',
    true
  )
  if (ok) await run(repo, 'discard', files)
}

// --- Conflicts and operations in progress ---------------------------------------------------

/** Stages conflicted files as resolved, asking first when they still contain conflict markers. */
export async function markResolved(repo: string, paths: string[]): Promise<boolean> {
  const markers = await call(repo, 'conflictMarkers', paths)
  if (markers.ok && markers.value.length > 0) {
    const what =
      markers.value.length === 1
        ? `"${markers.value[0]}" still contains`
        : `${markers.value.length} files still contain`
    const ok = await confirm(
      'Conflict markers left',
      `${what} conflict markers (<<<<<<< / >>>>>>>). Mark as resolved anyway?`,
      'Mark resolved'
    )
    if (!ok) return false
  }
  return await run(repo, 'stage', paths)
}

export async function resolveWith(
  repo: string,
  paths: string[],
  side: 'ours' | 'theirs'
): Promise<boolean> {
  const what = paths.length === 1 ? `"${paths[0]}"` : `${paths.length} files`
  const version = side === 'ours' ? 'the HEAD version' : 'the incoming version'
  const ok = await confirm(
    'Resolve conflicts',
    `Replace ${what} with ${version}? Edits made while resolving are lost.`,
    side === 'ours' ? 'Keep HEAD' : 'Take incoming'
  )
  return ok && (await run(repo, 'resolveConflict', paths, side))
}

export async function openDiffTool(
  repo: string,
  source: DiffSource,
  path: string,
  oldPath?: string
): Promise<void> {
  const { setBusy } = useApp.getState()
  setBusy(repo, 'Waiting for the diff tool')
  const result = await call(repo, 'openDiffTool', source, path, oldPath)
  setBusy(repo, undefined)
  // A tool can edit the working copy (unstaged side)
  void useApp.getState().refreshPath(repo)
  if (!result.ok) fail(result)
}

export async function openMergeTool(repo: string, path: string): Promise<void> {
  const { setBusy, openDiff } = useApp.getState()
  setBusy(repo, 'Waiting for the merge tool')
  const result = await call(repo, 'openMergeTool', path)
  setBusy(repo, undefined)
  void useApp.getState().refreshPath(repo)
  if (!result.ok) return fail(result)
  // The tool stages the file when it exits after a successful merge
  const status = await call(repo, 'status')
  if (status.ok && !status.value.unstaged.some((f) => f.path === path && f.status === 'U')) {
    notify('success', `Resolved ${path}`)
    openDiff({ source: { kind: 'staged' }, path })
  }
}

export function conflictMenu(repo: string, paths: string[]): MenuItem[] {
  const single = paths.length === 1
  return [
    ...(single
      ? [
          {
            label: 'Open in merge tool',
            onClick: () =>
              useApp
                .getState()
                .openDiff({ source: { kind: 'unstaged' }, path: paths[0], merge: true })
          },
          {
            label: 'Open in external merge tool',
            onClick: () => void openMergeTool(repo, paths[0])
          },
          'separator' as const
        ]
      : []),
    { label: 'Mark resolved', onClick: () => void markResolved(repo, paths) },
    'separator',
    { label: 'Keep HEAD version (ours)', onClick: () => void resolveWith(repo, paths, 'ours') },
    {
      label: 'Take incoming version (theirs)',
      onClick: () => void resolveWith(repo, paths, 'theirs')
    }
  ]
}

export async function continueOperation(repo: string, operation: string): Promise<void> {
  const { setBusy, refreshPath } = useApp.getState()
  setBusy(repo, `Continuing ${operation}…`)
  const result = await call(repo, 'continueOperation')
  setBusy(repo, undefined)
  void refreshPath(repo)
  if (!result.ok) return fail(result)
  reportOutcome(result.value, capitalize(operation), `${capitalize(operation)} done`)
  // The diff of a file resolved along the way is committed now
  if (!result.value.conflicts) useApp.getState().openDiff(null)
}

export async function skipOperation(repo: string, operation: string): Promise<void> {
  const ok = await confirm(
    `Skip commit`,
    `Skip the commit that stopped the ${operation}? Its changes are left out.`,
    'Skip commit',
    true
  )
  if (!ok) return
  const result = await call(repo, 'skipOperation')
  void useApp.getState().refreshPath(repo)
  if (result.ok) reportOutcome(result.value, capitalize(operation), 'Commit skipped')
  else fail(result)
}

export async function abortOperation(repo: string, operation: string): Promise<void> {
  const ok = await confirm(
    `Abort ${operation}`,
    `Abort the ${operation} and go back to the state before it started? Conflict resolutions done so far are lost.`,
    `Abort ${operation}`,
    true
  )
  if (ok && (await run(repo, 'abortOperation'))) {
    notify('success', `${capitalize(operation)} aborted`)
  }
}

/** Saves a file as it was at a commit, where the user picks. */
export async function saveFileAt(repo: string, rev: string, path: string): Promise<void> {
  const name = path.split('/').pop()!
  const dest = await window.api.tools.pickSavePath(`Save ${name} from ${rev.slice(0, 7)}`, name)
  if (!dest) return
  const result = await window.api.op(repo, 'saveFileAt', rev, path, dest)
  if (result.ok) notify('info', `Saved ${dest}`)
  else notify('error', result.error)
}

/** Opens a file of the repository, or the repository itself (null), in the external editor. */
export async function openInEditor(repo: string, path: string | null): Promise<void> {
  const result = await window.api.tools.openInEditor(repo, path)
  if (!result.ok) notify('error', `Couldn't open the editor: ${result.error}`, result.details)
}

export function showInFolder(repo: string, path: string | null): void {
  window.api.tools.showInFolder(repo, path)
}
