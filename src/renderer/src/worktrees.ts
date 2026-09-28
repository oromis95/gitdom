// Working trees (REPO-09): more than one branch checked out at once, each in its own folder.
import type { Ref, RepoSnapshot, Worktree } from '../../shared/types'
import { copy, run, runValue, showInFolder } from './actions'
import { useApp } from './store'
import { confirm, notify, showForm, type MenuItem } from './ui'

/** Paths from git use forward slashes; Windows paths compare regardless of case. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const path = p.replace(/[\\/]+/g, '/').replace(/\/$/, '')
    return /^[a-z]:/i.test(path) ? path.toLowerCase() : path
  }
  return norm(a) === norm(b)
}

export const folderName = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** The other working tree where `branch` is checked out, if any: git allows it in only one. */
export function worktreeOf(snapshot: RepoSnapshot, branch: string): Worktree | undefined {
  return snapshot.worktrees.find((w) => w.branch === branch && !samePath(w.path, snapshot.path))
}

/** C:/src/app and branch feature/x give app-feature-x. */
function defaultName(snapshot: RepoSnapshot, branch: string): string {
  const main = snapshot.worktrees.find((w) => w.main)?.path ?? snapshot.path
  const safe = branch.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
  return `${folderName(main)}-${safe || 'worktree'}`
}

/** Beside the main working tree: C:/src/app and branch feature/x give C:/src/app-feature-x. */
function defaultFolder(snapshot: RepoSnapshot, branch: string): string {
  const main = snapshot.worktrees.find((w) => w.main)?.path ?? snapshot.path
  return `${main.replace(/[\\/][^\\/]+[\\/]?$/, '')}/${defaultName(snapshot, branch)}`
}

export const openWorktree = (path: string): Promise<void> => useApp.getState().openRepo(path)

async function add(
  snapshot: RepoSnapshot,
  options: { path: string; branch?: string; newBranch?: string; start?: string },
  open: boolean
): Promise<void> {
  const path = await runValue(snapshot.path, 'worktreeAdd', options)
  if (!path) return
  const what = options.branch ?? options.newBranch ?? `${options.start?.slice(0, 7)} (detached)`
  notify('success', `Checked out ${what} in ${path}`)
  if (open) await openWorktree(path)
}

const FOLDER_FIELD = (snapshot: RepoSnapshot, name: string) =>
  ({
    key: 'folder',
    label: 'Folder',
    initial: defaultFolder(snapshot, name),
    browseParent: 'Choose where to create the folder'
  }) as const

const OPEN_CHECK = { key: 'open', label: 'Open it in a new tab', initial: true }

/** Checks out a local or remote branch in a new working tree, or opens the one it's in. */
export async function checkoutInWorktree(snapshot: RepoSnapshot, ref: Ref): Promise<void> {
  let branch = ref.name
  let newBranch: string | undefined
  if (ref.type === 'remote') {
    const tracking = snapshot.refs.find((r) => r.type === 'local' && r.upstream === ref.name)
    if (tracking) branch = tracking.name
    else {
      // A new local branch tracking the remote one, named like it unless the name is taken
      const name = ref.name.slice(ref.remote!.length + 1)
      const taken = snapshot.refs.some((r) => r.type === 'local' && r.name === name)
      newBranch = taken ? `${ref.remote}-${name}` : name
    }
  }
  if (!newBranch) {
    const existing = worktreeOf(snapshot, branch)
    if (existing) return openWorktree(existing.path)
    if (branch === snapshot.head.branch) {
      notify('info', `${branch} is checked out here already`)
      return
    }
  }

  const values = await showForm({
    title: 'Check out in a new worktree',
    message: `${newBranch ?? branch} gets its own folder, so you can work on it alongside ${snapshot.head.branch ?? 'the current checkout'} without stashing. Commits and branches are shared.`,
    fields: [FOLDER_FIELD(snapshot, newBranch ?? branch)],
    checks: [OPEN_CHECK],
    confirmLabel: 'Create worktree'
  })
  if (!values) return
  const path = String(values.folder).trim()
  await add(
    snapshot,
    newBranch ? { path, newBranch, start: ref.name } : { path, branch },
    !!values.open
  )
}

