// The questions git and ssh ask through GIT_ASKPASS / SSH_ASKPASS, and the failures of a remote
// command that needed an answer it couldn't get.

export type AskpassKind = 'username' | 'password' | 'passphrase' | 'hostKey'

export interface AskpassRequest {
  id: number
  kind: AskpassKind
  /** The question as git or ssh wrote it */
  prompt: string
  /** The server or the key file the question is about, for the dialog's title */
  subject: string
}

/**
 * The answer of the dialog: a username question also takes the password, so git's next question
 * is answered without asking again. Null when cancelled.
 */
export type AskpassAnswer = { value: string; password?: string } | null

/** What git or ssh is asking, from the wording of its question. */
export function askpassKind(prompt: string): AskpassKind {
  // "Are you sure you want to continue connecting (yes/no/[fingerprint])?"
  if (/continue connecting|authenticity of host/i.test(prompt)) return 'hostKey'
  // "Enter passphrase for key '/c/Users/me/.ssh/id_ed25519':"
  if (/passphrase/i.test(prompt)) return 'passphrase'
  // "Username for 'https://github.com':"
  if (/^\s*username\b/i.test(prompt)) return 'username'
  // "Password for 'https://me@github.com':", and anything else: kept hidden as it may be a secret
  return 'password'
}

/** The server or key named in the question: `https://github.com`, `id_ed25519`, `github.com`. */
export function askpassSubject(prompt: string): string {
  const host = /authenticity of host '?([^\s'(]+)/i.exec(prompt)?.[1]
  if (host) return host
  const quoted = /'([^']+)'/.exec(prompt)?.[1]
  if (!quoted) return ''
  // A key file: its name is enough; a URL: without the user name
  if (/passphrase/i.test(prompt)) return quoted.split(/[\\/]/).pop() ?? quoted
  return quoted.replace(/^(\w+:\/\/)[^@/]+@/, '$1')
}

/** The URL of a username question, and that of the password question git asks right after it. */
export function passwordPromptFor(usernamePrompt: string, username: string): string | null {
  const url = /'(\w+:\/\/)([^']+)'/.exec(usernamePrompt)
  return url ? `Password for '${url[1]}${username}@${url[2]}': ` : null
}

const AUTH_FAILURES = [
  /could not read (username|password)/i,
  /terminal prompts disabled/i,
  /authentication failed/i,
  /permission denied \(publickey/i,
  /host key verification failed/i,
  /invalid username or password/i,
  /HTTP Basic: Access denied/i
]

/** True when a remote command failed for want of credentials, a passphrase or a trusted host. */
export function isAuthFailure(output: string): boolean {
  return AUTH_FAILURES.some((re) => re.test(output))
}
