import { useEffect } from 'react'
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
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RefreshCw,
  SquareTerminal,
  Undo2
} from 'lucide-react'
import type { PullMode } from '../../../shared/api'
import type { RepoTab } from '../store'
import { useApp } from '../store'
import { openMenu, useUi } from '../ui'
import * as actions from '../actions'
import { toggleTerminal, useTerminal } from '../terminal'
import { toggleDetail, useTheme } from '../theme'

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
      {label}
    </button>
  )
}

export default function Toolbar({ tab }: { tab: RepoTab }): React.JSX.Element {
  const refresh = useApp((s) => s.refresh)
  const terminalShown = useTerminal((s) => s.shown)
  const studio = useTheme((s) => s.studio)
  const detailHidden = useTheme((s) => s.detailHidden)
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

  // Ctrl+Z / Ctrl+Y, unless typing: text fields keep their own undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]')) return
      if (document.querySelector('.modal, .menu, .palette')) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey && canUndo) {
        e.preventDefault()
        void actions.undo(repo)
      } else if ((key === 'y' || (key === 'z' && e.shiftKey)) && canRedo) {
        e.preventDefault()
        void actions.redo(repo)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repo, canUndo, canRedo])

  const icon = (label: string, node: React.ReactNode): React.ReactNode =>
    tab.busy === label ? <LoaderCircle size={20} className="spin" /> : node

  const crumbs = (
    <>
      <div className="crumb">
        <span className="crumb-label">repository</span>
        <span className="crumb-value" title={tab.name}>
          {tab.name}
        </span>
      </div>
      <ChevronRight size={20} className="crumb-sep" />
      <div className="crumb">
        <span className="crumb-label">branch</span>
        <span className="crumb-value" style={{ fontWeight: 400 }} title={branch}>
          {branch}
        </span>
      </div>
    </>
  )
  const tools = (
    <>
      <Tool
        label="Undo"
        icon={<Undo2 size={20} />}
        disabled={!canUndo}
        title={history?.undo ? `Undo "${history.undo}" (Ctrl+Z)` : 'Nothing to undo'}
        onClick={() => void actions.undo(repo)}
      />
      <Tool
        label="Redo"
        icon={<Redo2 size={20} />}
        disabled={!canRedo}
        title={history?.redo ? `Redo "${history.redo}" (Ctrl+Y)` : 'Nothing to redo'}
        onClick={() => void actions.redo(repo)}
      />
      <div className="tool-split">
        <Tool
          label="Pull"
          icon={icon('Pulling', <ArrowDownToLine size={20} />)}
          disabled={busy || !snapshot}
          title={PULL_MODES.find((m) => m.mode === pullMode)?.label}
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
        onClick={() => void actions.push(repo)}
      />
      <Tool
        label="Branch"
        icon={<GitBranchPlus size={20} />}
        disabled={!head?.hash}
        onClick={() => void actions.createBranch(repo, null)}
      />
      <Tool
        label="Stash"
        icon={<ArchiveX size={20} />}
        disabled={changes === 0}
        onClick={() => void actions.stash(repo)}
      />
      <Tool
        label="Pop"
        icon={<ArchiveRestore size={20} />}
        disabled={!topStash}
        title={topStash ? `Pop "${topStash.message}"` : 'No stashes'}
        onClick={() => topStash && void actions.stashPop(repo, topStash)}
      />
      <Tool label="Refresh" icon={<RefreshCw size={20} />} onClick={() => void refresh()} />
      <Tool
        label="Terminal"
        icon={<SquareTerminal size={20} />}
        title="Terminal in the repository folder (Ctrl+`)"
        active={terminalShown}
        onClick={() => toggleTerminal()}
      />
      <Tool
        label="Actions"
        icon={<Command size={20} />}
        title="Command palette (Ctrl+P)"
        onClick={() => useUi.setState({ palette: true })}
      />
    </>
  )

  if (studio) {
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
