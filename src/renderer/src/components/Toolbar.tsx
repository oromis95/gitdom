import {
  ArchiveRestore,
  ArchiveX,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Command,
  GitBranchPlus,
  LoaderCircle,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
  Undo2
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PullMode } from '../../../shared/api'
import type { RepoSnapshot } from '../../../shared/types'
import type { RepoTab } from '../store'
import { useApp } from '../store'
import { openMenu, useUi } from '../ui'
import * as actions from '../actions'
import { toggleTerminal, useTerminal } from '../terminal'
import { toggleDetail, toggleDetailDrawer, toggleSidebarDrawer, useTheme } from '../theme'
import { useShortcut, useShortcutLabel } from '../shortcuts'
import RepoSwitcher from './RepoSwitcher'

const LATER = 'Available in a later milestone'

const PULL_MODES: { mode: PullMode; label: string }[] = [
  { mode: 'ff', label: 'Pull (fast-forward if possible)' },
  { mode: 'ff-only', label: 'Pull (fast-forward only)' },
  { mode: 'rebase', label: 'Pull (rebase)' }
]

function Tool({
  label,
  icon,
  onClick,
  disabled,
  title,
  active
}: {
  label: string
  icon: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  active?: boolean
}): React.JSX.Element {
  return (
    <button
      className={`tool${active ? ' active' : ''}`}
      disabled={!onClick || disabled}
      title={onClick ? (title ?? label) : LATER}
      onClick={onClick}
    >
      {icon}
      <span className="tool-label">{label}</span>
    </button>
  )
}

/**
 * Warns when the current branch and the main one changed the same lines: merging or rebasing
 * would stop on conflicts. Checked again whenever either moves.
 */
