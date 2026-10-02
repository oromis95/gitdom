// Workspaces (REPO-07): named groups of repositories that open together, each in its own tab.
import { create } from 'zustand'
import { useApp } from './store'
import { confirm, notify, prompt, type MenuItem } from './ui'

export interface Workspace {
  name: string
  paths: string[]
}

const KEY = 'gitdom.workspaces'

function read(): Workspace[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((w) => w?.name && Array.isArray(w.paths)) : []
  } catch {
    return []
  }
}

export const useWorkspaces = create<{ list: Workspace[] }>(() => ({ list: read() }))

function save(list: Workspace[]): void {
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
  localStorage.setItem(KEY, JSON.stringify(sorted))
  useWorkspaces.setState({ list: sorted })
}

/** Every repository GitDom knows, once each: open tabs, workspaces, favorites, then recent. */
export function knownRepositories(
  tabs: string[],
  workspaces: Workspace[],
  favorites: string[],
  recent: string[]
): string[] {
  const paths = [...tabs, ...workspaces.flatMap((w) => w.paths), ...favorites, ...recent]
  return paths.filter((p, i) => paths.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
}

/** Repositories read or fetched at the same time */
const PARALLEL = 4

/** Runs `work` on each item, a few at a time. */
export async function eachLimited<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
    })
  )
}

const openPaths = (): string[] => useApp.getState().tabs.map((t) => t.path)

export function openWorkspace(workspace: Workspace, replace: boolean): void {
  useApp.getState().openTabs(workspace.paths, replace)
}

/** Saves the open tabs under a name; an existing workspace with that name is replaced. */
export async function saveWorkspace(initial = ''): Promise<void> {
  const paths = openPaths()
  if (!paths.length) return
  const name = (
    await prompt(
      'Save workspace',
      `A name for these ${paths.length} repositories, to open them together later`,
      initial,
      'Save'
    )
  )?.trim()
  if (!name) return
  const list = useWorkspaces.getState().list
  if (
    name !== initial &&
    list.some((w) => w.name === name) &&
    !(await confirm('Replace workspace', `Replace the workspace "${name}"?`, 'Replace', true))
  )
    return
  save([...list.filter((w) => w.name !== name), { name, paths }])
  notify('success', `Saved the workspace ${name}`)
}

async function renameWorkspace(workspace: Workspace): Promise<void> {
  const name = (await prompt('Rename workspace', 'Name', workspace.name, 'Rename'))?.trim()
  if (!name || name === workspace.name) return
  const list = useWorkspaces.getState().list
  if (list.some((w) => w.name === name)) {
    notify('error', `A workspace named "${name}" exists already`)
    return
  }
  save(list.map((w) => (w === workspace ? { ...w, name } : w)))
}

async function deleteWorkspace(workspace: Workspace): Promise<void> {
  const ok = await confirm(
    'Delete workspace',
    `Forget the workspace "${workspace.name}"? The repositories aren't touched.`,
    'Delete',
    true
  )
  if (ok) save(useWorkspaces.getState().list.filter((w) => w !== workspace))
}

export function workspaceMenu(workspace: Workspace): MenuItem[] {
  return [
    { label: 'Open alongside the open tabs', onClick: () => openWorkspace(workspace, false) },
    { label: 'Open, closing the other tabs', onClick: () => openWorkspace(workspace, true) },
    'separator',
    {
      label: 'Update with the open tabs',
      disabled: !openPaths().length,
      onClick: () =>
        save(
          useWorkspaces
            .getState()
            .list.map((w) => (w === workspace ? { ...w, paths: openPaths() } : w))
        )
    },
    { label: 'Rename…', onClick: () => void renameWorkspace(workspace) },
    { label: 'Delete workspace', danger: true, onClick: () => void deleteWorkspace(workspace) }
  ]
}