/** A new working tree on a new branch, or detached, starting from `start` (HEAD when null). */
export async function createWorktree(
  snapshot: RepoSnapshot,
  start: string | null,
  label?: string
): Promise<void> {
  const from = label ?? snapshot.head.branch ?? 'HEAD'
  const values = await showForm({
    title: 'New worktree',
    message: `A separate folder with its own checkout, starting from ${from}. Commits and branches are shared with this repository.`,
    fields: [
      {
        key: 'branch',
        label: 'New branch',
        placeholder: start ? 'Empty to check out the commit detached' : 'feature/my-change',
        optional: !!start
      },
      {
        ...FOLDER_FIELD(snapshot, 'worktree'),
        initial: '',
        placeholder: 'Empty: next to the repository, named after the branch',
        optional: true
      }
    ],
    checks: [OPEN_CHECK],
    confirmLabel: 'Create worktree'
  })
  if (!values) return
  const newBranch = String(values.branch).trim()
  const folder = String(values.folder).trim()
  // Browsing from an empty field picks only the parent: the new folder is named after the branch
  const path = !folder
    ? defaultFolder(snapshot, newBranch || from)
    : /[\\/]$/.test(folder)
      ? folder + defaultName(snapshot, newBranch || from)
      : folder
  await add(
    snapshot,
    { path, ...(newBranch ? { newBranch } : {}), ...(start ? { start } : {}) },
    !!values.open
  )
}

async function removeWorktree(snapshot: RepoSnapshot, worktree: Worktree): Promise<void> {
  const ok = await confirm(
    'Remove worktree',
    `Delete the folder ${worktree.path}?${worktree.branch ? ` The branch ${worktree.branch} and its commits are kept.` : ''}`,
    'Remove',
    true
  )
  if (!ok) return
  // Run from the main working tree: this one's tab is closed first, since watching the folder
  // would keep Windows from deleting it
  const main = snapshot.worktrees.find((w) => w.main)?.path ?? snapshot.path
  const app = useApp.getState()
  for (let i = app.tabs.length - 1; i >= 0; i--) {
    if (samePath(useApp.getState().tabs[i].path, worktree.path)) useApp.getState().closeTab(i)
  }
  await new Promise((resolve) => setTimeout(resolve, 300))

  let result = await window.api.op(main, 'worktreeRemove', worktree.path, false)
  if (
    !result.ok &&
    /modified or untracked|is dirty|contains/.test(result.details ?? result.error)
  ) {
    const force = await confirm(
      'Worktree has changes',
      `${folderName(worktree.path)} has changes that aren't committed. Remove it anyway and lose them?`,
      'Remove anyway',
      true
    )
    if (!force) return
    result = await window.api.op(main, 'worktreeRemove', worktree.path, true)
  }
  void useApp.getState().refreshPath(snapshot.path)
  void useApp.getState().refreshPath(main)
  if (result.ok) notify('success', `Removed the worktree ${folderName(worktree.path)}`)
  else notify('error', result.error, result.details)
}

export function worktreeMenu(snapshot: RepoSnapshot, worktree: Worktree): MenuItem[] {
  const repo = snapshot.path
  const here = samePath(worktree.path, repo)
  const missing = worktree.prunable !== null
  return [
    {
      label: 'Open in a tab',
      disabled: here || missing,
      onClick: () => void openWorktree(worktree.path)
    },
    {
      label: 'Show in folder',
      disabled: missing,
      onClick: () => showInFolder(worktree.path, null)
    },
    { label: 'Copy path', onClick: () => copy(worktree.path) },
    'separator',
    ...(worktree.main
      ? []
      : [
          worktree.locked === null
            ? {
                label: 'Lock (keep it even if the folder goes missing)',
                onClick: () => void run(repo, 'worktreeLock', worktree.path, true)
              }
            : {
                label: 'Unlock',
                onClick: () => void run(repo, 'worktreeLock', worktree.path, false)
              },
          missing
            ? {
                label: 'Forget missing worktrees',
                onClick: () => void run(repo, 'worktreePrune')
              }
            : {
                label: 'Remove worktree…',
                danger: true,
                disabled: worktree.locked !== null,
                onClick: () => void removeWorktree(snapshot, worktree)
              }
        ])
  ]
}
