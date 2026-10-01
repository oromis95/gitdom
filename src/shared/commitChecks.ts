// Checks on what is about to be committed: secrets, big files, leftover debug code and the
// message. They only warn: the commit is never blocked.

export type CommitCheckKind = 'secrets' | 'largeFiles' | 'debugCode' | 'message'

export interface CommitWarning {
  kind: CommitCheckKind
  text: string
  /** File and line the warning is about, when it's about one */
  path?: string
  line?: number
}

/** Over this a staged file weighs on every clone, whatever it is */
export const LARGE_FILE = 5 * 1024 * 1024
/** Binaries over this belong in LFS: git stores every version whole */
export const LARGE_BINARY = 512 * 1024

const SECRETS: [RegExp, string][] = [
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'a private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/, 'a GitHub token'],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/, 'a GitLab token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\b[sr]k_live_[0-9A-Za-z]{20,}\b/, 'a Stripe key'],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/, 'an API key'],
  [
    /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\s$<{]{8,}["']/i,
    'a password or key'
  ]
]

/** Files that usually hold credentials, whatever is in them */
const SECRET_FILES: [RegExp, string][] = [
  [/(?:^|\/)\.env(?:\.(?!example|sample|template|dist)[^/]+)?$/i, 'an environment file'],
  [/(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/, 'an SSH private key'],
  [/\.(?:pem|key|p12|pfx|jks|keystore)$/i, 'a key or certificate store']
]

const SCRIPT = /\.(?:[cm]?[jt]sx?|vue|svelte|html?)$/i
const DEBUG: [RegExp, string, RegExp?][] = [
  [/\bconsole\.(?:log|debug|trace)\s*\(/, 'console.log'],
  [/^\s*debugger\s*;?\s*$/, 'debugger', SCRIPT],
  [/\b(?:TODO|FIXME|XXX)\b/, 'a TODO']
]

/** Minified or generated lines are not worth scanning */
const LONGEST_LINE = 2000
/** Past this many warnings of a kind, the rest are summed up */
export const MOST_PER_KIND = 20

function unquote(path: string): string {
  if (!path.startsWith('"')) return path
  try {
    // Git quotes paths with special characters C-style, octal escapes for bytes
    const bytes: number[] = []
    const inner = path.slice(1, -1)
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i]
      if (c !== '\\') {
        bytes.push(...new TextEncoder().encode(c))
        continue
      }
      const next = inner[++i]
      if (/[0-7]/.test(next)) {
        bytes.push(parseInt(inner.slice(i, i + 3), 8))
        i += 2
      } else
        bytes.push(({ n: 10, t: 9, r: 13 } as Record<string, number>)[next] ?? next.charCodeAt(0))
    }
    return new TextDecoder().decode(new Uint8Array(bytes))
  } catch {
    return path.slice(1, -1)
  }
}

/** The lines added by a zero-context diff (`git diff -U0`), with the file and the new line number. */
export function addedLines(diff: string): { path: string; line: number; text: string }[] {
  const added: { path: string; line: number; text: string }[] = []
  let path: string | null = null
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const target = unquote(raw.slice(4))
      path = target === '/dev/null' ? null : target.replace(/^b\//, '')
    } else if (raw.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw)
      line = m ? Number(m[1]) : 0
    } else if (path && raw.startsWith('+')) {
      added.push({ path, line: line++, text: raw.slice(1).replace(/\r$/, '') })
    }
  }
  return added
}

/** Secrets and debug code on the lines a commit adds, and files that usually hold credentials. */
export function scanStaged(
  diff: string,
  paths: string[],
  kinds: { secrets: boolean; debugCode: boolean }
): CommitWarning[] {
  const warnings: CommitWarning[] = []
  if (kinds.secrets) {
    for (const path of paths) {
      const match = SECRET_FILES.find(([re]) => re.test(path))
      if (match) warnings.push({ kind: 'secrets', text: `Looks like ${match[1]}`, path })
    }
  }
  for (const { path, line, text } of addedLines(diff)) {
    if (text.length > LONGEST_LINE) continue
    if (kinds.secrets) {
      const match = SECRETS.find(([re]) => re.test(text))
      if (match) {
        warnings.push({ kind: 'secrets', text: `Looks like ${match[1]}`, path, line })
        continue
      }
    }
    if (kinds.debugCode) {
      const match = DEBUG.find(([re, , files]) => re.test(text) && (!files || files.test(path)))
      if (match) warnings.push({ kind: 'debugCode', text: `Adds ${match[1]}`, path, line })
    }
  }
  return warnings
}

/** A file over the size limits, as staged. */
export function sizeWarning(
  path: string,
  size: number,
  binary: boolean,
  lfs: boolean
): CommitWarning | null {
  const mb = (size / 1024 / 1024).toFixed(1)
  if (binary && !lfs && size > LARGE_BINARY) {
    const weight = size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${mb} MB`
    return { kind: 'largeFiles', text: `Binary file of ${weight}: consider Git LFS`, path }
  }
  if (size > LARGE_FILE) return { kind: 'largeFiles', text: `Large file, ${mb} MB`, path }
  return null
}

const CONVENTIONAL = /^[a-z]+(?:\([^)]*\))?!?: \S/
const VAGUE =
  /^(?:wip|fix|fixes|fixed|update|updates|changes|change|stuff|test|tmp|temp|misc|\.+)$/i

/**
 * The message against common conventions, and against the style of the recent commits: when
 * most of them follow Conventional Commits, a summary that doesn't is pointed out.
 */
export function checkMessage(
  summary: string,
  description: string,
  recentSubjects: string[]
): CommitWarning[] {
  const warnings: CommitWarning[] = []
  const subject = summary.trim()
  if (!subject) return warnings
  const warn = (text: string): number => warnings.push({ kind: 'message', text })
  if (VAGUE.test(subject)) warn('The summary says little: what does the commit change?')
  if (/[^.]\.$/.test(subject)) warn('The summary usually has no period at the end')
  const conventional = recentSubjects.filter((s) => CONVENTIONAL.test(s)).length
  if (
    recentSubjects.length >= 5 &&
    conventional / recentSubjects.length >= 0.7 &&
    !CONVENTIONAL.test(subject) &&
    !/^(?:fixup|squash|amend)! |^Merge |^Revert /.test(subject)
  ) {
    warn('Recent commits start with a type, as in "feat: …" or "fix(scope): …"')
  }
  const long = description.split('\n').filter((l) => l.length > 100 && !/\S{60,}/.test(l)).length
  if (long > 0) {
    warn(`${long} description line${long === 1 ? ' is' : 's are'} over 100 characters`)
  }
  return warnings
}

/** Keeps the first warnings of each kind and sums up the rest. */
export function capWarnings(warnings: CommitWarning[]): CommitWarning[] {
  const counts = new Map<CommitCheckKind, number>()
  const kept: CommitWarning[] = []
  for (const w of warnings) {
    const n = (counts.get(w.kind) ?? 0) + 1
    counts.set(w.kind, n)
    if (n <= MOST_PER_KIND) kept.push(w)
  }
  for (const [kind, n] of counts) {
    if (n > MOST_PER_KIND) kept.push({ kind, text: `… and ${n - MOST_PER_KIND} more` })
  }
  return kept
}
