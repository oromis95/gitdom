// Files by folder, for the folder view of the file lists.
import type { FileChange } from '../../shared/types'

export interface FolderNode<T = FileChange> {
  name: string
  path: string
  folders: Map<string, FolderNode<T>>
  files: T[]
}

/**
 * The folders of the files. A folder holding only one folder shows as one with it,
 * `src/main/java`, so deep package paths don't push the files out of the panel.
 */
export function buildFolders<T extends { path: string }>(files: T[]): FolderNode<T> {
  const root: FolderNode<T> = { name: '', path: '', folders: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let child = node.folders.get(part)
      if (!child) {
        child = {
          name: part,
          path: node.path ? `${node.path}/${part}` : part,
          folders: new Map(),
          files: []
        }
        node.folders.set(part, child)
      }
      node = child
    }
    node.files.push(file)
  }
  return compact(root)
}

function compact<T>(node: FolderNode<T>): FolderNode<T> {
  for (const [key, child] of node.folders) {
    let folder = child
    while (folder.files.length === 0 && folder.folders.size === 1) {
      const [only] = folder.folders.values()
      folder = { ...only, name: `${folder.name}/${only.name}` }
    }
    node.folders.set(key, compact(folder))
  }
  return node
}

export function allFiles<T>(node: FolderNode<T>): T[] {
  return [...node.files, ...[...node.folders.values()].flatMap(allFiles)]
}
