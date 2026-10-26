import { spawn } from 'child_process'
import { gitBinary } from '../settings'
import { askpassEnv } from '../askpass'
import { logCommand } from './activity'

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface RunOptions {
  /** Written to the process stdin */
  input?: string
  /** Exit codes other than 0 that count as success (e.g. 1 for `git diff --no-index`) */
  okExitCodes?: number[]
  /** Appends stderr to the result: push, pull and hooks report their output there */
  withStderr?: boolean
  /** Extra environment variables */
  env?: Record<string, string>
  /** Receives stderr as it arrives, e.g. clone progress */
  onStderr?: (chunk: string) => void
  /** Aborting kills the process; the promise then rejects */
  signal?: AbortSignal
  /** How stdout is decoded: base64 for binary content such as images */
  encoding?: 'utf8' | 'base64'
  /**
   * Receives stdout as it arrives, instead of collecting it: for output too big to hold, such as
   * the whole history with its changed files. The promise then resolves with an empty string.
   */
  onStdout?: (chunk: Buffer) => void
  /**
   * Fails at once when git needs credentials or a passphrase, instead of asking in a dialog: for
   * work nobody is waiting for, such as the periodic fetch.
   */
  noPrompt?: boolean
}

// Options forced on every invocation so output is stable and parseable
// regardless of the user's configuration.
const BASE_ARGS = [
  '-c',
  'core.quotepath=false',
  '-c',
  'i18n.logOutputEncoding=UTF-8',
  '-c',
  'color.ui=false'
]

/**
 * Keeps the last state of each line git rewrote in place with \r (progress output),
 * as a terminal would show it.
 */
export function collapseProgress(text: string): string {
  return text
    .split('\n')
    .map((line) => line.split('\r').filter(Boolean).pop() ?? '')
    .join('\n')
}

/**
 * Runs `git <args>` in `cwd` and resolves with stdout.
 * Rejects with GitError on a non-zero exit code.
 */
export function runGit(cwd: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const logged = logCommand(cwd, args)
    const child = spawn(gitBinary(), [...BASE_ARGS, ...args], {
      cwd,
      windowsHide: true,
      signal: options.signal,
      // Read-only commands (status, log) must not take index.lock and block the user's terminal.
      // There is no terminal to answer prompts in: questions go to GitDom's dialog (askpass.ts),
      // or fail fast when nobody is waiting.
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        ...(options.noPrompt ? {} : askpassEnv()),
        ...options.env
      }
    })

    const out: Buffer[] = []
    const err: Buffer[] = []
    let streamed = 0
    child.stdout.on('data', (chunk: Buffer) => {
      if (!options.onStdout) out.push(chunk)
      else {
        streamed += chunk.length
        options.onStdout(chunk)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err.push(chunk)
      options.onStderr?.(chunk.toString('utf8'))
    })

    child.on('error', (e) => {
      const error = options.signal?.aborted
        ? new GitError('Cancelled', args, null, '')
        : new GitError(`Unable to run git: ${e.message}`, args, null, '')
      logged(null, error.message, false)
      reject(error)
    })
    child.on('close', (code) => {
      if (options.signal?.aborted) {
        logged(null, 'Cancelled', false)
        return reject(new GitError('Cancelled', args, null, ''))
      }
      const stdout = Buffer.concat(out).toString(options.encoding ?? 'utf8')
      const stderr = collapseProgress(Buffer.concat(err).toString('utf8'))
      const ok = code === 0 || (code !== null && !!options.okExitCodes?.includes(code))
      const shown = options.onStdout
        ? `(output read as it arrived, ${streamed} bytes)`
        : options.encoding === 'base64'
          ? `(binary output, ${Buffer.concat(out).length} bytes)`
          : stdout
      logged(code, stderr ? `${shown.trimEnd()}\n${stderr}`.trim() : shown, ok)
      if (ok) {
        resolve(options.withStderr ? (stdout + stderr).trim() : stdout)
      } else {
        const text = (stderr.trim() || stdout.trim()).split('\n')
        // Prefer the line git marks as the actual error over hints and progress output
        const summary =
          text.find((l) => /^(error|fatal):/.test(l)) ?? text[0] ?? `git ${args[0]} failed`
        reject(new GitError(summary, args, code, stderr || stdout))
      }
    })

    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

/** Like runGit but resolves null instead of rejecting on failure. */
export async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(cwd, args)
  } catch {
    return null
  }
}