function MainConflicts({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element | null {
  const main = actions.mainBranchOf(snapshot)
  const head = snapshot.head.hash
  const key = main && head ? `${snapshot.path}:${head}:${main.hash}` : null
  const [found, setFound] = useState<{ key: string; conflicts: string[] } | null>(null)
  useEffect(() => {
    if (!key || !main || !head) return
    let cancelled = false
    void window.api.op(snapshot.path, 'mergePreview', head, main.hash).then((result) => {
      if (!cancelled && result.ok && result.value)
        setFound({ key, conflicts: result.value.conflicts })
    })
    return () => {
      cancelled = true
    }
    // The key covers the repository and both commits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!main || found?.key !== key || !found.conflicts.length) return null
  const count = found.conflicts.length
  return (
    <button
      className="conflict-watch"
      title={`Merging ${main.name} or rebasing onto it would stop on conflicts in:\n${found.conflicts.join('\n')}`}
      onClick={(e) => openMenu(e, actions.mainConflictsMenu(snapshot, main, found.conflicts))}
    >
      <TriangleAlert size={14} />
      {count === 1 ? '1 conflict' : `${count} conflicts`} with {main.name}
    </button>
  )
}

export default function Toolbar({ tab }: { tab: RepoTab }): React.JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const terminalShown = useTerminal((s) => s.shown)
  const layout = useTheme((s) => s.layout)
  const detailHidden = useTheme((s) => s.detailHidden)
  const sidebarOpen = useTheme((s) => s.sidebarOpen)
  const detailClosedFor = useTheme((s) => s.detailClosedFor)
  const snapshot = tab.snapshot
  const head = snapshot?.head
  const branch = head?.branch ?? (head?.hash ? `detached ${head.hash.slice(0, 7)}` : '—')
  const repo = tab.path
  const busy = !!tab.busy
  const pullMode = actions.savedPullMode()
  const topStash = snapshot?.stashes[0]
  const changes = snapshot ? snapshot.status.staged.length + snapshot.status.unstaged.length : 0

  const pullMenu = (e: React.MouseEvent): void =>
    openMenu(e, [
      { label: 'Fetch all', onClick: () => void actions.fetchAll(repo) },
      'separator',
      ...PULL_MODES.map(({ mode, label }) => ({
        label: `${mode === pullMode ? '✓ ' : '   '}${label}`,
        onClick: () => {
          actions.savePullMode(mode)
          void actions.pull(repo, mode)
        }
      }))
    ])

  const history = snapshot?.history
  const canUndo = !!history?.undo && !busy && !snapshot?.operation
  const canRedo = !!history?.redo && !busy && !snapshot?.operation

  // The toolbar's shortcuts, unless typing (text fields keep their own undo) or in a dialog
  const toolKey =
    (enabled: boolean, run: () => unknown) =>
    (e: KeyboardEvent): boolean => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]'))
        return false
      if (document.querySelector('.modal, .menu, .palette') || !enabled) return false
      void run()
      return true
    }
  useShortcut(
    'undo',
    toolKey(canUndo, () => actions.undo(repo))
  )
  useShortcut(
    'redo',
    toolKey(canRedo, () => actions.redo(repo))
  )
  useShortcut(
    'pull',
    toolKey(!busy && !!snapshot, () => actions.pull(repo, pullMode))
  )
  useShortcut(
    'push',
    toolKey(!busy && !!head?.branch, () => actions.push(repo))
  )
  useShortcut(
    'fetch',
    toolKey(!busy && !!snapshot, () => actions.fetchAll(repo))
  )
  useShortcut(
    'branch',
    toolKey(!!head?.hash, () => actions.createBranch(repo, null))
  )
  useShortcut(
    'stash',
    toolKey(changes > 0, () => actions.stash(repo))
  )
  useShortcut(
    'pop',
    toolKey(!!topStash, () => topStash && actions.stashPop(repo, topStash))
  )
  useShortcut(
    'refresh',
    toolKey(true, () => refresh())
  )
  const keys = {
    undo: useShortcutLabel('undo'),
    redo: useShortcutLabel('redo'),
    pull: useShortcutLabel('pull'),
    push: useShortcutLabel('push'),
    branch: useShortcutLabel('branch'),
    stash: useShortcutLabel('stash'),
    pop: useShortcutLabel('pop'),
    refresh: useShortcutLabel('refresh'),
    terminal: useShortcutLabel('terminal'),
    palette: useShortcutLabel('palette')
  }
  const hint = (text: string, key: string): string => (key ? `${text} (${key})` : text)

  const icon = (label: string, node: React.ReactNode): React.ReactNode =>
    tab.busy === label ? <LoaderCircle size={20} className="spin" /> : node

  const crumbs = (
    <>
      <div className="crumb">
        <span className="crumb-label">repository</span>
        <RepoSwitcher name={tab.name} />
      </div>
      <ChevronRight size={20} className="crumb-sep" />
      <div className="crumb">
        <span className="crumb-label">branch</span>
        <span className="crumb-value" style={{ fontWeight: 400 }} title={branch}>
          {branch}
        </span>
      </div>
      {snapshot && <MainConflicts snapshot={snapshot} />}
    </>
  )
  const tools = (
    <>
      <Tool
        label="Undo"
        icon={<Undo2 size={20} />}
        disabled={!canUndo}
        title={history?.undo ? hint(`Undo "${history.undo}"`, keys.undo) : 'Nothing to undo'}
        onClick={() => void actions.undo(repo)}
      />
      <Tool
        label="Redo"
        icon={<Redo2 size={20} />}
        disabled={!canRedo}
        title={history?.redo ? hint(`Redo "${history.redo}"`, keys.redo) : 'Nothing to redo'}
        onClick={() => void actions.redo(repo)}
      />
      <div className="tool-split">
        <Tool
          label="Pull"
          icon={icon('Pulling', <ArrowDownToLine size={20} />)}
          disabled={busy || !snapshot}
          title={hint(PULL_MODES.find((m) => m.mode === pullMode)?.label ?? 'Pull', keys.pull)}
          onClick={() => void actions.pull(repo, pullMode)}
        />
        <button className="tool-arrow" disabled={busy} onClick={pullMenu} aria-label="Pull options">
          {tab.busy === 'Fetching' ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>
      </div>
      <Tool
        label="Push"
        icon={icon('Pushing', <ArrowUpFromLine size={20} />)}
        disabled={busy || !head?.branch}
        title={hint('Push', keys.push)}
        onClick={() => void actions.push(repo)}
      />
      <Tool
        label="Branch"
        icon={<GitBranchPlus size={20} />}
        disabled={!head?.hash}
        title={hint('New branch', keys.branch)}
        onClick={() => void actions.createBranch(repo, null)}
      />
      <Tool
        label="Stash"
        icon={<ArchiveX size={20} />}
        disabled={changes === 0}
        title={hint('Stash', keys.stash)}
        onClick={() => void actions.stash(repo)}
      />
      <Tool
        label="Pop"
        icon={<ArchiveRestore size={20} />}
        disabled={!topStash}
        title={topStash ? hint(`Pop "${topStash.message}"`, keys.pop) : 'No stashes'}
        onClick={() => topStash && void actions.stashPop(repo, topStash)}
      />
      <Tool
        label="Refresh"
        icon={<RefreshCw size={20} />}
        title={hint('Refresh', keys.refresh)}
        onClick={() => void refresh()}
      />
      <Tool
        label="Terminal"
        icon={<SquareTerminal size={20} />}
        title={hint('Terminal in the repository folder', keys.terminal)}
        active={terminalShown}
        onClick={() => toggleTerminal()}
      />
      <Tool
        label="Actions"
        icon={<Command size={20} />}
        title={hint('Command palette', keys.palette)}
        onClick={() => useUi.setState({ palette: true })}
      />
    </>
  )

  if (layout === 'focus') {
    // One slim bar: the drawers' switches at the ends, the tools as icons
    const detailOpen = !!tab.selected && tab.selected !== detailClosedFor
    return (
      <div className="focus-bar">
        <button
          className={`focus-switch${sidebarOpen ? ' active' : ''}`}
          title={sidebarOpen ? 'Hide the branches' : 'Branches, tags, remotes and stashes'}
          aria-pressed={sidebarOpen}
          onClick={() => toggleSidebarDrawer()}
        >
          <PanelLeft size={18} />
        </button>
        {crumbs}
        <div className="toolbar-spacer" />
        {tools}
        <button
          className={`focus-switch${detailOpen ? ' active' : ''}`}
          title={
            !tab.selected
              ? 'Select a commit to see its detail'
              : detailOpen
                ? 'Hide the detail'
                : 'Show the detail'
          }
          aria-pressed={detailOpen}
          disabled={!tab.selected}
          onClick={() => toggleDetailDrawer(tab.selected)}
        >
          {detailOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      </div>
    )
  }

  if (layout === 'studio') {
    return (
      <>
        <nav className="rail">{tools}</nav>
        <div className="studio-header">
          {crumbs}
          <div className="toolbar-spacer" />
          <button
            className="diff-close"
            title={detailHidden ? 'Show the detail panel' : 'Hide the detail panel'}
            onClick={() => toggleDetail()}
          >
            {detailHidden ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="toolbar">
      {crumbs}
      <div className="toolbar-spacer" />
      {tools}
      <div className="toolbar-spacer" />
    </div>
  )
}
