// One xterm terminal session: loaded on first use, xterm is a big part of the bundle.
import { useEffect, useRef } from 'react'
import { isAppShortcut } from '../shortcuts'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { codeFont, useSettings } from '../settings'

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
  const mode = v('color-scheme') === 'light' ? 'light' : 'dark'
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
export default function TerminalView({
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
      if (e.type !== 'keydown') return true
      // App shortcuts: toggle the terminal, command palette, activity log
      if (isAppShortcut(e)) return false
      if (!e.ctrlKey || e.altKey) return true
      const key = e.key.toLowerCase()
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
    // Palette themes set their colours as inline styles on <html>
    themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme', 'style'] })
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
