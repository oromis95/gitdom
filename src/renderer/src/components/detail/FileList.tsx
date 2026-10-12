import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { lfsMatcher } from '../../../../shared/lfs'
import type { FileChange } from '../../../../shared/types'
import { useActiveTab, useApp, type CompareTarget, type DiffTarget } from '../../store'
import { notify, openMenu, type MenuItem } from '../../ui'
import { matches } from '../../shortcuts'
import { focusedRow, isMenuKey, moveFocus, openMenuOf, refocusRow } from '../../focus'
import {
  conflictMenu,
  discardFiles,
  ignoreFile,
  lfsPatternFor,
  lfsTrack,
  openInEditor,
  openDiffTool,
  showInFolder,
  stashFiles
} from '../../actions'
import {
  allFiles,
  buildFolders,
  sourceFor,
  type FileView,
  type FolderNode,
  type ListKind
} from './fileListing'
import { FILE_MANAGER } from '../../platform'

/** Renders files as a flat list or a folder tree, with an optional hover action per file and folder. */
export function FileList({
  files,
  kind,
  view = 'path',
  repo,
  hash,
  compare,
  action
}: {
  files: FileChange[]
  kind: ListKind
  view?: FileView
  repo: string
  hash?: string
  compare?: CompareTarget
  /** Hover button, e.g. Stage: applies to one file or to a whole folder */
  action?: { label: string; run: (files: FileChange[]) => void }
}): React.JSX.Element {
  const openDiff = useApp((s) => s.openDiff)
  const inspectFile = useApp((s) => s.inspectFile)
  const activeTab = useActiveTab()
  const activeDiff = activeTab?.diff
  const lfs = activeTab?.snapshot?.lfs
  // Snapshots are new objects on every refresh: the matcher is rebuilt only when the patterns change
  const lfsKey = JSON.stringify(lfs?.patterns ?? [])
  const isLfs = useMemo(() => lfsMatcher(JSON.parse(lfsKey)), [lfsKey])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const tree = useMemo(() => (view === 'tree' ? buildFolders(files) : null), [files, view])

  const isActive = (f: FileChange): boolean =>
    activeDiff?.path === f.path && activeDiff.source.kind === sourceFor(kind, f, hash, compare).kind

  const menuFor = (f: FileChange): MenuItem[] => [
    ...(kind === 'conflicted' ? conflictMenu(repo, [f.path]) : []),
    ...(action && kind !== 'conflicted'
      ? [{ label: action.label, onClick: () => action.run([f]) }]
      : []),
    ...(kind === 'unstaged'
      ? [
          {
            label: f.status === '?' ? 'Delete file' : 'Discard changes',
            danger: true,
            onClick: () => void discardFiles(repo, [f])
          }
        ]
      : []),
    ...(kind === 'unstaged' || kind === 'staged'
      ? [
          'separator' as const,
          { label: 'Stash changes to this file…', onClick: () => void stashFiles(repo, [f]) },
          {
            label: f.status === '?' ? 'Add to .gitignore…' : 'Stop tracking and ignore…',
            disabled: f.status === 'D',
            onClick: () => void ignoreFile(repo, f)
          }
        ]
      : []),
    'separator' as const,
    {
      label: 'Open in diff tool',
      disabled: kind === 'conflicted' || f.status === '?',
      onClick: () => void openDiffTool(repo, sourceFor(kind, f, hash, compare), f.path, f.oldPath)
    },
    {
      label: 'Open in editor',
      disabled: f.status === 'D',
      onClick: () => void openInEditor(repo, f.path)
    },
    {
      label: `Show in ${FILE_MANAGER}`,
      disabled: f.status === 'D',
      onClick: () => showInFolder(repo, f.path)
    },
    'separator' as const,
    ...(f.status !== '?'
      ? [
          {
            label: 'File history',
            onClick: () => inspectFile({ path: f.path, mode: 'history', rev: null })
          },
          {
            label: 'Blame',
            disabled: f.status === 'D' || kind === 'conflicted' || kind === 'compare',
            onClick: () =>
              inspectFile({ path: f.path, mode: 'blame', rev: kind === 'commit' ? hash! : null })
          },
          'separator' as const
        ]
      : []),
    ...(lfs?.installed && !isLfs(f.path)
      ? [
          {
            label: `Track ${lfsPatternFor(f.path)} with LFS`,
            onClick: () => void lfsTrack(repo, lfsPatternFor(f.path))
          },
          'separator' as const
        ]
      : []),
    {
      label: 'Copy file path',
      onClick: () => {
        void navigator.clipboard.writeText(f.path)
        notify('info', 'Copied file path')
      }
    }
  ]

  /** Stages or unstages from the keyboard; the focus goes to the row taking the file's place. */
  const runFromKeyboard = (row: HTMLElement, files: FileChange[]): void => {
    const panel = row.closest('.detail')
    const index = focusedRow(panel, '.file-row')
    action?.run(files)
    refocusRow(panel, '.file-row', index)
  }

  const fileRow = (f: FileChange, depth: number, label: string): React.JSX.Element => {
    const target: DiffTarget = {
      source: sourceFor(kind, f, hash, compare),
      path: f.path,
      oldPath: f.oldPath,
      merge: kind === 'conflicted' || undefined
    }
    return (
      <div
        key={(f.oldPath ?? '') + f.path}
        className={`file-row${isActive(f) ? ' active' : ''}`}
        style={{ paddingLeft: 4 + depth * 16 }}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        tabIndex={0}
        onClick={() => openDiff(target)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter') {
            e.preventDefault()
            openDiff(target)
          } else if (action && kind !== 'conflicted' && matches(e, 'stageFile')) {
            e.preventDefault()
            runFromKeyboard(e.currentTarget, [f])
          } else if (isMenuKey(e)) {
            e.preventDefault()
            openMenuOf(e.currentTarget)
          }
        }}
        onContextMenu={(e) => openMenu(e, menuFor(f))}
      >
        <span className={`file-status status-${f.status}`}>
          {f.status === '?' ? 'A' : f.status}
        </span>
        <span className="file-path">
          <bdi>{label}</bdi>
        </span>
        {isLfs(f.path) && (
          <span className="lfs-badge" title="Stored with Git LFS">
            LFS
          </span>
        )}
        {action && (
          <button
            className="row-action"
            onClick={(e) => {
              e.stopPropagation()
              action.run([f])
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    )
  }

  const folderRows = (node: FolderNode, depth: number): React.JSX.Element[] => {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))
    const rows: React.JSX.Element[] = []
    for (const folder of folders) {
      const isCollapsed = collapsed.has(folder.path)
      const toggle = (): void =>
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (isCollapsed) next.delete(folder.path)
          else next.add(folder.path)
          return next
        })
      rows.push(
        <div
          key={`dir:${folder.path}`}
          className="file-row"
          style={{ paddingLeft: 4 + depth * 16 }}
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (
              e.key === 'Enter' ||
              (e.key === 'ArrowRight' ? isCollapsed : e.key === 'ArrowLeft' && !isCollapsed)
            ) {
              e.preventDefault()
              toggle()
            } else if (action && kind !== 'conflicted' && matches(e, 'stageFile')) {
              e.preventDefault()
              runFromKeyboard(e.currentTarget, allFiles(folder))
            }
          }}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <Folder size={14} className="muted" />
          <span className="file-path">
            <bdi>{folder.name}</bdi>
          </span>
          {action && (
            <button
              className="row-action"
              onClick={(e) => {
                e.stopPropagation()
                action.run(allFiles(folder))
              }}
            >
              {action.label} folder
            </button>
          )}
        </div>
      )
      if (!isCollapsed) rows.push(...folderRows(folder, depth + 1))
    }
    for (const f of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push(fileRow(f, depth, f.path.split('/').pop()!))
    }
    return rows
  }

  return (
    <div onKeyDown={(e) => moveFocus(e, e.currentTarget.closest('.detail'), '.file-row')}>
      {tree ? folderRows(tree, 0) : files.map((f) => fileRow(f, 0, f.path))}
    </div>
  )
}
