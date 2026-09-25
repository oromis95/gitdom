// Pure parsers for git plumbing output. Kept separate from process execution so they can be unit tested.
import type {
  Blame,
  BlameCommit,
  BlameLine,
  Commit,
  FileChange,
  FileRevision,
  FileStatusCode,
  Identity,
  Ref,
  Remote,
  Stash,
  Submodule,
  SubmoduleState,
  WorkingTreeStatus
} from '../../shared/types'
import type { MergeToolInfo } from '../../shared/api'

export const FIELD = '\x1f'
export const RECORD = '\x1e'

export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f') + '%x1e'

export function parseLog(output: string): Commit[] {
  const commits: Commit[] = []
  for (const record of output.split(RECORD)) {
    const trimmed = record.replace(/^\n/, '')
    if (!trimmed) continue
    const [hash, parents, authorName, authorEmail, authorDate, subject] = trimmed.split(FIELD)
    commits.push({
      hash,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      authorDate: Number(authorDate),
      subject: subject ?? ''
    })
  }
  return commits
}

export const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(*objectname)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)'
].join('%1f')

function parseTrack(track: string): { ahead?: number; behind?: number } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0
  }
}

export function parseRefs(output: string): Ref[] {
  const refs: Ref[] = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const [fullName, objectName, peeled, upstream, track] = line.split(FIELD)
    // Annotated tags point to a tag object; the peeled value is the commit
    const hash = peeled || objectName

    if (fullName.startsWith('refs/heads/')) {
      refs.push({
        fullName,
        name: fullName.slice('refs/heads/'.length),
        type: 'local',
        hash,
        ...(upstream ? { upstream, ...parseTrack(track) } : {})
      })
    } else if (fullName.startsWith('refs/remotes/')) {
      const name = fullName.slice('refs/remotes/'.length)
      if (name.endsWith('/HEAD')) continue
      refs.push({ fullName, name, type: 'remote', hash, remote: name.split('/')[0] })
    } else if (fullName.startsWith('refs/tags/')) {
      refs.push({ fullName, name: fullName.slice('refs/tags/'.length), type: 'tag', hash })
    }
  }
  return refs
}

export const STASH_FORMAT = ['%H', '%gd', '%s'].join('%x1f')

export function parseStashes(output: string): Stash[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, selector, message] = line.split(FIELD)
      return { hash, selector, message }
    })
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

function toStatusCode(c: string): FileStatusCode {
  return (c === '?' ? '?' : c) as FileStatusCode
}

/** Parses `git status --porcelain=v1 -z`. */
export function parseStatus(output: string): WorkingTreeStatus {
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const parts = output.split('\0')

  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const x = entry[0]
    const y = entry[1]
    const path = entry.slice(3)

    if (CONFLICT_CODES.has(x + y)) {
      unstaged.push({ path, status: 'U' })
      continue
    }
    if (x === '?') {
      unstaged.push({ path, status: '?' })
      continue
    }

    // Renames and copies carry the original path in the next NUL-separated field
    let oldPath: string | undefined
    if (x === 'R' || x === 'C') oldPath = parts[++i]

    if (x !== ' ') staged.push({ path, status: toStatusCode(x), ...(oldPath ? { oldPath } : {}) })
    if (y !== ' ') unstaged.push({ path, status: toStatusCode(y) })
  }
  return { staged, unstaged }
}

/** Parses `git diff --name-status -z` / `git diff-tree --name-status -z`. */
export function parseNameStatus(output: string): FileChange[] {
  const files: FileChange[] = []
  const parts = output.split('\0').filter((p) => p !== '')
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i][0] as FileStatusCode
    if (code === 'R' || code === 'C') {
      files.push({ status: code, oldPath: parts[i + 1], path: parts[i + 2] })
      i += 2
    } else {
      files.push({ status: code, path: parts[i + 1] })
      i += 1
    }
  }
  return files
}

/** Parses `git remote -v` ("origin\thttps://… (fetch)"). */
export function parseRemotes(output: string): Remote[] {
  const remotes = new Map<string, Remote>()
  for (const line of output.split('\n')) {
    const match = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line.trim())
    if (!match) continue
    const [, name, url, kind] = match
    const remote = remotes.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
    if (kind === 'fetch') remote.fetchUrl = url
    else remote.pushUrl = url
    remotes.set(name, remote)
  }
  return [...remotes.values()]
}

/** Log format for parseFileLog: records start with RECORD, so the file list trailing each one stays in it. */
export const FILE_LOG_FORMAT =
  '%x1e' + ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f') + '%x1f'

/**
 * Parses `git log --follow --name-status -z --format=FILE_LOG_FORMAT -- path`, newest first.
 * Merges come without a file list: they keep the path of the newer commit.
 */
export function parseFileLog(output: string, path: string): FileRevision[] {
  const revisions: FileRevision[] = []
  let current = path
  for (const record of output.split(RECORD)) {
    if (!record.trim()) continue
    const fields = record.split(FIELD)
    const [hash, parents, authorName, authorEmail, authorDate, subject] = fields
    const files = fields
      .slice(6)
      .join(FIELD)
      .split('\0')
      .map((p) => p.replace(/^\n+/, ''))
    const [code, first, second] = files.filter((p) => p !== '')
    const revision: FileRevision = {
      hash,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      authorDate: Number(authorDate),
      subject: subject ?? '',
      path: current
    }
    if (code) {
      revision.status = code[0] as FileStatusCode
      if ((code[0] === 'R' || code[0] === 'C') && second) {
        revision.oldPath = first
        revision.path = second
      } else if (first) revision.path = first
    }
    revisions.push(revision)
    // Older commits know the file by its name before the rename
    current = revision.oldPath ?? revision.path
  }
  return revisions
}

