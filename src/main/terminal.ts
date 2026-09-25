// Integrated terminal: shells running in pseudo-terminals, streamed to the renderer over IPC.
import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { ipcMain, type WebContents } from 'electron'
import { spawn, type IPty } from '@lydell/node-pty'
import { IPC, type Result, type ShellInfo } from '../shared/api'

interface Shell extends ShellInfo {
  file: string
  args: string[]
}

interface Session {
  pty: IPty
  owner: WebContents
}

const sessions = new Map<number, Session>()
let nextId = 1
let shells: Promise<Shell[]> | null = null

/** Git for Windows ships bash next to git: found through git's exec path. */
function gitBash(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['--exec-path'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null)
      // <git>/mingw64/libexec/git-core -> <git>/bin/bash.exe
      const bash = join(stdout.trim(), '..', '..', '..', 'bin', 'bash.exe')
      resolve(existsSync(bash) ? bash : null)
    })
  })
}

async function findShells(): Promise<Shell[]> {
  if (process.platform !== 'win32') {
    const file = process.env.SHELL || '/bin/bash'
    return [{ id: 'default', name: file.split('/').pop()!, file, args: ['-l'] }]
  }
  const system = process.env.SystemRoot ?? 'C:\\Windows'
  const found: Shell[] = [
    {
      id: 'powershell',
      name: 'PowerShell',
      file: join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo']
    }
  ]
  const bash = await gitBash()
  if (bash) found.push({ id: 'bash', name: 'Git Bash', file: bash, args: ['--login', '-i'] })
  found.push({
    id: 'cmd',
    name: 'Command Prompt',
    file: process.env.ComSpec ?? join(system, 'System32', 'cmd.exe'),
    args: []
  })
  return found.filter((s) => existsSync(s.file))
}

function listShells(): Promise<Shell[]> {
  shells ??= findShells()
  return shells
}

function closeSession(id: number): void {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  try {
    session.pty.kill()
  } catch {
    // Already exited
  }
}

/** Sessions belong to a page: reloading or closing it ends them. */
const watchedOwners = new WeakSet<WebContents>()
function watchOwner(owner: WebContents): void {
  if (watchedOwners.has(owner)) return
  watchedOwners.add(owner)
  const closeAll = (): void => {
    for (const [id, session] of sessions) if (session.owner === owner) closeSession(id)
  }
  owner.on('did-start-loading', closeAll)
  owner.on('destroyed', closeAll)
}

async function open(
  owner: WebContents,
  cwd: string,
  shellId: string,
  cols: number,
  rows: number
): Promise<Result<number>> {
  try {
    const available = await listShells()
    const shell = available.find((s) => s.id === shellId) ?? available[0]
    if (!shell) throw new Error('No shell found')
    if (!existsSync(cwd) || !statSync(cwd).isDirectory())
      throw new Error(`Folder not found: ${cwd}`)
    const pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cwd,
      cols: Math.max(cols, 2),
      rows: Math.max(rows, 1),
      env: { ...process.env, TERM_PROGRAM: 'GitDom' } as Record<string, string>
    })
    const id = nextId++
    sessions.set(id, { pty, owner })
    watchOwner(owner)
    pty.onData((data) => {
      if (!owner.isDestroyed()) owner.send(IPC.terminalData, id, data)
    })
    pty.onExit(({ exitCode }) => {
      if (!sessions.delete(id)) return
      if (!owner.isDestroyed()) owner.send(IPC.terminalExit, id, exitCode)
    })
    return { ok: true, value: id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(IPC.terminalShells, async () =>
    (await listShells()).map(({ id, name }): ShellInfo => ({ id, name }))
  )
  ipcMain.handle(
    IPC.terminalOpen,
    (event, cwd: string, shell: string, cols: number, rows: number) =>
      open(event.sender, cwd, shell, cols, rows)
  )
  ipcMain.on(IPC.terminalWrite, (event, id: number, data: string) => {
    owned(event.sender, id)?.pty.write(data)
  })
  ipcMain.on(IPC.terminalResize, (event, id: number, cols: number, rows: number) => {
    try {
      owned(event.sender, id)?.pty.resize(Math.max(cols, 2), Math.max(rows, 1))
    } catch {
      // The process may have just exited
    }
  })
  ipcMain.on(IPC.terminalClose, (event, id: number) => {
    if (owned(event.sender, id)) closeSession(id)
  })
}

/** The session, if the page asking owns it. */
function owned(sender: WebContents, id: number): Session | undefined {
  const session = sessions.get(id)
  return session?.owner === sender ? session : undefined
}

/** Ends every shell, when the app quits. */
export function closeAllTerminals(): void {
  for (const id of [...sessions.keys()]) closeSession(id)
}
