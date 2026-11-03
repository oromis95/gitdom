// Shared pieces of the file lists: the remembered layout and the diff sources.
import { useState } from 'react'
import type { DiffSource, FileChange } from '../../../../shared/types'
import type { CompareTarget } from '../../store'
import { storage } from '../../storage'

const VIEW_KEY = 'gitdom.fileView'

export type FileView = 'path' | 'tree'

/** The layout of the file lists, the same in every panel and remembered. */
export function useFileView(): [FileView, (view: FileView) => void] {
  const [view, setView] = useState<FileView>(() =>
    storage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'path'
  )
  const change = (next: FileView): void => {
    storage.setItem(VIEW_KEY, next)
    setView(next)
  }
  return [view, change]
}

export type ListKind = 'conflicted' | 'unstaged' | 'staged' | 'commit' | 'compare'

export function sourceFor(
  kind: ListKind,
  file: FileChange,
  hash?: string,
  compare?: CompareTarget
): DiffSource {
  if (kind === 'commit') return { kind: 'commit', hash: hash! }
  if (kind === 'compare') return { kind: 'compare', ...compare! }
  if (kind === 'unstaged' && file.status === '?') return { kind: 'untracked' }
  if (kind === 'conflicted') return { kind: 'unstaged' }
  return { kind }
}

/** Paths to pass to stage/unstage: renames need the old path too. */
export const pathsOf = (files: FileChange[]): string[] =>
  files.flatMap((f) => (f.oldPath && f.oldPath !== f.path ? [f.oldPath, f.path] : [f.path]))
