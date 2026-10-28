// The token git already has for a host, from its credential helper (Git Credential Manager):
// whoever pushes over HTTPS needs no other login. Never asks: with nothing stored it just fails.
import { spawn } from 'child_process'
import { gitBinary } from '../settings'

export interface Credential {
  username: string
  password: string
}

/** Fields of `git credential` output, one key=value per line. */
export function parseCredential(output: string): Credential | null {
  const fields = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0) fields.set(line.slice(0, at), line.slice(at + 1))
  }
  const password = fields.get('password')
  return password ? { username: fields.get('username') ?? '', password } : null
}

/**
 * Runs `git credential fill` for https://host/path. Not through runGit: its output holds the token,
 * which must not reach the activity log.
 */
export function credentialFill(
  host: string,
  path?: string,
  timeout = 15000
): Promise<Credential | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(gitBinary(), ['-c', 'credential.interactive=false', 'credential', 'fill'], {
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          // Empty: git and ssh ignore them, so no dialog opens
          GIT_ASKPASS: '',
          SSH_ASKPASS: ''
        }
      })
    } catch {
      return resolve(null)
    }
    const out: Buffer[] = []
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.resume()
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? parseCredential(Buffer.concat(out).toString('utf8')) : null)
    })
    // With credential.useHttpPath (set for Azure DevOps) the helper keys its tokens by path too
    child.stdin?.end(`protocol=https\nhost=${host}\n${path ? `path=${path}\n` : ''}\n`)
  })
}
