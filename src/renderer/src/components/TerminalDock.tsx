import { Suspense, lazy, useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import type { ShellInfo } from '../../../shared/api'
import { useApp } from '../store'
import {
  ensureSession,
  pruneSessions,
  restartSession,
  setShell,
  setTerminalHeight,
  toggleTerminal,
  useTerminal
} from '../terminal'

const TerminalView = lazy(() => import('./TerminalView'))

/** Bottom panel with a terminal per open repository, opened in its folder. */
export default function TerminalDock(): React.JSX.Element | null {
  const { shown, height, shell, sessions } = useTerminal()
  const tab = useApp((s) => s.tabs[s.active])
  const openPaths = useApp((s) => s.tabs.map((t) => t.path).join('|'))
  const [shells, setShells] = useState<ShellInfo[]>([])
  const repo = tab?.snapshot ? tab.path : undefined

  useEffect(() => {
    void window.api.terminal.shells().then(setShells)
  }, [])

  // Ctrl+` (the key left of 1, whatever the keyboard layout) shows and hides the terminal
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'Backquote') {
        e.preventDefault()
        toggleTerminal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (shown && repo) ensureSession(repo)
  }, [shown, repo])

  useEffect(() => pruneSessions(openPaths ? openPaths.split('|') : []), [openPaths])

  const current = shells.find((s) => s.id === shell) ?? shells[0]
  if (!current || !Object.keys(sessions).length) return null

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const onMove = (m: MouseEvent): void => setTerminalHeight(startHeight + startY - m.clientY)
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="terminal-dock" style={{ height, display: shown && repo ? '' : 'none' }}>
      <div className="terminal-resize" onMouseDown={startResize} />
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <span className="muted">{tab?.name}</span>
        <span className="toolbar-spacer" />
        <select value={current.id} title="Shell" onChange={(e) => setShell(e.target.value)}>
          {shells.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          className="diff-close"
          title="Restart the shell"
          onClick={() => repo && restartSession(repo)}
        >
          <RotateCcw size={15} />
        </button>
        <button className="diff-close" title="Hide (Ctrl+`)" onClick={() => toggleTerminal(false)}>
          <X size={16} />
        </button>
      </div>
      <div className="terminal-body">
        <Suspense>
          {Object.entries(sessions).map(([path, generation]) => (
            <TerminalView
              key={`${path}\0${generation}`}
              cwd={path}
              shell={current.id}
              active={shown && path === repo}
            />
          ))}
        </Suspense>
      </div>
    </div>
  )
}
