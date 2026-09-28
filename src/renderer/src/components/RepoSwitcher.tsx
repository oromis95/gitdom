// The repository name in the toolbar: a quick switcher among open tabs, workspaces and recent repositories (REPO-06, REPO-07).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Download,
  Ellipsis,
  FolderOpen,
  Layers,
  Save,
  Search,
  Star
} from 'lucide-react'
import { useApp } from '../store'
import { fuzzyMatch } from '../fuzzy'
import { openMenu, openRepoDialog } from '../ui'
import {
  openWorkspace,
  saveWorkspace,
  useWorkspaces,
  workspaceMenu,
  type Workspace
} from '../workspaces'

type Entry =
  | { kind: 'tab'; index: number; path: string; name: string }
  | { kind: 'workspace'; workspace: Workspace; name: string; path: string }
  | { kind: 'repo'; path: string; name: string; favorite: boolean }

const GROUPS: Record<Entry['kind'], string> = {
  tab: 'Open tabs',
  workspace: 'Workspaces',
  repo: 'Favorites and recent'
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

function Panel({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }): React.JSX.Element {
  const { tabs, active, recent, favorites, openRepo, setActive, toggleFavorite, pickAndOpen } =
    useApp()
  const workspaces = useWorkspaces((s) => s.list)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => {
    const open = new Set(tabs.map((t) => t.path))
    const all: Entry[] = [
      ...tabs.map((t, index): Entry => ({ kind: 'tab', index, path: t.path, name: t.name })),
      ...workspaces.map((workspace): Entry => ({
        kind: 'workspace',
        workspace,
        name: workspace.name,
        path: workspace.paths.map(baseName).join(', ')
      })),
      // Favorites first, then the other recent repositories
      ...[...favorites, ...recent.filter((p) => !favorites.includes(p))]
        .filter((path) => !open.has(path))
        .map((path): Entry => ({
          kind: 'repo',
          path,
          name: baseName(path),
          favorite: favorites.includes(path)
        }))
    ]
    // Keep the groups in order: the name matters more than the path
    return all.filter((e) => !query.trim() || fuzzyMatch(query, `${e.name} ${e.path}`))
  }, [tabs, workspaces, favorites, recent, query])

  useEffect(() => {
    listRef.current?.querySelector('.switcher-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected, entries])

  const choose = (entry: Entry | undefined): void => {
    if (!entry) return
    onClose()
    if (entry.kind === 'tab') setActive(entry.index)
    else if (entry.kind === 'workspace') openWorkspace(entry.workspace, false)
    else void openRepo(entry.path)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setSelected((selected + step + entries.length) % Math.max(entries.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(entries[selected])
    }
  }

  const action = (run: () => void) => () => {
    onClose()
    run()
  }

  return (
    <div
      className="switcher"
      style={{ left: anchor.left, top: anchor.bottom + 4 }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div className="palette-search">
        <Search size={15} />
        <input
          autoFocus
          placeholder="Switch to a repository or workspace…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
        />
      </div>
      <div className="switcher-list" ref={listRef}>
        {entries.length === 0 && <div className="palette-empty">No matching repositories</div>}
        {entries.map((entry, i) => (
          <div key={`${entry.kind}:${entry.name}:${entry.path}`}>
            {entry.kind !== entries[i - 1]?.kind && (
              <div className="switcher-heading">{GROUPS[entry.kind]}</div>
            )}
            <div
              className={`switcher-item${i === selected ? ' selected' : ''}`}
              onMouseMove={() => i !== selected && setSelected(i)}
              onClick={() => choose(entry)}
            >
              {entry.kind === 'workspace' ? (
                <Layers size={14} className="muted" />
              ) : entry.kind === 'tab' && entry.index === active ? (
                <Check size={14} className="switcher-current" />
              ) : (
                <FolderOpen size={14} className="muted" />
              )}
              <span className="switcher-name">{entry.name}</span>
              <span className="switcher-path muted" title={entry.path}>
                {entry.kind === 'workspace'
                  ? `${entry.workspace.paths.length} · ${entry.path}`
                  : entry.path}
              </span>
              {entry.kind === 'repo' && (
                <button
                  className={`recent-action${entry.favorite ? ' favorite' : ''}`}
                  title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(entry.path)
                  }}
                >
                  <Star size={13} fill={entry.favorite ? 'currentColor' : 'none'} />
                </button>
              )}
              {entry.kind === 'workspace' && (
                <button
                  className="recent-action"
                  title="More"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose()
                    openMenu(e, workspaceMenu(entry.workspace))
                  }}
                >
                  <Ellipsis size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="switcher-actions">
        <button className="btn" onClick={action(() => void pickAndOpen())}>
          <FolderOpen size={14} /> Open…
        </button>
        <button className="btn" onClick={action(() => openRepoDialog('clone'))}>
          <Download size={14} /> Clone…
        </button>
        <button
          className="btn"
          disabled={!tabs.length}
          title="Save the open tabs as a workspace, to open them together later"
          onClick={action(() => void saveWorkspace())}
        >
          <Save size={14} /> Save tabs as workspace…
        </button>
      </div>
    </div>
  )
}

export default function RepoSwitcher({ name }: { name: string }): React.JSX.Element {
  const button = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const close = (): void => setAnchor(null)

  // Keep it attached to the button when the window resizes
  useLayoutEffect(() => {
    if (!anchor) return
    const onResize = (): void => setAnchor(button.current?.getBoundingClientRect() ?? null)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', close)
    }
  }, [anchor])

  return (
    <>
      <button
        ref={button}
        className="crumb-value crumb-switcher"
        title={`${name}: switch repository`}
        onClick={() => setAnchor(anchor ? null : (button.current?.getBoundingClientRect() ?? null))}
      >
        <span>{name}</span>
        <ChevronDown size={16} />
      </button>
      {anchor && (
        <div className="switcher-backdrop" onMouseDown={close}>
          <Panel anchor={anchor} onClose={close} />
        </div>
      )}
    </>
  )
}
