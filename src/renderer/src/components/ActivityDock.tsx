// Activity log dock (UI-09, NFR-07): the git commands GitDom ran, grouped by the action that ran
// them, newest first, with duration, exit code and output.
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Copy, Trash2, X } from 'lucide-react'
import type { ActivityEntry } from '../../../shared/api'
import {
  clearActivity,
  commandLine,
  failed,
  setActivityHeight,
  setShowBackground,
  toggleActivity,
  useActivity
} from '../activity'
import { notify } from '../ui'

interface Group {
  key: string
  /** null for a background command, shown on its own */
  label: string | null
  repo: string
  entries: ActivityEntry[]
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

const time = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

const duration = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

/** Actions with their commands, and background commands on their own, newest first. */
function groupEntries(entries: ActivityEntry[], background: boolean): Group[] {
  const groups: Group[] = []
  const actions = new Map<number, Group>()
  for (const e of entries) {
    if (e.actionId === null) {
      if (background) groups.push({ key: `c${e.id}`, label: null, repo: e.repo, entries: [e] })
      continue
    }
    let group = actions.get(e.actionId)
    if (!group) {
      group = { key: `a${e.actionId}`, label: e.action, repo: e.repo, entries: [] }
      actions.set(e.actionId, group)
      groups.push(group)
    }
    group.entries.push(e)
  }
  return groups.reverse()
}

function Command({ entry }: { entry: ActivityEntry }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const line = commandLine(entry)
  return (
    <div className={`activity-command${failed(entry) ? ' failed' : ''}`}>
      <div className="activity-command-row" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <code className="activity-line" title={line}>
          {line}
        </code>
        <span className="activity-meta">
          {entry.ok ? '' : entry.exitCode === null ? 'not run · ' : `exit ${entry.exitCode} · `}
          {duration(entry.duration)}
        </span>
        <button
          className="graph-tool"
          title="Copy the command"
          onClick={(e) => {
            e.stopPropagation()
            void navigator.clipboard.writeText(line).then(() => notify('info', 'Command copied'))
          }}
        >
          <Copy size={12} />
        </button>
      </div>
      {open && (
        <pre className="activity-output">
          {entry.output || <span className="muted">(no output)</span>}
          {entry.truncated && <span className="muted">{'\n'}… output cut</span>}
        </pre>
      )}
    </div>
  )
}

function GroupRow({ group }: { group: Group }): React.JSX.Element {
  const hasFailure = group.entries.some(failed)
  const [open, setOpen] = useState(hasFailure)
  const first = group.entries[0]
  const last = group.entries[group.entries.length - 1]

  if (group.label === null) {
    return (
      <div className="activity-group background">
        <span className="activity-time">{time(first.start)}</span>
        <span className="activity-repo">{baseName(group.repo)}</span>
        <Command entry={first} />
      </div>
    )
  }
  return (
    <div className={`activity-group${hasFailure ? ' failed' : ''}`}>
      <div className="activity-group-row" onClick={() => setOpen(!open)}>
        <span className="activity-time">{time(first.start)}</span>
        {hasFailure ? (
          <CircleAlert size={14} className="activity-bad" />
        ) : (
          <CircleCheck size={14} className="activity-good" />
        )}
        <span className="activity-label">{group.label}</span>
        <span className="activity-repo">{baseName(group.repo)}</span>
        <span className="activity-meta">
          {group.entries.length} command{group.entries.length === 1 ? '' : 's'} ·{' '}
          {duration(last.start + last.duration - first.start)}
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>
      {open && (
        <div className="activity-commands">
          {group.entries.map((e) => (
            <Command key={e.id} entry={e} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ActivityDock(): React.JSX.Element | null {
  const { shown, height, entries, background } = useActivity()
  const groups = useMemo(() => groupEntries(entries, background), [entries, background])

  // Ctrl+Shift+L shows and hides the log; the View menu only displays the shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        toggleActivity()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!shown) return null

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const onMove = (m: MouseEvent): void => setActivityHeight(startHeight + startY - m.clientY)
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="activity-dock" style={{ height }}>
      <div className="terminal-resize" onMouseDown={startResize} />
      <div className="terminal-header">
        <span className="terminal-title">Activity</span>
        <span className="muted">Git commands run by GitDom, newest first</span>
        <span className="toolbar-spacer" />
        <label className="graph-only" title="Refreshes and reads GitDom runs by itself">
          <input
            type="checkbox"
            checked={background}
            onChange={(e) => setShowBackground(e.target.checked)}
          />
          Background commands
        </label>
        <button className="diff-close" title="Clear the log" onClick={clearActivity}>
          <Trash2 size={14} />
        </button>
        <button
          className="diff-close"
          title="Hide (Ctrl+Shift+L)"
          onClick={() => toggleActivity(false)}
        >
          <X size={16} />
        </button>
      </div>
      <div className="activity-body">
        {groups.length ? (
          groups.map((g) => <GroupRow key={g.key} group={g} />)
        ) : (
          <div className="activity-empty muted">
            Nothing yet: the commands of your next action will show here.
          </div>
        )}
      </div>
    </div>
  )
}
