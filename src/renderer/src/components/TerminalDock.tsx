import { useEffect, useRef, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ShellInfo } from '../../../shared/api'
import { useApp } from '../store'
import { codeFont, useSettings } from '../settings'
import {
  ensureSession,
  pruneSessions,
  restartSession,
  setShell,
  setTerminalHeight,
  toggleTerminal,
  useTerminal
} from '../terminal'

// ANSI colours readable on each theme's background; the rest comes from the CSS variables
const ANSI: Record<'dark' | 'light', ITheme> = {
  dark: {
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc'
  },
  light: {
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f'
  }
}

function themeColors(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  const mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  return {
    ...ANSI[mode],
    background: v('--bg'),
    foreground: v('--code-text'),
    cursor: v('--text'),
    cursorAccent: v('--bg'),
    selectionBackground: v('--accent-soft')
  }
}

const dim = (text: string): string => `\r\n\x1b[2m${text}\x1b[0m\r\n`

/** One shell session, shown in an xterm; ends when unmounted. */
function TerminalView({
  cwd,
  shell,
  active
}: {
  cwd: string
  shell: string
  active: boolean
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<{ term: Terminal; fit: () => void } | null>(null)

  useEffect(() => {
    const host = hostRef.current!
    const api = window.api.terminal
    const term = new Terminal({
      fontFamily: codeFont().family,
      fontSize: codeFont().size,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeColors()
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(host)
    // Hidden terminals have no size: fitting them would shrink the shell to nothing
    const fit = (): void => {
      if (host.offsetWidth > 0 && host.offsetHeight > 0) fitAddon.fit()
    }
    fit()
    termRef.current = { term, fit }

    let id: number | null = null
    let state: 'starting' | 'running' | 'exited' = 'starting'
    let disposed = false
    // Output can arrive before the session id: kept until the id tells whose it is
    let early: { sid: number; data: string }[] = []

    const start = async (): Promise<void> => {
      state = 'starting'
      const result = await api.open(cwd, shell, term.cols, term.rows)
      if (disposed) {
        if (result.ok) api.close(result.value)
        return
      }
      if (!result.ok) {
        state = 'exited'
        term.write(`\x1b[31m${result.error}\x1b[0m` + dim('Press Enter to retry'))
        return
      }
      id = result.value
      state = 'running'
      for (const chunk of early) if (chunk.sid === id) term.write(chunk.data)
      early = []
    }

    const offData = api.onData((sid, data) => {
      if (sid === id) term.write(data)
      else if (state === 'starting') early.push({ sid, data })
    })
    const offExit = api.onExit((sid, exitCode) => {
      if (sid !== id) return
      id = null
      state = 'exited'
      term.write(dim(`Process exited with code ${exitCode}. Press Enter to restart.`))
    })
    term.onData((data) => {
      if (id !== null) api.write(id, data)
      else if (state === 'exited' && data === '\r') {
        term.reset()
        void start()
      }
    })
    term.onResize(({ cols, rows }) => {
      if (id !== null) api.resize(id, cols, rows)
    })

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true
      const key = e.key.toLowerCase()
      // App shortcuts: toggle the terminal, command palette, activity log
      if (e.code === 'Backquote' || (e.shiftKey && (key === 'p' || key === 'l'))) return false
      // Ctrl+C copies when there is a selection, and interrupts otherwise
      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        e.preventDefault()
        return false
      }
      // Left to the browser, whose paste event xterm handles
      if (key === 'v') return false
      return true
    })

    const resizeObserver = new ResizeObserver(() => fit())
    resizeObserver.observe(host)
    const themeObserver = new MutationObserver(() => (term.options.theme = themeColors()))
    themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    const offFont = useSettings.subscribe((s, previous) => {
      if (s.codeFont === previous.codeFont && s.codeFontSize === previous.codeFontSize) return
      term.options.fontFamily = codeFont(s).family
      term.options.fontSize = codeFont(s).size
      fit()
    })

    void start()
    return () => {
      disposed = true
      if (id !== null) api.close(id)
      offData()
      offExit()
      resizeObserver.disconnect()
      themeObserver.disconnect()
      offFont()
      termRef.current = null
      term.dispose()
    }
  }, [cwd, shell])

  useEffect(() => {
    if (!active) return
    // Once visible it has a size again
    const frame = requestAnimationFrame(() => {
      termRef.current?.fit()
      termRef.current?.term.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [active])

  return <div ref={hostRef} className="terminal-host" style={{ display: active ? '' : 'none' }} />
}

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
        {Object.entries(sessions).map(([path, generation]) => (
          <TerminalView
            key={`${path}\0${generation}`}
            cwd={path}
            shell={current.id}
            active={shown && path === repo}
          />
        ))}
      </div>
    </div>
  )
}