/** The hash git blame gives lines that aren't committed yet. */
const UNCOMMITTED_RE = /^0{40}(0{24})?$/

/** Parses `git blame --porcelain`. */
export function parseBlame(output: string, path: string): Blame {
  const commits: Record<string, BlameCommit> = {}
  const lines: BlameLine[] = []
  let commit: BlameCommit | null = null
  let lineNo = 0
  for (const line of output.split('\n')) {
    if (line.startsWith('\t')) {
      // The content line closes each entry; CRLF files keep their \r
      if (commit) lines.push({ hash: commit.hash, lineNo, text: line.slice(1).replace(/\r$/, '') })
      continue
    }
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(line)
    if (header) {
      const hash = header[1]
      lineNo = Number(header[2])
      commit = commits[hash] ??= {
        hash,
        authorName: '',
        authorEmail: '',
        authorDate: 0,
        summary: '',
        path,
        uncommitted: UNCOMMITTED_RE.test(hash)
      }
      continue
    }
    if (!commit) continue
    const space = line.indexOf(' ')
    const key = space < 0 ? line : line.slice(0, space)
    const value = space < 0 ? '' : line.slice(space + 1)
    if (key === 'author') commit.authorName = value
    else if (key === 'author-mail') commit.authorEmail = value.replace(/^<|>$/g, '')
    else if (key === 'author-time') commit.authorDate = Number(value)
    else if (key === 'summary') commit.summary = value
    else if (key === 'filename') commit.path = value
    else if (key === 'previous') {
      const cut = value.indexOf(' ')
      if (cut > 0) commit.previous = { hash: value.slice(0, cut), path: value.slice(cut + 1) }
    }
  }
  return { path, commits, lines }
}

/**
 * Parses `git submodule status` with the `path` and `url` entries of
 * `git config -f .gitmodules --get-regexp`, which give the names and urls.
 */
export function parseSubmodules(status: string, config: string): Submodule[] {
  const byPath = new Map<string, { name: string; url: string }>()
  const urls = new Map<string, string>()
  for (const line of config.split('\n')) {
    const match = /^submodule\.(.+)\.(path|url) (.*)$/.exec(line.trim())
    if (!match) continue
    const [, name, key, value] = match
    if (key === 'url') urls.set(name, value)
    else byPath.set(value, { name, url: '' })
  }
  for (const entry of byPath.values()) entry.url = urls.get(entry.name) ?? ''

  const states: Record<string, SubmoduleState> = {
    '-': 'uninitialized',
    ' ': 'clean',
    '+': 'moved',
    U: 'conflict'
  }
  const submodules: Submodule[] = []
  for (const line of status.split('\n')) {
    const match = /^([ +\-U])([0-9a-f]{40,64}) (.+?)(?: \([^()]*\))?$/.exec(line)
    if (!match) continue
    const [, flag, hash, path] = match
    const entry = byPath.get(path)
    submodules.push({
      name: entry?.name ?? path,
      path,
      url: entry?.url ?? '',
      hash,
      state: states[flag]
    })
  }
  return submodules
}

/** Patterns stored with Git LFS in a .gitattributes file. */
export function parseLfsPatterns(gitattributes: string): string[] {
  const patterns: string[] = []
  for (const line of gitattributes.split(/\r?\n/)) {
    const [pattern, ...attributes] = line.trim().split(/\s+/)
    if (pattern && !pattern.startsWith('#') && attributes.includes('filter=lfs')) {
      patterns.push(pattern)
    }
  }
  return patterns
}

/** Parses `git config --show-scope --get-regexp ^user\.(name|email)$`: later levels win. */
export function parseIdentity(output: string): Identity {
  const identity: Identity = { name: null, email: null, scope: null }
  const rank = { system: 1, global: 2, local: 3 }
  let best = 0
  for (const line of output.split('\n')) {
    const match = /^(\w+)\tuser\.(name|email) (.*)$/.exec(line.replace(/\r$/, ''))
    if (!match) continue
    const [, scope, key, value] = match
    identity[key as 'name' | 'email'] = value
    const level = rank[scope as keyof typeof rank] ?? 0
    if (level > best) {
      best = level
      identity.scope = scope as Identity['scope']
    }
  }
  return identity
}

// Tools that run inside a terminal: GitDom has none to give them
const TERMINAL_TOOLS = /^(g?vimdiff\d|vimdiff|nvimdiff\d?|emerge)$/

/** Parses `git mergetool --tool-help`: tools found on this machine first, then the known ones. */
export function parseMergeTools(output: string): MergeToolInfo[] {
  const tools: MergeToolInfo[] = []
  let section: 'available' | 'unavailable' | null = null
  for (const raw of output.split(/\r?\n/)) {
    if (/may be set to one of the following/.test(raw)) section = 'available'
    else if (/valid, but not currently available/.test(raw)) section = 'unavailable'
    else if (/^\S/.test(raw)) section = null
    else if (section && raw.trim()) {
      const [, name, label] = /^\s+(\S+)\s*(.*)$/.exec(raw) ?? []
      if (!name || TERMINAL_TOOLS.test(name)) continue
      tools.push({
        name,
        // "Use Meld (requires a graphical session) with optional `auto merge` (see ...)" → "Meld"
        label:
          label
            .replace(/\s*\(requires a graphical session\)/, '')
            .replace(/^Use /, '')
            .replace(/\s+(with|where|\(see)\s.*$/, '') || name,
        available: section === 'available'
      })
    }
  }
  return tools
}
