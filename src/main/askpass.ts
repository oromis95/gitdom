// Questions of git and ssh (credentials, key passphrases, unknown hosts) answered in GitDom's own
// dialog. Every git command gets GIT_ASKPASS and SSH_ASKPASS pointing to resources/askpass, whose
// script connects back here over a local pipe; the pipe takes only requests with this run's token.
import { randomBytes } from 'crypto'
import { chmod, rm } from 'fs/promises'
import { createServer, type Server, type Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { askpassKind, passwordPromptFor, type AskpassAnswer } from '../shared/askpass'

/** Shows the question to the user: resolves with the answer, or null when cancelled. */
export type AskpassHandler = (prompt: string) => Promise<AskpassAnswer>

/** How long a password given with its username waits for git's next question */
const PASSWORD_WAIT = 2 * 60 * 1000

let server: Server | null = null
let environment: Record<string, string> = {}
/** Password questions already answered by the username dialog, by their exact wording */
const passwords = new Map<string, { value: string; timer: NodeJS.Timeout }>()

export interface AskpassFiles {
  /** askpass.sh, the program git and ssh start */
  script: string
  /** askpass.js, run by `node` */
  helper: string
  /** The Node executable: Electron's own, run as Node by askpass.sh */
  node: string
}

/**
 * Starts listening for questions. The environment it returns to `askpassEnv` is left empty when the
 * user has an askpass program of their own, which then keeps answering.
 */
export async function startAskpass(files: AskpassFiles, ask: AskpassHandler): Promise<void> {
  if (server) return
  if (process.env.GIT_ASKPASS || process.env.SSH_ASKPASS) return
  const id = `gitdom-askpass-${process.pid}-${randomBytes(6).toString('hex')}`
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : join(tmpdir(), `${id}.sock`)
  const token = randomBytes(24).toString('hex')
  // The script must be executable: packaging or unpacking may not keep its mode
  if (process.platform !== 'win32') await chmod(files.script, 0o755).catch(() => undefined)

  server = createServer((socket) => serve(socket, token, ask))
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(pipe, () => resolve())
  })
  environment = {
    GIT_ASKPASS: files.script,
    SSH_ASKPASS: files.script,
    // ssh uses SSH_ASKPASS without a terminal only when asked to, and without needing a DISPLAY
    SSH_ASKPASS_REQUIRE: 'force',
    GITDOM_NODE: files.node,
    GITDOM_ASKPASS_SCRIPT: files.helper,
    GITDOM_ASKPASS_PIPE: pipe,
    GITDOM_ASKPASS_TOKEN: token
  }
}

export async function stopAskpass(): Promise<void> {
  const running = server
  server = null
  environment = {}
  for (const { timer } of passwords.values()) clearTimeout(timer)
  passwords.clear()
  if (!running) return
  const address = running.address()
  await new Promise<void>((resolve) => running.close(() => resolve()))
  if (typeof address === 'string' && process.platform !== 'win32')
    await rm(address, { force: true }).catch(() => undefined)
}

/** Variables for a git command that may ask: empty when the dialog isn't available. */
export function askpassEnv(): Record<string, string> {
  return environment
}

function serve(socket: Socket, token: string, ask: AskpassHandler): void {
  let request = ''
  socket.setEncoding('utf8')
  socket.on('error', () => socket.destroy())
  socket.on('data', (chunk: string) => {
    request += chunk
    const end = request.indexOf('\n')
    if (end < 0) return
    let message: { token?: unknown; prompt?: unknown }
    try {
      message = JSON.parse(request.slice(0, end))
    } catch {
      return void socket.destroy()
    }
    if (message.token !== token || typeof message.prompt !== 'string') return void socket.destroy()
    void answer(message.prompt, ask).then(
      (value) => socket.end(JSON.stringify(value)),
      () => socket.end('null')
    )
  })
}

async function answer(prompt: string, ask: AskpassHandler): Promise<string | null> {
  const known = passwords.get(prompt.trim())
  if (known) {
    clearTimeout(known.timer)
    passwords.delete(prompt.trim())
    return known.value
  }
  const reply = await ask(prompt)
  if (!reply) return null
  if (askpassKind(prompt) === 'username' && reply.password !== undefined) {
    const next = passwordPromptFor(prompt, reply.value)?.trim()
    if (next) {
      const timer = setTimeout(() => passwords.delete(next), PASSWORD_WAIT).unref()
      passwords.set(next, { value: reply.password, timer })
    }
  }
  return reply.value
}
