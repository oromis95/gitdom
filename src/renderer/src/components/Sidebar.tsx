import { useMemo, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  EyeOff,
  File,
  Folder,
  GitBranch,
  Globe,
  HardDrive,
  Laptop,
  Package,
  Plus,
  Search,
  Tag,
  TriangleAlert
} from 'lucide-react'
import type { Ref, RepoSnapshot, SubmoduleState } from '../../../shared/types'
import { useApp } from '../store'
import { openMenu } from '../ui'
import * as actions from '../actions'
import { roomBeside, updateSettings } from '../settings'
import ResizeHandle from './ResizeHandle'

const SUBMODULE_STATES: Record<SubmoduleState, string> = {
  uninitialized: 'not initialized',
  clean: 'up to date',
  moved: 'changed',
  conflict: 'conflict'
}

interface TreeNode {
  name: string
  children: Map<string, TreeNode>
  ref?: Ref
}

/** Builds a folder tree from slash-separated branch names (feature/x → feature › x). */
function buildTree(refs: Ref[], nameOf: (r: Ref) => string): TreeNode {
  const root: TreeNode = { name: '', children: new Map() }
  for (const ref of refs) {
    const parts = nameOf(ref).split('/')
    let node = root
    parts.forEach((part, i) => {
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, children: new Map() }
        node.children.set(part, child)
      }
      if (i === parts.length - 1) child.ref = ref
      node = child
    })
  }
  return root
}

