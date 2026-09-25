// State of the integrated terminal dock: one shell per repository, kept alive while hidden.
import { create } from 'zustand'

const HEIGHT_KEY = 'gitdom.terminalHeight'
const SHELL_KEY = 'gitdom.terminalShell'
export const MIN_HEIGHT = 120

interface TerminalState {
  shown: boolean
  height: number
  /** Shell id for new sessions; null until the shells are known */
  shell: string | null
  /** Repositories with a terminal session, and how many times each was restarted */
  sessions: Record<string, number>
}

export const useTerminal = create<TerminalState>(() => ({
  shown: false,
  height: Number(localStorage.getItem(HEIGHT_KEY)) || 280,
  shell: localStorage.getItem(SHELL_KEY),
  sessions: {}
}))

export function toggleTerminal(show = !useTerminal.getState().shown): void {
  useTerminal.setState({ shown: show })
}

export function setTerminalHeight(height: number): void {
  const clamped = Math.round(Math.max(MIN_HEIGHT, Math.min(height, window.innerHeight * 0.75)))
  localStorage.setItem(HEIGHT_KEY, String(clamped))
  useTerminal.setState({ height: clamped })
}

/** Starts a session for the repository, if it has none. */
export function ensureSession(repo: string): void {
  const { sessions } = useTerminal.getState()
  if (!(repo in sessions)) useTerminal.setState({ sessions: { ...sessions, [repo]: 0 } })
}

/** Replaces the repository's shell with a new one. */
export function restartSession(repo: string): void {
  const { sessions } = useTerminal.getState()
  useTerminal.setState({ sessions: { ...sessions, [repo]: (sessions[repo] ?? 0) + 1 } })
}

/** Ends the sessions of repositories no longer open. */
export function pruneSessions(openRepos: string[]): void {
  const { sessions } = useTerminal.getState()
  const kept = Object.fromEntries(Object.entries(sessions).filter(([r]) => openRepos.includes(r)))
  if (Object.keys(kept).length !== Object.keys(sessions).length) {
    useTerminal.setState({ sessions: kept })
  }
}

/** Switches shell: the open terminals restart with it. */
export function setShell(shell: string): void {
  localStorage.setItem(SHELL_KEY, shell)
  useTerminal.setState({ shell })
}
