import { spawn } from 'child_process'
import { gitBinary } from '../settings'

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
 * Runs `git <args>` in `cwd` and resolves with stdout.
 * Rejects with GitError on a non-zero exit code.
 */
export function runGit(cwd: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitBinary(), [...BASE_ARGS, ...args], {
      cwd,
      windowsHide: true,
      signal: options.signal,
      // Read-only commands (status, log) must not take index.lock and block the user's terminal.
      // Prompts can't be answered without a terminal: fail fast instead of hanging.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', ...options.env }
    })

    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      err.push(chunk)
      options.onStderr?.(chunk.toString('utf8'))
    })

    child.on('error', (e) =>
      reject(
        options.signal?.aborted
          ? new GitError('Cancelled', args, null, '')
          : new GitError(`Unable to run git: ${e.message}`, args, null, '')
      )
    )
    child.on('close', (code) => {
      if (options.signal?.aborted) return reject(new GitError('Cancelled', args, null, ''))
      const stdout = Buffer.concat(out).toString(options.encoding ?? 'utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      if (code === 0 || (code !== null && options.okExitCodes?.includes(code))) {
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