function Tree({
  node,
  depth,
  leafIcon,
  snapshot
}: {
  node: TreeNode
  depth: number
  leafIcon: React.ReactNode
  snapshot: RepoSnapshot
}): React.JSX.Element {
  const currentBranch = snapshot.head.branch
  const select = useApp((s) => s.select)
  const graphFilter = useApp((s) => s.graphFilters[snapshot.path])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const entries = [...node.children.values()].sort((a, b) => {
    // Folders first, then alphabetical
    const aFolder = a.children.size > 0 && !a.ref
    const bFolder = b.children.size > 0 && !b.ref
    if (aFolder !== bFolder) return aFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return (
    <>
      {entries.map((child) => {
        const pad = { paddingLeft: 12 + depth * 16 }
        if (child.children.size > 0 && !child.ref) {
          const isCollapsed = collapsed.has(child.name)
          const toggle = (): void =>
            setCollapsed((prev) => {
              const next = new Set(prev)
              if (isCollapsed) next.delete(child.name)
              else next.add(child.name)
              return next
            })
          return (
            <div key={child.name}>
              <button className="tree-item" style={pad} onClick={toggle}>
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <Folder size={14} />
                <span>{child.name}</span>
              </button>
              {!isCollapsed && (
                <Tree node={child} depth={depth + 1} leafIcon={leafIcon} snapshot={snapshot} />
              )}
            </div>
          )
        }
        const ref = child.ref!
        const isCurrent = ref.type === 'local' && ref.name === currentBranch
        // Branches the graph leaves out (GRAPH-14); tags follow their commits
        const hidden =
          ref.type !== 'tag' &&
          !!graphFilter &&
          (graphFilter.solo
            ? graphFilter.solo !== ref.fullName
            : graphFilter.hidden.includes(ref.fullName))
        return (
          <button
            key={child.name}
            className={`tree-item${isCurrent ? ' current' : ''}${hidden ? ' hidden-in-graph' : ''}`}
            style={pad}
            title={ref.name}
            onClick={() => select(ref.hash, true)}
            onDoubleClick={() => {
              if (ref.type === 'local' && !isCurrent)
                void actions.checkoutBranch(snapshot.path, ref.name)
              else if (ref.type === 'remote')
                void actions.checkoutRemoteBranch(snapshot.path, snapshot, ref)
            }}
            onContextMenu={(e) => openMenu(e, actions.refMenu(snapshot, ref))}
          >
            {isCurrent ? <Check size={14} /> : leafIcon}
            <span>{child.name}</span>
            {!!(ref.ahead || ref.behind) && (
              <span className="tree-badge">
                {ref.ahead ? `↑${ref.ahead}` : ''} {ref.behind ? `↓${ref.behind}` : ''}
              </span>
            )}
            {hidden && (
              <EyeOff size={13} className="tree-hidden" aria-label="Hidden in the graph" />
            )}
          </button>
        )
      })}
    </>
  )
}

function Section({
  title,
  icon,
  count,
  onAdd,
  children
}: {
  title: string
  icon: React.ReactNode
  count: number
  /** Shows a + button in the header, e.g. to create a branch */
  onAdd?: { title: string; run: () => void }
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button className="section-header" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        {icon}
        {title}
        <span className="section-count">{count}</span>
        {onAdd && (
          <span
            role="button"
            className="section-add"
            title={onAdd.title}
            onClick={(e) => {
              e.stopPropagation()
              onAdd.run()
            }}
          >
            <Plus size={15} />
          </span>
        )}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

export default function Sidebar({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const select = useApp((s) => s.select)
  const openRepo = useApp((s) => s.openRepo)
  const [filter, setFilter] = useState('')

  const { locals, remotes, tags, stashes, submodules, lfsPatterns } = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const match = (name: string): boolean => !q || name.toLowerCase().includes(q)
    return {
      locals: snapshot.refs.filter((r) => r.type === 'local' && match(r.name)),
      remotes: snapshot.refs.filter((r) => r.type === 'remote' && match(r.name)),
      tags: snapshot.refs.filter((r) => r.type === 'tag' && match(r.name)),
      stashes: snapshot.stashes.filter((s) => match(s.message)),
      submodules: snapshot.submodules.filter((s) => match(s.path)),
      lfsPatterns: snapshot.lfs.patterns.filter(match)
    }
  }, [snapshot, filter])

  // Configured remotes show up even before their first fetch
  const remoteNames = [
    ...new Set([
      ...(filter ? [] : snapshot.remotes.map((r) => r.name)),
      ...remotes.map((r) => r.remote!)
    ])
  ].sort()

  return (
    <aside className="sidebar">
      <ResizeHandle
        edge="right"
        min={180}
        max={() => Math.min(window.innerWidth * 0.4, roomBeside('.detail', 180))}
        onResize={(width) => updateSettings({ sidebarWidth: width })}
      />
      <div className="sidebar-filter">
        <Search size={14} className="muted" />
        <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="sidebar-scroll">
        <Section
          title="Local"
          icon={<Laptop size={15} />}
          count={locals.length}
          onAdd={
            snapshot.head.hash
              ? {
                  title: 'Create branch',
                  run: () => void actions.createBranch(snapshot.path, null)
                }
              : undefined
          }
        >
          <Tree
            node={buildTree(locals, (r) => r.name)}
            depth={0}
            leafIcon={<GitBranch size={14} />}
            snapshot={snapshot}
          />
        </Section>

        <Section
          title="Remote"
          icon={<Cloud size={15} />}
          count={remotes.length}
          onAdd={{ title: 'Add remote', run: () => void actions.addRemote(snapshot.path) }}
        >
          {remoteNames.map((remote) => (
            <div key={remote}>
              <div
                className="tree-item"
                style={{ paddingLeft: 12 }}
                onContextMenu={(e) => openMenu(e, actions.remoteMenu(snapshot, remote))}
              >
                <Globe size={14} />
                <span>{remote}</span>
              </div>
              <Tree
                node={buildTree(
                  remotes.filter((r) => r.remote === remote),
                  (r) => r.name.slice(remote.length + 1)
                )}
                depth={1}
                leafIcon={<GitBranch size={14} />}
                snapshot={snapshot}
              />
            </div>
          ))}
        </Section>

        <Section title="Stashes" icon={<Archive size={15} />} count={stashes.length}>
          {stashes.map((s) => (
            <button
              key={s.selector}
              className="tree-item"
              title={s.message}
              onClick={() => select(s.hash, true)}
              onContextMenu={(e) => openMenu(e, actions.stashMenu(snapshot, s))}
            >
              <Archive size={14} />
              <span>{s.message}</span>
            </button>
          ))}
        </Section>

        <Section title="Tags" icon={<Tag size={15} />} count={tags.length}>
          <Tree
            node={buildTree(tags, (r) => r.name)}
            depth={0}
            leafIcon={<Tag size={14} />}
            snapshot={snapshot}
          />
        </Section>

        {snapshot.submodules.length > 0 && (
          <Section title="Submodules" icon={<Package size={15} />} count={submodules.length}>
            {submodules.map((sub) => (
              <button
                key={sub.path}
                className="tree-item"
                title={`${sub.path}\n${sub.url}\n${sub.hash.slice(0, 7)} ${SUBMODULE_STATES[sub.state]}`}
                onDoubleClick={() => {
                  if (sub.state === 'uninitialized')
                    void actions.updateSubmodules(snapshot.path, [sub.path])
                  else void openRepo(actions.submodulePath(snapshot.path, sub))
                }}
                onContextMenu={(e) => openMenu(e, actions.submoduleMenu(snapshot, sub))}
              >
                <Package size={14} />
                <span>{sub.path}</span>
                {sub.state !== 'clean' && (
                  <span className={`tree-badge submodule-${sub.state}`}>
                    {SUBMODULE_STATES[sub.state]}
                  </span>
                )}
              </button>
            ))}
          </Section>
        )}

        {/* Shown once LFS is in use: tracking starts from a file menu or the palette */}
        {snapshot.lfs.patterns.length > 0 && (
          <Section
            title="LFS"
            icon={<HardDrive size={15} />}
            count={lfsPatterns.length}
            onAdd={
              snapshot.lfs.installed
                ? { title: 'Track files with LFS', run: () => void actions.lfsTrack(snapshot.path) }
                : undefined
            }
          >
            {!snapshot.lfs.installed && (
              <div className="tree-item sidebar-warning" title="Install Git LFS from git-lfs.com">
                <TriangleAlert size={14} />
                <span>Git LFS is not installed</span>
              </div>
            )}
            {lfsPatterns.map((pattern) => (
              <div
                key={pattern}
                className="tree-item"
                title={`Files matching ${pattern} are stored with LFS`}
                onContextMenu={(e) =>
                  snapshot.lfs.installed &&
                  openMenu(e, [
                    {
                      label: `Stop tracking ${pattern}`,
                      onClick: () => void actions.lfsUntrack(snapshot.path, pattern)
                    }
                  ])
                }
              >
                <File size={14} />
                <span>{pattern}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </aside>
  )
}
