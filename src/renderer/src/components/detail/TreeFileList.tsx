import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, Package } from 'lucide-react'
import type { Result } from '../../../../shared/api'
import type { TreeFile } from '../../../../shared/types'
import { useApp } from '../../store'
import { notify, openMenu, type MenuItem } from '../../ui'
import { isMenuKey, moveFocus, openMenuOf } from '../../focus'
import { formatBytes } from '../../statistics'
import { saveFileAt } from '../../actions'
import { buildFolders, type FolderNode } from './fileListing'

/** Most files listed at once while filtering */
const FILTER_LIMIT = 500

/** Every file of a commit as a folder tree, to open one as it was then. */
export function TreeFileList({ repo, hash }: { repo: string; hash: string }): React.JSX.Element {
  const inspectFile = useApp((s) => s.inspectFile)
  const [loaded, setLoaded] = useState<{ hash: string; result: Result<TreeFile[]> } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'treeFiles', hash).then((result) => {
      if (!cancelled) setLoaded({ hash, result })
    })
    return () => {
      cancelled = true
    }
  }, [repo, hash])

  const files = loaded?.hash === hash && loaded.result.ok ? loaded.result.value : null
  const tree = useMemo(() => (files ? buildFolders(files) : null), [files])
  const key = filter.trim().toLowerCase()
  const found = useMemo(
    () => (files && key ? files.filter((f) => f.path.toLowerCase().includes(key)) : null),
    [files, key]
  )

  if (!loaded || loaded.hash !== hash) return <div className="center-message">Loading…</div>
  if (!loaded.result.ok) return <div className="banner-error">{loaded.result.error}</div>

  const open = (f: TreeFile): void => {
    if (f.kind !== 'submodule') inspectFile({ path: f.path, mode: 'file', rev: hash })
  }
  const menuFor = (f: TreeFile): MenuItem[] => [
    { label: 'Show file', disabled: f.kind === 'submodule', onClick: () => open(f) },
    {
      label: 'File history',
      onClick: () => inspectFile({ path: f.path, mode: 'history', rev: null })
    },
    {
      label: 'Blame at this commit',
      disabled: f.kind === 'submodule',
      onClick: () => inspectFile({ path: f.path, mode: 'blame', rev: hash })
    },
    {
      label: 'Save as…',
      disabled: f.kind === 'submodule',
      onClick: () => void saveFileAt(repo, hash, f.path)
    },
    'separator',
    {
      label: 'Copy file path',
      onClick: () => {
        void navigator.clipboard.writeText(f.path)
        notify('info', 'Copied file path')
      }
    }
  ]

  const fileRow = (f: TreeFile, depth: number, label: string): React.JSX.Element => (
    <div
      key={f.path}
      className="file-row"
      style={{ paddingLeft: 4 + depth * 16 }}
      title={f.kind === 'submodule' ? `${f.path} (submodule)` : f.path}
      tabIndex={0}
      onClick={() => open(f)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') {
          e.preventDefault()
          open(f)
        } else if (isMenuKey(e)) {
          e.preventDefault()
          openMenuOf(e.currentTarget)
        }
      }}
      onContextMenu={(e) => openMenu(e, menuFor(f))}
    >
      {f.kind === 'submodule' ? (
        <Package size={14} className="muted" />
      ) : (
        <FileText size={14} className="muted" />
      )}
      <span className="file-path">
        <bdi>{label}</bdi>
      </span>
      <span className="file-size muted">
        {f.kind === 'submodule' ? 'submodule' : formatBytes(f.size)}
      </span>
    </div>
  )

  const folderRows = (node: FolderNode<TreeFile>, depth: number): React.JSX.Element[] => {
    const rows: React.JSX.Element[] = []
    for (const folder of [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const isOpen = expanded.has(folder.path)
      const toggle = (): void =>
        setExpanded((prev) => {
          const next = new Set(prev)
          if (isOpen) next.delete(folder.path)
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
              (e.key === 'ArrowRight' ? !isOpen : e.key === 'ArrowLeft' && isOpen)
            ) {
              e.preventDefault()
              toggle()
            }
          }}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} className="muted" />
          <span className="file-path">
            <bdi>{folder.name}</bdi>
          </span>
        </div>
      )
      if (isOpen) rows.push(...folderRows(folder, depth + 1))
    }
    for (const f of [...node.files].sort((a, b) => a.path.localeCompare(b.path)))
      rows.push(fileRow(f, depth, f.path.split('/').pop()!))
    return rows
  }

  return (
    <div onKeyDown={(e) => moveFocus(e, e.currentTarget.closest('.detail'), '.file-row')}>
      <input
        className="file-filter"
        placeholder={`Filter ${files!.length} files`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {found ? (
        <>
          {found.slice(0, FILTER_LIMIT).map((f) => fileRow(f, 0, f.path))}
          {found.length === 0 && <div className="muted file-filter-note">No files match</div>}
          {found.length > FILTER_LIMIT && (
            <div className="muted file-filter-note">
              {found.length - FILTER_LIMIT} more: type more of the name
            </div>
          )}
        </>
      ) : (
        folderRows(tree!, 0)
      )}
    </div>
  )
}
