// Repository operations exposed to the renderer through the `repo:op` IPC channel.
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import type {
  CommitsToMove,
  MergeMode,
  OpArgs,
  OpName,
  OpOutcome,
  OpResult,
  RebaseStep,
  ResetMode,
  StashMode
} from '../../shared/api'
import {
  LARGE_BINARY,
  capWarnings,
  scanStaged,
  sizeWarning,
  type CommitWarning
} from '../../shared/commitChecks'
import { lineBefore, parseDiff } from '../../shared/diff'
import { parseCheckIgnore } from '../../shared/ignore'
import {
  FILE_LOG_FORMAT,
  REFLOG_FORMAT,
  parseBlame,
  parseFileLog,
  parseLineLog,
  parseNameStatus,
  parseReflog,
  parseTreeFiles,
  withNumstat
} from './parsers'
import type { DiffOptions, FileContent, FileDiff, ImagePair } from '../../shared/types'
import { GitError, runGit, tryGit } from './exec'
import { toolSettings } from '../settings'
import {
  COMMIT_LIMIT,
  COMMIT_PAGE,
  loadCommits,
  loadCommitDetail,
  loadStatus,
  logRevisions,
  readOperation,
  signingProgramArgs
} from './repository'
import * as history from './history'
import * as backups from './backups'
import { inAction } from './activity'

type OpImpl = { [K in OpName]: (repo: string, ...args: OpArgs<K>) => Promise<OpResult<K>> }

const HASH_RE = /^[0-9a-f]{4,64}$/i
const STASH_RE = /^stash@\{\d+\}$/
const AUTO_STASH_MESSAGE = 'GitDom auto-stash before checkout'
const FILE_HISTORY_LIMIT = 5000
/** Each commit of a line history carries a diff: fewer of them */
const LINE_HISTORY_LIMIT = 500
const REFLOG_LIMIT = 2000
/** Ignored files and folders listed with their rule */
const MOST_IGNORED = 2000
/** The running search in the changes of each repository: a new one, or clearing it, stops it */
const contentSearches = new Map<string, AbortController>()
const CONFLICT_MARKER_RE = /^(<{7}|>{7})( |$)/m

/** Rejects values git would parse as options. */
function assertArg(value: string, what: string): void {
  if (!value || value.startsWith('-') || /[\0\n]/.test(value))
    throw new Error(`Invalid ${what}: ${value}`)
}

async function assertRefName(
  repo: string,
  prefix: string,
  name: string,
  what: string
): Promise<void> {
  assertArg(name, what)
  if ((await tryGit(repo, ['check-ref-format', prefix + name])) === null) {
    throw new Error(`Invalid ${what}: ${name}`)
  }
}

const assertBranchName = (repo: string, name: string): Promise<void> =>
  assertRefName(repo, 'refs/heads/', name, 'branch name')
const assertTagName = (repo: string, name: string): Promise<void> =>
  assertRefName(repo, 'refs/tags/', name, 'tag name')

/** A revision typed or picked by the user: a hash, a branch or tag name, HEAD~2… */
function assertRev(rev: string): void {
  assertArg(rev, 'revision')
  // Whitespace and ':' never appear in branch or tag names; ':' would name a path in a tree
  if (/[\s:]/.test(rev)) throw new Error(`Invalid revision: ${rev}`)
}

function assertHash(hash: string): void {
  if (!HASH_RE.test(hash)) throw new Error(`Invalid commit hash: ${hash}`)
}

function assertStash(selector: string): void {
  if (!STASH_RE.test(selector)) throw new Error(`Invalid stash: ${selector}`)
}

/** Absolute path of a file in the working tree, refusing paths that escape it. */
function repoFile(repo: string, path: string): string {
  assertArg(path, 'path')
  const file = resolve(repo, path)
  const rel = relative(repo, file)
  if (!rel || rel.startsWith('..') || resolve(rel) === rel) {
    throw new Error(`Path outside the repository: ${path}`)
  }
  return file
}

async function assertIdle(repo: string): Promise<void> {
  const operation = await readOperation(repo)
  if (operation) throw new Error(`A ${operation} is in progress: continue or abort it first`)
}

async function isMerge(repo: string, hash: string): Promise<boolean> {
  const parents = (await runGit(repo, ['rev-list', '--parents', '-n1', hash])).trim().split(' ')
  return parents.length > 2
}

/**
 * Runs a command that may stop on conflicts. Stopping is an outcome, not an error: the repository
 * is left mid-operation (or with unmerged files, for squash merges) for the user to resolve.
 */
async function withConflicts(
  repo: string,
  args: string[],
  env?: Record<string, string>
): Promise<OpOutcome> {
  try {
    // Merge messages are prepared by git: never wait for an editor
    const output = await runGit(repo, args, {
      withStderr: true,
      env: { GIT_EDITOR: 'true', ...env }
    })
    // --autostash succeeds even when reapplying the changes conflicts: the stash is kept
    return { conflicts: /autostash resulted in conflicts/i.test(output), output }
  } catch (e) {
    const unmerged = (await tryGit(repo, ['ls-files', '-u']))?.trim()
    if (e instanceof GitError && ((await readOperation(repo)) || unmerged)) {
      return { conflicts: true, output: e.stderr.trim() }
    }
    throw e
  }
}

/** The commits of the current branch from `from` to HEAD, along its first parents. */
async function commitsToMove(repo: string, from: string): Promise<CommitsToMove> {
  assertHash(from)
  const branch = await currentBranch(repo)
  const base = (await tryGit(repo, ['rev-parse', '-q', '--verify', `${from}^`]))?.trim()
  if (!base) throw new Error('The first commit of the repository cannot be moved')
  const commits = (
    await runGit(repo, ['log', '--reverse', '--first-parent', '--format=%H%x00%s', `${base}..HEAD`])
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split('\0')
      return { hash, subject }
    })
  if (commits[0]?.hash !== from)
    throw new Error(`Pick a commit of ${branch}, not of a branch merged into it`)
  const merges = Number(
    (await runGit(repo, ['rev-list', '--count', '--merges', `${base}..HEAD`])).trim()
  )
  return { branch, base, commits, merges }
}

/** Runs a pathspec-taking command with paths passed on stdin, avoiding command line length limits. */
function runWithPaths(repo: string, args: string[], paths: string[]): Promise<string> {
  return runGit(
    repo,
    ['--literal-pathspecs', ...args, '--pathspec-from-file=-', '--pathspec-file-nul'],
    { input: paths.join('\0') }
  )
}

async function hasHead(repo: string): Promise<boolean> {
  return (await tryGit(repo, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null
}

async function currentBranch(repo: string): Promise<string> {
  const branch = (await tryGit(repo, ['symbolic-ref', '-q', '--short', 'HEAD']))?.trim()
  if (!branch) throw new Error('HEAD is detached: check out a branch first')
  return branch
}

async function getConfig(repo: string, key: string): Promise<string | null> {
  return (await tryGit(repo, ['config', '--get', key]))?.trim() || null
}

/** Remote used for a branch without upstream: its configured remote, else origin, else the only one. */
async function defaultRemote(repo: string, branch: string): Promise<string> {
  const configured = await getConfig(repo, `branch.${branch}.remote`)
  if (configured) return configured
  const remotes = (await runGit(repo, ['remote'])).split('\n').filter(Boolean)
  if (remotes.includes('origin')) return 'origin'
  if (remotes.length > 0) return remotes[0]
  throw new Error('No remote configured: add one first')
}

/**
 * Runs a checkout, stashing local changes first when asked and restoring them afterwards.
 * With mode `all` untracked files are stashed too, for checkouts that would overwrite them.
 * If restoring fails the changes stay in the stash, so nothing is lost.
 */
async function withAutoStash(
  repo: string,
  mode: StashMode,
  checkout: () => Promise<unknown>
): Promise<void> {
  const untracked = mode === 'all'
  const dirty =
    mode !== 'none' &&
    (
      await runGit(repo, ['status', '--porcelain', `--untracked-files=${untracked ? 'all' : 'no'}`])
    ).trim() !== ''
  if (dirty) {
    const args = ['stash', 'push', '-m', AUTO_STASH_MESSAGE]
    await runGit(repo, untracked ? [...args, '--include-untracked'] : args)
  }
  try {
    await checkout()
  } catch (e) {
    if (dirty) await tryGit(repo, ['stash', 'pop'])
    throw e
  }
  if (!dirty) return
  try {
    await runGit(repo, ['stash', 'pop'])
  } catch (e) {
    throw new GitError(
      'Checked out, but your changes could not be fully reapplied on this branch: resolve the conflicts, or apply the stash later (your changes are kept in it)',
      ['stash', 'pop'],
      e instanceof GitError ? e.exitCode : null,
      e instanceof GitError ? e.stderr : ''
    )
  }
}

async function firstParentOf(repo: string, hash: string): Promise<string | undefined> {
  const [, firstParent] = (await runGit(repo, ['rev-list', '--parents', '-n1', hash]))
    .trim()
    .split(' ')
  return firstParent
}

async function commitDiff(
  repo: string,
  hash: string,
  paths: string[],
  extra: string[]
): Promise<string> {
  assertHash(hash)
  const firstParent = await firstParentOf(repo, hash)
  // Merges are compared with their first parent, consistently with the commit detail
  return firstParent
    ? runGit(repo, [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '-M',
        ...extra,
        firstParent,
        hash,
        '--',
        ...paths
      ])
    : runGit(repo, [
        '--literal-pathspecs',
        'diff-tree',
        '-p',
        '--root',
        ...extra,
        '--no-commit-id',
        hash,
        '--',
        ...paths
      ])
}

/** Diff arguments for the options chosen in the diff viewer (DIFF-04, DIFF-05). */
function diffOptionArgs(options: DiffOptions): string[] {
  const args: string[] = []
  if (options.ignoreWhitespace) args.push('-w')
  if (options.context !== undefined) args.push(`-U${Math.max(0, Math.floor(options.context))}`)
  return args
}

/** Images larger than this are not loaded by the image diff */
const IMAGE_LIMIT = 20 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

function imageType(path: string): string {
  return IMAGE_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'image/png'
}

/** An image stored by Git as a data URL, or null when the revision has no such file. */
async function blobImage(repo: string, spec: string, path: string): Promise<string | null> {
  const size = Number((await tryGit(repo, ['cat-file', '-s', spec]))?.trim())
  if (!size) return null
  if (size > IMAGE_LIMIT) throw new Error(`${path} is too large to preview`)
  const data = await runGit(repo, ['cat-file', 'blob', spec], { encoding: 'base64' })
  return `data:${imageType(path)};base64,${data}`
}

/** Files larger than this are not shown, only saved */
const VIEW_LIMIT = 5 * 1024 * 1024

async function blobBytes(repo: string, spec: string): Promise<Buffer> {
  return Buffer.from(
    await runGit(repo, ['cat-file', 'blob', spec], { encoding: 'base64' }),
    'base64'
  )
}

const tooLarge = (size: number): FileContent => ({
  size,
  text: null,
  image: null,
  binary: false,
  tooLarge: true
})

/** A file's bytes as GitDom shows them: an image, text, or neither when it's binary. */
function fileContent(path: string, data: Buffer): FileContent {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const image = path.includes('.') && extension in IMAGE_TYPES
  // Like git: a NUL byte near the start makes a file binary
  const binary = data.subarray(0, 8000).includes(0)
  return {
    size: data.length,
    // SVG is both: a picture and its source
    text:
      binary || (image && extension !== 'svg')
        ? null
        : data.toString('utf8').replace(/^\uFEFF/, ''),
    image: image ? `data:${imageType(path)};base64,${data.toString('base64')}` : null,
    binary: binary && !image,
    tooLarge: false
  }
}

/** An image in the working tree as a data URL, or null when it was deleted. */
async function worktreeImage(repo: string, path: string): Promise<string | null> {
  const full = resolve(repo, path)
  if (relative(repo, full).startsWith('..')) throw new Error(`Invalid path: ${path}`)
  const info = await stat(full).catch(() => null)
  if (!info) return null
  if (info.size > IMAGE_LIMIT) throw new Error(`${path} is too large to preview`)
  return `data:${imageType(path)};base64,${(await readFile(full)).toString('base64')}`
}

/**
 * Commits whose changes add or remove `text` (`-S`, the commits where it appeared or went away),
 * or whose changed lines match a regular expression (`-G`), ignoring case. Git diffs every commit
 * for this, so a long history takes a while: a newer search, or cancelSearch, stops it.
 */
async function searchChanges(
  repo: string,
  field: 'code' | 'regex',
  text: string,
  filter: Parameters<typeof logRevisions>[0]
): Promise<string[]> {
  const controller = new AbortController()
  contentSearches.set(repo, controller)
  try {
    const output = await runGit(
      repo,
      [
        'log',
        `-n${COMMIT_LIMIT}`,
        '--format=%H',
        '-i',
        field === 'code' ? `-S${text}` : `-G${text}`,
        ...logRevisions(filter),
        '--'
      ],
      { signal: controller.signal }
    )
    return output.split('\n').filter(Boolean)
  } catch (e) {
    const invalid = e instanceof GitError && /invalid regex: (.*)/.exec(e.stderr)
    if (invalid) throw new Error(`Invalid regular expression: ${invalid[1].trim()}`)
    throw e
  } finally {
    if (contentSearches.get(repo) === controller) contentSearches.delete(repo)
  }
}

const ops: OpImpl = {
  status: (repo) => loadStatus(repo),

  async diff(repo, source, path, oldPath, options = {}): Promise<FileDiff> {
    assertArg(path, 'path')
    const paths = oldPath && oldPath !== path ? [oldPath, path] : [path]
    const extra = diffOptionArgs(options)
    let output: string
    let conflicted = false
    switch (source.kind) {
      case 'unstaged':
        // An unmerged file would give a combined diff: compare it with HEAD instead
        conflicted =
          (await runGit(repo, ['--literal-pathspecs', 'ls-files', '-u', '--', path])).trim() !== ''
        output = await runGit(repo, [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          ...extra,
          ...(conflicted ? ['HEAD'] : []),
          '--',
          path
        ])
        break
      case 'staged':
        output = await runGit(repo, [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          '--cached',
          '-M',
          ...extra,
          '--',
          ...paths
        ])
        break
      case 'untracked':
        // --no-index exits with 1 when the files differ, which is always the case here
        output = await runGit(
          repo,
          ['diff', '--no-ext-diff', '--no-index', ...extra, '--', '/dev/null', path],
          {
            okExitCodes: [1]
          }
        )
        break
      case 'commit':
        output = await commitDiff(repo, source.hash, paths, extra)
        break
      case 'compare':
        assertRev(source.from)
        assertRev(source.to)
        output = await runGit(repo, [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          '-M',
          ...extra,
          source.from,
          source.to,
          '--',
          ...paths
        ])
        break
    }
    const parsed = parseDiff(output, path)
    return conflicted ? { ...parsed, conflicted } : parsed
  },

  async imagePair(repo, source, path, oldPath): Promise<ImagePair> {
    assertArg(path, 'path')
    const before = oldPath ?? path
    switch (source.kind) {
      case 'unstaged':
        return {
          before: await blobImage(repo, `:${path}`, path),
          after: await worktreeImage(repo, path)
        }
      case 'staged':
        return {
          before: await blobImage(repo, `HEAD:${before}`, before),
          after: await blobImage(repo, `:${path}`, path)
        }
      case 'untracked':
        return { before: null, after: await worktreeImage(repo, path) }
      case 'commit': {
        assertHash(source.hash)
        const parent = await firstParentOf(repo, source.hash)
        return {
          before: parent ? await blobImage(repo, `${parent}:${before}`, before) : null,
          after: await blobImage(repo, `${source.hash}:${path}`, path)
        }
      }
      case 'compare':
        assertRev(source.from)
        assertRev(source.to)
        return {
          before: await blobImage(repo, `${source.from}:${before}`, before),
          after: await blobImage(repo, `${source.to}:${path}`, path)
        }
    }
  },

  async searchCommits(repo, field, text, filter) {
    const inChanges = field === 'code' || field === 'regex'
    if (inChanges) contentSearches.get(repo)?.abort()
    if (!text.trim()) return []
    if (/[\0\n\r]/.test(text)) throw new Error('Invalid search text')
    if (inChanges) return searchChanges(repo, field, text, filter)
    const match =
      field === 'message'
        ? ['-i', '-F', `--grep=${text}`]
        : // Pathspec magic: any path containing the text, ignoring case. Its glob characters are
          // made literal with brackets, as Git for Windows turns backslashes into slashes
          ['--', `:(icase,glob)**/*${text.replace(/\\/g, '/').replace(/[*?[]/g, '[$&]')}*`]
    const output = await runGit(repo, [
      'log',
      `-n${COMMIT_LIMIT}`,
      '--format=%H',
      ...logRevisions(filter),
      ...match
    ])
    return output.split('\n').filter(Boolean)
  },

  async cancelSearch(repo) {
    contentSearches.get(repo)?.abort()
  },

  moreCommits(repo, skip, filter) {
    return loadCommits(repo, filter, skip, COMMIT_PAGE)
  },

  async compareFiles(repo, from, to) {
    assertRev(from)
    assertRev(to)
    return parseNameStatus(
      await runGit(repo, ['diff', '--no-ext-diff', '--name-status', '-z', '-M', from, to])
    )
  },

  commitDetail: (repo, hash) => loadCommitDetail(repo, hash),

  async commitPreview(repo, hash) {
    assertHash(hash)
    const [header, body] = (await runGit(repo, ['show', '-s', '--format=%P%x1f%b', hash])).split(
      '\x1f'
    )
    const parents = header.trim().split(' ').filter(Boolean)
    // Merges and stashes are shown against their first parent, like the commit detail
    const diff = (format: string): Promise<string> =>
      runGit(
        repo,
        parents.length > 1
          ? ['diff', '--no-ext-diff', format, '-z', '-M', parents[0], hash]
          : ['diff-tree', '--no-commit-id', '-r', '--root', format, '-z', '-M', hash]
      )
    const [names, numbers] = await Promise.all([diff('--name-status'), diff('--numstat')])
    return { body: body.trim(), files: withNumstat(parseNameStatus(names), numbers) }
  },

  async tagInfo(repo, name) {
    await assertTagName(repo, name)
    const output = await runGit(repo, [
      'for-each-ref',
      '--format=%(objecttype)%1f%(taggername)%1f%(taggeremail:trim)%1f%(taggerdate:unix)%1f%(contents:subject)%1f%(contents:body)',
      `refs/tags/${name}`
    ])
    const [type, tagger, email, date, subject, body] = output.split('\x1f')
    if (type !== 'tag') return null
    return { tagger, email, date: Number(date), subject, body: (body ?? '').trim() }
  },

  async fileHistory(repo, path) {
    assertArg(path, 'path')
    const output = await runGit(repo, [
      '--literal-pathspecs',
      'log',
      '--follow',
      `-n${FILE_HISTORY_LIMIT}`,
      `--format=${FILE_LOG_FORMAT}`,
      '--name-status',
      '-z',
      '--',
      path
    ])
    return parseFileLog(output, path)
  },

  async lineHistory(repo, path, range, rev) {
    assertArg(path, 'path')
    if (rev) assertHash(rev)
    // Line numbers ("12,40") or a function name, which git looks for with its function detection
    const lines = /^(\d+),(\d+)$/.exec(range)
    const valid = lines
      ? Number(lines[1]) >= 1 && Number(lines[2]) >= Number(lines[1])
      : /^:[^:\0\n]+$/.test(range)
    if (!valid) throw new Error(`Invalid line range: ${range}`)
    const output = await runGit(repo, [
      'log',
      `-L${range}:${path}`,
      `-n${LINE_HISTORY_LIMIT}`,
      `--format=${FILE_LOG_FORMAT}`,
      ...(rev ? [rev] : []),
      '--'
    ]).catch((e: unknown) => {
      if (!lines && e instanceof GitError && /no match/.test(e.message)) {
        const name = range.slice(1).replace(/\\(.)/g, '$1')
        throw new Error(
          `Git finds no function named “${name}” in ${path}: it looks for lines that start a function, like “function ${name}” or “def ${name}”, from the start of the line`
        )
      }
      throw e
    })
    return parseLineLog(output, path)
  },

  async blame(repo, path, rev) {
    assertArg(path, 'path')
    if (rev) assertHash(rev)
    const output = await runGit(repo, [
      '--literal-pathspecs',
      'blame',
      '--porcelain',
      ...(rev ? [rev] : []),
      '--',
      path
    ])
    return parseBlame(output, path)
  },

  async lineBefore(repo, hash, path, previous, line) {
    assertHash(hash)
    assertHash(previous.hash)
    assertArg(path, 'path')
    assertArg(previous.path, 'path')
    const output = await runGit(repo, [
      '--literal-pathspecs',
      'diff',
      '--no-ext-diff',
      '--no-color',
      '-M',
      '-U0',
      previous.hash,
      hash,
      '--',
      ...new Set([previous.path, path])
    ])
    return lineBefore(parseDiff(output, path).hunks, line)
  },

  async treeFiles(repo, rev) {
    assertRev(rev)
    return parseTreeFiles(await runGit(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', rev]))
  },

  async fileAt(repo, rev, path) {
    assertArg(path, 'path')
    if (!rev) {
      const full = resolve(repo, path)
      if (relative(repo, full).startsWith('..')) throw new Error(`Invalid path: ${path}`)
      const { size } = await stat(full)
      return size > VIEW_LIMIT ? tooLarge(size) : fileContent(path, await readFile(full))
    }
    assertRev(rev)
    const spec = `${rev}:${path}`
    const size = Number((await runGit(repo, ['cat-file', '-s', spec])).trim())
    if (size > VIEW_LIMIT) return tooLarge(size)
    return fileContent(path, await blobBytes(repo, spec))
  },

  async saveFileAt(repo, rev, path, dest) {
    assertRev(rev)
    assertArg(path, 'path')
    if (!isAbsolute(dest)) throw new Error(`Invalid destination: ${dest}`)
    await writeFile(dest, await blobBytes(repo, `${rev}:${path}`))
  },

  async stage(repo, paths) {
    await runWithPaths(repo, ['add', '-A'], paths)
  },

  async unstage(repo, paths) {
    // Without a first commit there is nothing to reset to: remove the entries from the index instead
    if (await hasHead(repo)) await runWithPaths(repo, ['reset', '-q'], paths)
    else await runWithPaths(repo, ['rm', '--cached', '-r', '-q'], paths)
  },

  async stageAll(repo) {
    await runGit(repo, ['add', '-A'])
  },

  async unstageAll(repo) {
    if (await hasHead(repo)) await runGit(repo, ['reset', '-q'])
    else await runGit(repo, ['rm', '--cached', '-r', '-q', '.'])
  },

  async discard(repo, files) {
    const untracked = files.filter((f) => f.status === '?').map((f) => f.path)
    const tracked = files.filter((f) => f.status !== '?').map((f) => f.path)
    if (tracked.length > 0) await runWithPaths(repo, ['restore', '--worktree'], tracked)
    // clean has no --pathspec-from-file: chunk to stay under the command line limit
    for (let i = 0; i < untracked.length; i += 100) {
      await runGit(repo, [
        '--literal-pathspecs',
        'clean',
        '-f',
        '-q',
        '--',
        ...untracked.slice(i, i + 100)
      ])
    }
  },

  async applyPatch(repo, patch, cached, reverse) {
    const args = ['apply', '--recount', '--whitespace=nowarn']
    if (cached) args.push('--cached')
    if (reverse) args.push('--reverse')
    await runGit(repo, [...args, '-'], { input: patch })
  },

  async resolveConflict(repo, paths, side) {
    if (side !== 'ours' && side !== 'theirs') throw new Error(`Invalid side: ${String(side)}`)
    await runWithPaths(repo, ['checkout', `--${side}`], paths)
    await runWithPaths(repo, ['add', '-A'], paths)
  },

  async conflictMarkers(repo, paths) {
    const withMarkers: string[] = []
    for (const path of paths) {
      const content = await readFile(repoFile(repo, path), 'utf8').catch(() => '')
      if (CONFLICT_MARKER_RE.test(content)) withMarkers.push(path)
    }
    return withMarkers
  },

  async commit(repo, message, amend, options = {}) {
    if (!message.trim()) throw new Error('The commit message is empty')
    const args = ['commit', '-F', '-']
    if (amend) args.push('--amend')
    if (options.noVerify) args.push('--no-verify')
    if (options.sign !== undefined) args.push(options.sign ? '-S' : '--no-gpg-sign')
    const author = options.author?.trim()
    if (author) {
      if (!/^[^<>\0\n]+ <[^<>\0\n]+>$/.test(author)) {
        throw new Error(`The author must be written as Name <email>: ${author}`)
      }
      args.push(`--author=${author}`)
    }
    return runGit(repo, [...(await signingProgramArgs(repo)), ...args], {
      input: message,
      withStderr: true
    })
  },

  async lastCommitMessage(repo) {
    return (await runGit(repo, ['log', '-1', '--format=%B'])).trim()
  },

  async commitTemplate(repo) {
    const path = (await tryGit(repo, ['config', '--path', '--get', 'commit.template']))?.trim()
    if (!path) return null
    // A template that can't be read is ignored, as git itself would fail the commit
    return readFile(resolve(repo, path), 'utf8').catch(() => null)
  },

  async commitChecks(repo, kinds) {
    const warnings: CommitWarning[] = []
    const cached = ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-renames']
    const listed = (await runGit(repo, [...cached, '--name-only', '-z'])).split('\0')
    const paths = listed.filter(Boolean)
    if (!paths.length) return warnings
    if (kinds.secrets || kinds.debugCode) {
      const diff = await runGit(repo, [...cached, '-U0', '--no-color', '--no-ext-diff'])
      warnings.push(...scanStaged(diff, paths, kinds))
    }
    if (kinds.largeFiles) {
      // Sizes of the staged blobs; binaries are those numstat can't count lines of
      const raw = (await runGit(repo, [...cached, '--raw', '--no-abbrev', '-z'])).split('\0')
      const blobs: { path: string; hash: string }[] = []
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const [, , , hash, status] = raw[i].split(' ')
        if (status !== 'D' && /^[0-9a-f]{40,64}$/.test(hash)) blobs.push({ path: raw[i + 1], hash })
      }
      const sizes = (
        await runGit(repo, ['cat-file', '--batch-check=%(objectsize)'], {
          input: blobs.map((b) => b.hash).join('\n') + '\n'
        })
      ).split('\n')
      const big = blobs
        .map((b, i) => ({ ...b, size: Number(sizes[i]) || 0 }))
        .filter((b) => b.size > LARGE_BINARY)
      if (big.length) {
        const numstat = (await runGit(repo, [...cached, '--numstat', '-z'])).split('\0')
        const binary = new Set(numstat.filter((l) => l.startsWith('-\t-\t')).map((l) => l.slice(4)))
        const attrs = (
          await runGit(repo, ['check-attr', '--cached', '-z', '--stdin', 'filter'], {
            input: big.map((b) => b.path).join('\0') + '\0'
          })
        ).split('\0')
        const lfs = new Set<string>()
        for (let i = 0; i + 2 < attrs.length; i += 3) if (attrs[i + 2] === 'lfs') lfs.add(attrs[i])
        for (const b of big) {
          const warning = sizeWarning(b.path, b.size, binary.has(b.path), lfs.has(b.path))
          if (warning) warnings.push(warning)
        }
      }
    }
    return capWarnings(warnings)
  },

  async reword(repo, hash, message) {
    assertHash(hash)
    if (!message.trim()) throw new Error('The commit message is empty')
    await assertIdle(repo)
    await currentBranch(repo)
    const [head, commit] = await Promise.all(
      ['HEAD', `${hash}^{commit}`].map(async (rev) =>
        (await runGit(repo, ['rev-parse', '--verify', rev])).trim()
      )
    )
    if (commit === head) {
      // --only without paths commits HEAD's tree again: staged changes stay staged.
      // The content is unchanged, so hooks checking it would only get in the way
      const output = await runGit(
        repo,
        [
          ...(await signingProgramArgs(repo)),
          'commit',
          '--amend',
          '--only',
          '--no-verify',
          '--allow-empty',
          '-F',
          '-'
        ],
        { input: message.trim() + '\n', withStderr: true }
      )
      return { conflicts: false, output }
    }
    if (!(await ops.isAncestor(repo, commit, head))) {
      throw new Error('The commit is not on the current branch: check out its branch first')
    }
    const base = (await firstParentOf(repo, commit)) ?? null
    const { commits, merges } = await ops.rebaseCommits(repo, base)
    if (merges > 0) {
      throw new Error(
        'This commit is, or is followed by, a merge commit: rewording it would flatten the merges'
      )
    }
    return ops.rebaseInteractive(
      repo,
      base,
      commits.map((c) =>
        c.hash === commit
          ? { action: 'reword', hash: c.hash, message }
          : { action: 'pick', hash: c.hash }
      )
    )
  },

  async fixup(repo, hash) {
    assertHash(hash)
    await assertIdle(repo)
    await currentBranch(repo)
    if ((await tryGit(repo, ['diff', '--cached', '--quiet'])) !== null)
      throw new Error('Stage the changes to add to the commit first')
    const [head, commit] = await Promise.all(
      ['HEAD', `${hash}^{commit}`].map(async (rev) =>
        (await runGit(repo, ['rev-parse', '--verify', rev])).trim()
      )
    )
    const sign = await signingProgramArgs(repo)
    if (commit === head) {
      const output = await runGit(repo, [...sign, 'commit', '--amend', '--no-edit'], {
        withStderr: true
      })
      return { conflicts: false, output }
    }
    if (!(await ops.isAncestor(repo, commit, head))) {
      throw new Error('The commit is not on the current branch: check out its branch first')
    }
    // Checked before committing, so that a refusal leaves the staged changes as they are
    const base = (await firstParentOf(repo, commit)) ?? null
    const { commits, merges } = await ops.rebaseCommits(repo, base)
    if (merges > 0) {
      throw new Error(
        'This commit is, or is followed by, a merge commit: fixing it up would flatten the merges'
      )
    }
    await runGit(repo, [...sign, 'commit', '-q', `--fixup=${commit}`])
    const fix = (await runGit(repo, ['rev-parse', 'HEAD'])).trim()
    return ops.rebaseInteractive(
      repo,
      base,
      commits.flatMap((c): RebaseStep[] =>
        c.hash === commit
          ? [
              { action: 'pick', hash: c.hash },
              { action: 'fixup', hash: fix }
            ]
          : [{ action: 'pick', hash: c.hash }]
      )
    )
  },

  async splitCommit(repo, hash, paths, firstMessage, secondMessage) {
    assertHash(hash)
    if (!firstMessage.trim() || !secondMessage.trim()) {
      throw new Error('Both commits need a message')
    }
    await assertIdle(repo)
    const branch = await currentBranch(repo)
    const head = (await runGit(repo, ['rev-parse', '--verify', 'HEAD'])).trim()
    const [commit, ...parents] = (await runGit(repo, ['rev-list', '--parents', '-n1', hash]))
      .trim()
      .split(' ')
    if (parents.length > 1) throw new Error('A merge commit cannot be split')
    if (commit !== head && !(await ops.isAncestor(repo, commit, head))) {
      throw new Error('The commit is not on the current branch: check out its branch first')
    }
    const parent = parents[0] as string | undefined

    // What the commit changed, file by file, with the mode and blob each has after it
    const raw = await runGit(repo, [
      'diff-tree',
      '-r',
      '-z',
      '--raw',
      '--no-renames',
      '--no-commit-id',
      ...(parent ? [parent, commit] : ['--root', commit])
    ])
    const fields = raw.split('\0')
    const changes = new Map<string, string>()
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const [, newMode, , newBlob] = fields[i].slice(1).split(' ')
      changes.set(fields[i + 1], `${newMode} ${newBlob}`)
    }
    const chosen = new Set(paths)
    const unknown = [...chosen].find((path) => !changes.has(path))
    if (unknown !== undefined) throw new Error(`The commit didn't change ${unknown}`)
    if (!chosen.size || chosen.size === changes.size) {
      throw new Error('Pick some of the files for the first commit, not all of them')
    }

    // The first tree: the parent's, with the chosen files as the commit left them. Built in an
    // index of its own, so the real one and the working tree are never touched
    const index = resolve(
      repo,
      (await runGit(repo, ['rev-parse', '--git-path', 'gitdom-split-index'])).trim()
    )
    const env = { GIT_INDEX_FILE: index }
    let firstTree: string
    try {
      await runGit(repo, ['read-tree', ...(parent ? [parent] : ['--empty'])], { env })
      // Removals first: a file may give way to a folder of the same name
      const entries = [...chosen]
        .map((path) => `${changes.get(path)}\t${path}\0`)
        .sort((a, b) => Number(!a.startsWith('000000 ')) - Number(!b.startsWith('000000 ')))
      await runGit(repo, ['update-index', '-z', '--index-info'], { env, input: entries.join('') })
      firstTree = (await runGit(repo, ['write-tree'], { env })).trim()
    } finally {
      await rm(index, { force: true })
    }

    // Recreated commits keep their author, message and tree; only their parents change
    const sign = await signingProgramArgs(repo)
    // Unlike commit, commit-tree signs only when asked
    const gpgSign =
      (await tryGit(repo, ['config', '--type=bool', '--get', 'commit.gpgsign']))?.trim() === 'true'
    const format = '--format=%x01%H%x00%P%x00%T%x00%an%x00%ae%x00%ad%x00%B'
    const parse = (
      output: string
    ): {
      hash: string
      parents: string[]
      tree: string
      env: Record<string, string>
      message: string
    }[] =>
      output
        .split('\x01')
        .slice(1)
        .map((record) => {
          const [hash, parents, tree, name, email, date, ...message] = record.split('\0')
          return {
            hash,
            parents: parents ? parents.split(' ') : [],
            tree,
            env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date },
            message: message.join('\0').replace(/\n+$/, '') + '\n'
          }
        })
    const log = ['log', '--no-show-signature', '--no-color', '--date=raw', format]
    const [original] = parse(await runGit(repo, [...log, '-1', commit]))
    const create = async (
      tree: string,
      parentList: string[],
      author: Record<string, string>,
      message: string
    ): Promise<string> =>
      (
        await runGit(
          repo,
          [
            ...sign,
            'commit-tree',
            ...(gpgSign ? ['-S'] : []),
            ...parentList.flatMap((p) => ['-p', p]),
            tree
          ],
          { env: author, input: message }
        )
      ).trim()
    const first = await create(
      firstTree,
      parent ? [parent] : [],
      original.env,
      firstMessage.trim() + '\n'
    )
    const second = await create(original.tree, [first], original.env, secondMessage.trim() + '\n')

    const rewritten = new Map([[commit, second]])
    if (commit !== head) {
      const after = parse(
        await runGit(repo, [
          ...log,
          '--topo-order',
          '--reverse',
          '--ancestry-path',
          `${commit}..${head}`
        ])
      )
      for (const c of after) {
        rewritten.set(
          c.hash,
          await create(
            c.tree,
            c.parents.map((p) => rewritten.get(p) ?? p),
            c.env,
            c.message
          )
        )
      }
    }
    // Only if the branch is still where it was read
    await runGit(repo, [
      'update-ref',
      '-m',
      `split ${short(commit)}`,
      `refs/heads/${branch}`,
      rewritten.get(head)!,
      head
    ])
    return { first, second }
  },

  async reorderCommits(repo, base, order) {
    if (base) assertHash(base)
    order.forEach((hash) => assertHash(hash))
    const { commits, merges } = await ops.rebaseCommits(repo, base)
    if (merges > 0) {
      throw new Error('Commits can be moved only after the last merge: it would be flattened')
    }
    const current = commits.map((c) => c.hash)
    const same = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((hash, i) => hash === b[i])
    // Every commit exactly once: a missing one would be dropped by the rebase
    if (!same([...order].sort(), [...current].sort())) {
      throw new Error('The branch has changed since: try again')
    }
    if (same(order, current)) throw new Error('The commits are already in this order')
    return ops.rebaseInteractive(
      repo,
      base,
      order.map((hash) => ({ action: 'pick', hash }))
    )
  },

  async continueOperation(repo) {
    const operation = await readOperation(repo)
    if (!operation) throw new Error('No merge, rebase, cherry-pick or revert in progress')
    const conflicted = await runGit(repo, ['diff', '--name-only', '--diff-filter=U'])
    if (conflicted.trim()) {
      throw new Error('Some files still have conflicts: resolve them and stage them first')
    }
    // Keeps the prepared commit message; a rebase may stop again on a later commit
    return withConflicts(repo, [operation, '--continue'])
  },

  async abortOperation(repo) {
    const operation = await readOperation(repo)
    if (!operation) throw new Error('No merge, rebase, cherry-pick or revert in progress')
    await runGit(repo, [operation, '--abort'])
  },

  async skipOperation(repo) {
    const operation = await readOperation(repo)
    if (!operation) throw new Error('No rebase, cherry-pick or revert in progress')
    if (operation === 'merge') throw new Error('A merge cannot be skipped: abort it instead')
    return withConflicts(repo, [operation, '--skip'])
  },

  async openDiffTool(repo, source, path, oldPath) {
    const paths = oldPath && oldPath !== path ? [oldPath, path] : [path]
    paths.forEach((p) => assertArg(p, 'path'))
    const tool = toolSettings().diffTool
    if (tool && !/^[\w.-]+$/.test(tool)) throw new Error(`Invalid diff tool: ${tool}`)
    if (!tool && !(await getConfig(repo, 'diff.tool')) && !(await getConfig(repo, 'merge.tool'))) {
      throw new Error(
        'No external diff tool configured: choose one in Preferences, or set diff.tool in your git config'
      )
    }
    let revs: string[]
    switch (source.kind) {
      case 'unstaged':
        revs = []
        break
      case 'staged':
        revs = ['--cached']
        break
      case 'untracked':
        throw new Error('A new file has nothing to compare with yet: stage it first')
      case 'commit':
        assertHash(source.hash)
        revs = [
          (await firstParentOf(repo, source.hash)) ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
          source.hash
        ] // root: the empty tree
        break
      case 'compare':
        assertRev(source.from)
        assertRev(source.to)
        revs = [source.from, source.to]
        break
    }
    await runGit(repo, [
      'difftool',
      '--no-prompt',
      ...(tool ? [`--tool=${tool}`] : []),
      '-M',
      ...revs,
      '--',
      ...paths
    ])
  },

  async openMergeTool(repo, path) {
    repoFile(repo, path)
    // Without a configured tool git would try terminal editors, which can't run here
    const tool = toolSettings().mergeTool
    if (tool && !/^[\w.-]+$/.test(tool)) throw new Error(`Invalid merge tool: ${tool}`)
    if (!tool && !(await getConfig(repo, 'merge.tool'))) {
      throw new Error(
        'No external merge tool configured: choose one in Preferences, or set merge.tool in your git config'
      )
    }
    await runGit(repo, [
      '-c',
      'mergetool.keepBackup=false',
      'mergetool',
      '--no-prompt',
      ...(tool ? [`--tool=${tool}`] : []),
      '--',
      path
    ])
  },

  readConflictFile: (repo, path) => readFile(repoFile(repo, path), 'utf8'),

  async saveResolution(repo, path, content) {
    await writeFile(repoFile(repo, path), content, 'utf8')
    await runWithPaths(repo, ['add', '-A'], [path])
  },

  async merge(repo, ref, mode) {
    assertArg(ref, 'branch')
    await assertIdle(repo)
    const flags: Record<MergeMode, string[]> = {
      ff: [],
      'no-ff': ['--no-ff'],
      'ff-only': ['--ff-only'],
      squash: ['--squash']
    }
    if (!(mode in flags)) throw new Error(`Invalid merge mode: ${String(mode)}`)
    // Local changes are set aside during the merge and restored after it (STASH-06)
    return withConflicts(repo, ['merge', '--no-edit', '--autostash', ...flags[mode], ref])
  },

  async rebase(repo, onto) {
    assertArg(onto, 'branch')
    await assertIdle(repo)
    await currentBranch(repo)
    return withConflicts(repo, ['rebase', '--autostash', onto])
  },

  async rebaseCommits(repo, base) {
    if (base) assertHash(base)
    const range = base ? `${base}..HEAD` : 'HEAD'
    const merges = Number((await runGit(repo, ['rev-list', '--count', '--merges', range])).trim())
    // Same selection as `git rebase -i`: merges are not replayed
    const output = await runGit(repo, [
      'log',
      '--reverse',
      '--topo-order',
      '--no-merges',
      '--format=%H%x00%an%x00%B%x1e',
      range
    ])
    const commits = output
      .split('\x1e')
      .map((record) => record.replace(/^\n/, ''))
      .filter(Boolean)
      .map((record) => {
        const [hash, author, message] = record.split('\0')
        const trimmed = message.trim()
        return { hash, author, message: trimmed, subject: trimmed.split('\n')[0] }
      })
    return { commits, merges }
  },

  async rebaseInteractive(repo, base, todo) {
    if (base) assertHash(base)
    await assertIdle(repo)
    await currentBranch(repo)
    const actions = new Set(['pick', 'reword', 'squash', 'fixup', 'drop'])
    const first = todo.find((s) => s.action !== 'drop')
    if (!first) throw new Error('Every commit would be dropped')
    if (first.action === 'squash' || first.action === 'fixup') {
      throw new Error(
        'The first kept commit cannot be squashed: there is nothing before it to squash into'
      )
    }

    // Reword messages are applied by exec lines when the rebase gets there, possibly after
    // conflicts: keep them in the git directory until the next interactive rebase
    const dir = resolve(
      repo,
      (await runGit(repo, ['rev-parse', '--git-path', 'gitdom-rebase'])).trim()
    )
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const quote = (path: string): string => `'${path.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`

    const lines: string[] = []
    for (const [i, step] of todo.entries()) {
      assertHash(step.hash)
      if (!actions.has(step.action))
        throw new Error(`Invalid rebase action: ${String(step.action)}`)
      if (step.action === 'reword') {
        if (!step.message?.trim()) throw new Error('A reworded commit needs a message')
        const file = resolve(dir, `message-${i}.txt`)
        await writeFile(file, step.message.trim() + '\n', 'utf8')
        lines.push(
          `pick ${step.hash}`,
          `exec git commit --amend --no-verify --allow-empty -q -F ${quote(file)}`
        )
      } else {
        lines.push(`${step.action} ${step.hash}`)
      }
    }
    const todoFile = resolve(dir, 'todo.txt')
    await writeFile(todoFile, lines.join('\n') + '\n', 'utf8')

    return withConflicts(
      repo,
      // -c options reach the exec'd commits too, through GIT_CONFIG_PARAMETERS
      [...(await signingProgramArgs(repo)), 'rebase', '-i', '--autostash', base ?? '--root'],
      // git runs the sequence editor with the todo file as argument: replace it with ours
      { GIT_SEQUENCE_EDITOR: `cp ${quote(todoFile)}` }
    )
  },

  async cherryPick(repo, hashes) {
    if (hashes.length === 0) throw new Error('No commits to cherry-pick')
    hashes.forEach(assertHash)
    await assertIdle(repo)
    const merges = (await Promise.all(hashes.map((h) => isMerge(repo, h)))).filter(Boolean).length
    if (merges > 0 && hashes.length > 1) {
      throw new Error('Merge commits can only be cherry-picked one at a time')
    }
    // A merge is applied as its changes relative to the first parent
    return withConflicts(repo, ['cherry-pick', ...(merges ? ['-m', '1'] : []), ...hashes])
  },

  async commitsToMove(repo, from) {
    return commitsToMove(repo, from)
  },

  async moveCommits(repo, from, target, create, checkout) {
    await assertIdle(repo)
    const { branch, base, commits, merges } = await commitsToMove(repo, from)
    const tip = commits[commits.length - 1].hash
    if (create) {
      await assertBranchName(repo, target)
      if (checkout) {
        await runGit(repo, ['checkout', '-q', '-b', target, '--'])
        await runGit(repo, ['branch', '-f', branch, base])
      } else {
        // --keep keeps the uncommitted changes, and refuses when the commits touch them
        await runGit(repo, ['reset', '-q', '--keep', base, '--'])
        await runGit(repo, ['branch', target, tip])
      }
      return { conflicts: false, output: '' }
    }

    assertArg(target, 'branch')
    if (target === branch) throw new Error(`The commits are already on ${branch}`)
    if ((await tryGit(repo, ['rev-parse', '-q', '--verify', `refs/heads/${target}`])) === null)
      throw new Error(`No branch named ${target}`)
    if (merges) throw new Error('Merge commits can only be moved to a new branch')
    if (await ops.isAncestor(repo, from, `refs/heads/${target}`))
      throw new Error(`${target} already has these commits`)
    await runGit(repo, ['checkout', '-q', target, '--'])
    // Taken back first: if the cherry-pick stops on conflicts, the move is done once continued
    await runGit(repo, ['branch', '-f', branch, base])
    return withConflicts(repo, ['cherry-pick', ...commits.map((c) => c.hash)])
  },

  async revert(repo, hash) {
    assertHash(hash)
    await assertIdle(repo)
    const mainline = (await isMerge(repo, hash)) ? ['-m', '1'] : []
    return withConflicts(repo, ['revert', '--no-edit', ...mainline, hash])
  },

  async reset(repo, hash, mode) {
    assertHash(hash)
    const modes: ResetMode[] = ['soft', 'mixed', 'hard']
    if (!modes.includes(mode)) throw new Error(`Invalid reset mode: ${String(mode)}`)
    let saved: string | null = null
    if (mode === 'hard') {
      // Keep the uncommitted changes in a stash, so the reset can be undone without losing them
      const stash = (await runGit(repo, ['stash', 'create'])).trim()
      if (stash) {
        const message = `GitDom: uncommitted changes before hard reset to ${hash.slice(0, 7)}`
        await runGit(repo, ['stash', 'store', '-q', '-m', message, stash])
        saved = stash
      }
    }
    await runGit(repo, ['reset', '-q', `--${mode}`, hash, '--'])
    return saved
  },

  async reflog(repo, ref) {
    assertArg(ref, 'ref')
    if (ref !== 'HEAD' && (await tryGit(repo, ['check-ref-format', ref])) === null) {
      throw new Error(`Invalid ref: ${ref}`)
    }
    // A ref without a reflog (new repository, reflogs turned off) has no entries
    const output = await tryGit(repo, [
      'reflog',
      'show',
      '--date=unix',
      `--format=${REFLOG_FORMAT}`,
      `-n${REFLOG_LIMIT}`,
      ref,
      '--'
    ])
    return parseReflog(output ?? '')
  },

  backups: (repo) => backups.listBackups(repo),

  async restoreBackup(repo, id, ref) {
    if (!ref.startsWith('refs/heads/')) {
      throw new Error(
        'Only local branches can be restored: create a branch from the backup instead'
      )
    }
    const hash = await backups.backedUpCommit(repo, id, ref)
    const checkedOut = (await tryGit(repo, ['symbolic-ref', '-q', 'HEAD']))?.trim()
    if (checkedOut === ref) {
      await assertIdle(repo)
      // --keep refuses to overwrite uncommitted changes to the files it has to change
      await runGit(repo, ['reset', '-q', '--keep', hash])
    } else {
      await runGit(repo, ['update-ref', ref, hash])
    }
  },

  deleteBackup: (repo, id) => backups.deleteBackup(repo, id),

  undo: (repo) => history.undo(repo),
  redo: (repo) => history.redo(repo),

  async checkout(repo, branch, stash) {
    await assertBranchName(repo, branch)
    await withAutoStash(repo, stash, () => runGit(repo, ['checkout', branch, '--']))
  },

  async checkoutRemote(repo, remoteBranch, localName, stash) {
    assertArg(remoteBranch, 'remote branch')
    await assertBranchName(repo, localName)
    await withAutoStash(repo, stash, () =>
      runGit(repo, ['checkout', '-b', localName, '--track', remoteBranch, '--'])
    )
  },

  async checkoutCommit(repo, hash, stash) {
    assertHash(hash)
    await withAutoStash(repo, stash, () => runGit(repo, ['checkout', '--detach', hash, '--']))
  },

  async createBranch(repo, name, startPoint, checkout) {
    await assertBranchName(repo, name)
    if (startPoint) assertArg(startPoint, 'start point')
    const args = checkout ? ['checkout', '-b', name] : ['branch', name]
    if (startPoint) args.push(startPoint)
    await runGit(repo, checkout ? [...args, '--'] : args)
  },

  async renameBranch(repo, oldName, newName) {
    await assertBranchName(repo, oldName)
    await assertBranchName(repo, newName)
    await runGit(repo, ['branch', '-m', oldName, newName])
  },

  async fastForwardBranch(repo, branch, to) {
    await assertBranchName(repo, branch)
    assertArg(to, 'target')
    const current = (await tryGit(repo, ['symbolic-ref', '-q', '--short', 'HEAD']))?.trim()
    if (current === branch) {
      await runGit(repo, ['merge', '--ff-only', to])
      return
    }
    const old = (await runGit(repo, ['rev-parse', '--verify', `refs/heads/${branch}`])).trim()
    const target = (await runGit(repo, ['rev-parse', '--verify', `${to}^{commit}`])).trim()
    if ((await tryGit(repo, ['merge-base', '--is-ancestor', old, target])) === null) {
      throw new Error(
        `${branch} cannot be fast-forwarded to ${to}: it has commits that ${to} doesn't have`
      )
    }
    const reason = `GitDom: fast-forward to ${to}`
    await runGit(repo, ['update-ref', '-m', reason, `refs/heads/${branch}`, target, old])
  },

  async releaseCommits(repo, from, to) {
    if (from) assertArg(from, 'commit')
    assertArg(to, 'commit')
    const output = await runGit(repo, [
      'log',
      '--no-merges',
      '--format=%H%x1f%an%x1f%s%x1f%b%x1e',
      from ? `${from}..${to}` : to,
      '--'
    ])
    return output
      .split('\x1e')
      .map((record) => record.replace(/^\n/, ''))
      .filter(Boolean)
      .map((record) => {
        const [hash, author, subject, body] = record.split('\x1f')
        return { hash, author, subject, body: body.trim() }
      })
  },

  async previousTag(repo, rev) {
    assertArg(rev, 'commit')
    return (await tryGit(repo, ['describe', '--tags', '--abbrev=0', rev]))?.trim() || null
  },

  async isAncestor(repo, ancestor, descendant) {
    assertArg(ancestor, 'commit')
    assertArg(descendant, 'commit')
    return (await tryGit(repo, ['merge-base', '--is-ancestor', ancestor, descendant])) !== null
  },

  async mergePreview(repo, ours, theirs) {
    assertArg(ours, 'commit')
    assertArg(theirs, 'commit')
    let output: string
    try {
      // Exit code 1 means conflicts; anything else, git couldn't do it
      output = await runGit(
        repo,
        ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', ours, theirs],
        { okExitCodes: [1] }
      )
    } catch {
      return null
    }
    // The merged tree comes first, then each conflicted file
    const [, ...paths] = output.split('\0')
    return { conflicts: [...new Set(paths.filter(Boolean))] }
  },

  async deleteBranch(repo, name, force) {
    await assertBranchName(repo, name)
    await runGit(repo, ['branch', force ? '-D' : '-d', name])
  },

  async deleteRemoteBranch(repo, remote, branch) {
    assertArg(remote, 'remote')
    await assertBranchName(repo, branch)
    await runGit(repo, ['push', remote, '--delete', `refs/heads/${branch}`])
  },

  async setUpstream(repo, branch, upstream) {
    await assertBranchName(repo, branch)
    if (upstream) {
      assertArg(upstream, 'upstream')
      await runGit(repo, ['branch', `--set-upstream-to=${upstream}`, branch])
    } else {
      await runGit(repo, ['branch', '--unset-upstream', branch])
    }
  },

  async fetch(repo) {
    await runGit(repo, ['fetch', '--all', '--prune'])
  },

  async pull(repo, mode) {
    await assertIdle(repo)
    const flag = { ff: '--no-rebase', 'ff-only': '--ff-only', rebase: '--rebase' }[mode]
    return withConflicts(repo, ['pull', '--autostash', flag])
  },

  async push(repo, forceWithLease) {
    const branch = await currentBranch(repo)
    const remote = await getConfig(repo, `branch.${branch}.remote`)
    const merge = await getConfig(repo, `branch.${branch}.merge`)
    const args = ['push']
    if (forceWithLease) args.push('--force-with-lease')
    if (remote && merge) {
      // Explicit refspec: works even when the upstream has a different name (push.default=simple would refuse)
      args.push(remote, `refs/heads/${branch}:${merge}`)
    } else {
      args.push(
        '-u',
        await defaultRemote(repo, branch),
        `refs/heads/${branch}:refs/heads/${branch}`
      )
    }
    return runGit(repo, args, { withStderr: true })
  },

  async addRemote(repo, name, url) {
    assertArg(name, 'remote name')
    assertArg(url, 'remote URL')
    await runGit(repo, ['remote', 'add', name, url])
  },

  async removeRemote(repo, name) {
    assertArg(name, 'remote name')
    await runGit(repo, ['remote', 'remove', name])
  },

  async renameRemote(repo, oldName, newName) {
    assertArg(oldName, 'remote name')
    assertArg(newName, 'remote name')
    await runGit(repo, ['remote', 'rename', oldName, newName])
  },

  async setRemoteUrl(repo, name, url) {
    assertArg(name, 'remote name')
    assertArg(url, 'remote URL')
    await runGit(repo, ['remote', 'set-url', name, url])
  },

  async stashPush(repo, message, includeUntracked, options = {}) {
    const args = ['stash', 'push']
    const paths = options.paths ?? []
    if (options.staged) {
      if (paths.length) throw new Error('Staged changes are stashed all together, not by file')
      args.push('--staged')
    } else if (includeUntracked) args.push('--include-untracked')
    if (message.trim()) args.push('-m', message.trim())
    if (!paths.length) {
      await runGit(repo, args)
      return
    }
    paths.forEach((p) => repoFile(repo, p))
    await runWithPaths(repo, args, paths)
  },

  async stashApply(repo, selector) {
    assertStash(selector)
    await runGit(repo, ['stash', 'apply', selector])
  },

  async stashPop(repo, selector) {
    assertStash(selector)
    await runGit(repo, ['stash', 'pop', selector])
  },

  async stashDrop(repo, selector) {
    assertStash(selector)
    await runGit(repo, ['stash', 'drop', selector])
  },

  async createTag(repo, name, target, message, sign) {
    await assertTagName(repo, name)
    assertArg(target, 'tag target')
    const text = message?.trim()
    const args = ['tag']
    // A signed tag is annotated: it needs a message, the name will do
    if (sign) args.push('-s', '-m', text || name)
    else if (text) args.push('-a', '-m', text)
    // With tag.gpgsign even a lightweight tag would be signed, waiting on an editor for its message
    if (sign === false || (!sign && !text)) args.push('--no-sign')
    await runGit(repo, [...(await signingProgramArgs(repo)), ...args, name, target])
  },

  async deleteTag(repo, name) {
    await assertTagName(repo, name)
    await runGit(repo, ['tag', '-d', name])
  },

  async pushTag(repo, remote, name) {
    assertArg(remote, 'remote')
    await assertTagName(repo, name)
    await runGit(repo, ['push', remote, `refs/tags/${name}`])
  },

  async deleteRemoteTag(repo, remote, name) {
    assertArg(remote, 'remote')
    await assertTagName(repo, name)
    await runGit(repo, ['push', remote, '--delete', `refs/tags/${name}`])
  },

  async submoduleUpdate(repo, paths) {
    paths.forEach((p) => assertArg(p, 'path'))
    return runGit(repo, ['submodule', 'update', '--init', '--recursive', '--', ...paths], {
      withStderr: true
    })
  },

  async submoduleAdd(repo, url, path) {
    assertArg(url, 'URL')
    repoFile(repo, path)
    return runGit(repo, ['submodule', 'add', '--', url, path], { withStderr: true })
  },

  async submoduleSync(repo, paths) {
    paths.forEach((p) => assertArg(p, 'path'))
    return runGit(repo, ['submodule', 'sync', '--recursive', '--', ...paths], {
      withStderr: true
    })
  },

  async ignore(repo, pattern, untrack) {
    if (!pattern.trim() || /[\0\r\n]/.test(pattern)) throw new Error(`Invalid pattern: ${pattern}`)
    untrack.forEach((p) => repoFile(repo, p))
    const file = resolve(repo, '.gitignore')
    const current = await readFile(file, 'utf8').catch(() => '')
    if (!current.split(/\r?\n/).includes(pattern)) {
      // Follows the file's line endings, and ends its last line if it wasn't
      const eol = current.includes('\r\n') ? '\r\n' : '\n'
      const separator = current && !current.endsWith('\n') ? eol : ''
      await writeFile(file, current + separator + pattern + eol, 'utf8')
    }
    if (untrack.length) {
      await runWithPaths(repo, ['rm', '--cached', '-r', '-q', '--ignore-unmatch'], untrack)
    }
  },

  async ignoreRule(repo, path) {
    assertArg(path, 'path')
    // --no-index: the rules apply to tracked files too, which is what makes them confusing
    const [output, tracked] = await Promise.all([
      runGit(repo, ['check-ignore', '-v', '-n', '-z', '--no-index', '--stdin'], {
        input: path + '\0',
        okExitCodes: [1]
      }),
      runGit(repo, ['ls-files', '-z', '--', path])
    ])
    return { rule: parseCheckIgnore(output)[0] ?? null, tracked: tracked !== '' }
  },

  async ignoredFiles(repo) {
    // Folders ignored as a whole come once, with a trailing slash, rather than their contents
    const status = await runGit(repo, ['status', '--porcelain=v1', '-z', '--ignored'])
    const paths = status
      .split('\0')
      .filter((entry) => entry.startsWith('!! '))
      .map((entry) => entry.slice(3))
    const listed = paths.slice(0, MOST_IGNORED)
    if (!listed.length) return { rules: [], total: 0 }
    const output = await runGit(repo, ['check-ignore', '-v', '-n', '-z', '--stdin'], {
      input: listed.join('\0') + '\0',
      okExitCodes: [1]
    })
    return { rules: parseCheckIgnore(output), total: paths.length }
  },

  async worktreeAdd(repo, { path, branch, newBranch, start }) {
    assertArg(path, 'folder')
    const target = resolve(repo, path)
    if (start) assertRev(start)
    const args = ['worktree', 'add']
    if (newBranch) {
      await assertBranchName(repo, newBranch)
      args.push('-b', newBranch, target, ...(start ? [start] : []))
    } else if (branch) {
      assertRev(branch)
      args.push(target, branch)
    } else {
      args.push('--detach', target, ...(start ? [start] : []))
    }
    await runGit(repo, args)
    return target.replace(/\\/g, '/')
  },

  async worktreeRemove(repo, path, force) {
    assertArg(path, 'folder')
    await runGit(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
  },

  async worktreePrune(repo) {
    await runGit(repo, ['worktree', 'prune'])
  },

  async worktreeLock(repo, path, locked) {
    assertArg(path, 'folder')
    await runGit(repo, ['worktree', locked ? 'lock' : 'unlock', path])
  },

  async lfsTrack(repo, pattern) {
    assertArg(pattern, 'pattern')
    await runGit(repo, ['lfs', 'track', pattern])
  },

  async lfsUntrack(repo, pattern) {
    assertArg(pattern, 'pattern')
    await runGit(repo, ['lfs', 'untrack', pattern])
  },

  async lfsPull(repo) {
    return runGit(repo, ['lfs', 'pull'], { withStderr: true })
  },

  async lfsPush(repo, remote) {
    assertArg(remote, 'remote')
    return runGit(repo, ['lfs', 'push', '--all', remote], { withStderr: true })
  },

  async setIdentity(repo, name, email, scope) {
    for (const [value, what] of [
      [name, 'name'],
      [email, 'email']
    ]) {
      if (!value.trim() || /[\0\n]/.test(value)) throw new Error(`Invalid ${what}: ${value}`)
    }
    await runGit(repo, ['config', `--${scope}`, 'user.name', name.trim()])
    await runGit(repo, ['config', `--${scope}`, 'user.email', email.trim()])
  },

  async clearLocalIdentity(repo) {
    // Exit code 5: the key was not set
    for (const key of ['user.name', 'user.email']) {
      await runGit(repo, ['config', '--local', '--unset-all', key], { okExitCodes: [5] })
    }
  },

  async setSigning(repo, signing, scope) {
    if (!['openpgp', 'ssh', 'x509'].includes(signing.format)) {
      throw new Error(`Invalid signature format: ${String(signing.format)}`)
    }
    const key = signing.key?.trim() ?? ''
    if (key.startsWith('-') || /[\0\n]/.test(key)) throw new Error(`Invalid signing key: ${key}`)
    const set = (name: string, value: string): Promise<string> =>
      runGit(repo, ['config', `--${scope}`, name, value])
    await set('gpg.format', signing.format)
    if (key) await set('user.signingkey', key)
    else {
      await runGit(repo, ['config', `--${scope}`, '--unset-all', 'user.signingkey'], {
        okExitCodes: [5]
      })
    }
    await set('commit.gpgsign', String(signing.commits))
    await set('tag.gpgsign', String(signing.tags))
  }
}

/** Operations that only read: they skip the queue so a slow fetch doesn't delay diffs. */
const READ_ONLY = new Set<OpName>([
  'status',
  'moreCommits',
  'diff',
  'commitDetail',
  'commitPreview',
  'tagInfo',
  'fileHistory',
  'lineHistory',
  'treeFiles',
  'fileAt',
  'saveFileAt',
  'blame',
  'lineBefore',
  'lastCommitMessage',
  'commitTemplate',
  'conflictMarkers',
  'rebaseCommits',
  'readConflictFile',
  'isAncestor',
  'searchCommits',
  'cancelSearch',
  'compareFiles',
  'imagePair',
  'reflog',
  'backups',
  'mergePreview',
  'commitChecks',
  'releaseCommits',
  'previousTag',
  'ignoreRule',
  'ignoredFiles'
])

/**
 * Operations that wait on the user, outside the queue: an external merge tool can stay open for
 * minutes, and only touches the index when it exits.
 */
const UNQUEUED = new Set<OpName>(['openMergeTool', 'openDiffTool'])

const queues = new Map<string, Promise<unknown>>()

/** Serializes writes per repository: concurrent git commands would fight over index.lock. */
function enqueue<T>(repo: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(repo) ?? Promise.resolve()).catch(() => undefined).then(work)
  queues.set(repo, next)
  return next
}

export function runOp<K extends OpName>(
  repo: string,
  name: K,
  args: OpArgs<K>
): Promise<OpResult<K>> {
  // The name comes over IPC: don't let it reach inherited properties
  if (!Object.hasOwn(ops, name))
    return Promise.reject(new Error(`Unknown operation: ${String(name)}`))
  const impl = ops[name] as (repo: string, ...args: OpArgs<K>) => Promise<OpResult<K>>
  const work = (): Promise<OpResult<K>> => impl(repo, ...args)
  if (READ_ONLY.has(name)) return work()
  const label = actionLabel(name, args)
  if (UNQUEUED.has(name)) return inAction(label, work)
  return enqueue(repo, () =>
    inAction(label, () => recorded(repo, name, args, () => backedUp(repo, name, args, label, work)))
  )
}

const short = (hash: string): string => hash.slice(0, 7)
const shortRef = (ref: string): string => ref.replace(/^refs\/(heads|remotes)\//, '')

/** Labels of actions in the activity log that aren't undoable, or read better than the undo label. */
const LABELS: { [K in OpName]?: (...args: OpArgs<K>) => string } = {
  push: (force) => (force ? 'Force push' : 'Push'),
  ignore: (pattern) => `Ignore ${pattern}`,
  setSigning: () => 'Set commit signing',
  worktreeAdd: ({ path }) => `Add worktree ${path}`,
  worktreeRemove: (path) => `Remove worktree ${path}`,
  worktreeLock: (path, locked) => `${locked ? 'Lock' : 'Unlock'} worktree ${path}`,
  restoreBackup: (_id, ref) => `Restore ${shortRef(ref)} from a backup`
}

/** The action as shown in the activity log: "stashPush" becomes "Stash push". */
function actionLabel<K extends OpName>(name: K, args: OpArgs<K>): string {
  const label = LABELS[name] as ((...a: OpArgs<K>) => string) | undefined
  if (label) return label(...args)
  const undoable = UNDOABLE[name] as ((...a: OpArgs<K>) => { label: string }) | undefined
  if (undoable) return undoable(...args).label
  const words = name.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)
  return words[0].toUpperCase() + words.slice(1)
}

async function currentBranchRef(repo: string): Promise<string[]> {
  const ref = (await tryGit(repo, ['symbolic-ref', '-q', 'HEAD']))?.trim()
  return ref ? [ref] : []
}

/** Remote branch a push of the current branch would overwrite. */
async function pushTarget(repo: string): Promise<string[]> {
  const branch = await currentBranch(repo)
  const remote = await getConfig(repo, `branch.${branch}.remote`)
  const merge = await getConfig(repo, `branch.${branch}.merge`)
  if (remote && merge) return [`refs/remotes/${remote}/${merge.replace(/^refs\/heads\//, '')}`]
  const fallback = await defaultRemote(repo, branch).catch(() => null)
  return fallback ? [`refs/remotes/${fallback}/${branch}`] : []
}

/** Operations that rewrite or overwrite history, and the refs to back up before them (NFR-04). */
const BACKED_UP: { [K in OpName]?: (repo: string, ...args: OpArgs<K>) => Promise<string[]> } = {
  reset: (repo) => currentBranchRef(repo),
  rebase: (repo) => currentBranchRef(repo),
  rebaseInteractive: (repo) => currentBranchRef(repo),
  moveCommits: async (repo, _from, target, create) => [
    ...(await currentBranchRef(repo)),
    ...(create ? [] : [`refs/heads/${target}`])
  ],
  reword: (repo) => currentBranchRef(repo),
  fixup: (repo) => currentBranchRef(repo),
  splitCommit: (repo) => currentBranchRef(repo),
  reorderCommits: (repo) => currentBranchRef(repo),
  push: async (repo, force) => (force ? pushTarget(repo) : []),
  // Restoring a backup moves the branch too: where it was is saved first
  restoreBackup: async (_repo, _id, ref) => [ref]
}

/** Runs an operation, backing up the refs it may rewrite; the backup is dropped if they didn't move. */
async function backedUp<K extends OpName>(
  repo: string,
  name: K,
  args: OpArgs<K>,
  label: string,
  work: () => Promise<OpResult<K>>
): Promise<OpResult<K>> {
  const refsOf = BACKED_UP[name] as
    ((repo: string, ...a: OpArgs<K>) => Promise<string[]>) | undefined
  if (!refsOf) return work()
  const backup = await backups.createBackup(repo, label, await refsOf(repo, ...args))
  try {
    return await work()
  } finally {
    // A rebase stopped on conflicts hasn't moved the branch yet: keep the backup
    if (backup && !(await readOperation(repo))) await backups.dropIfUnchanged(repo, backup)
  }
}

/** Undoable operations: history label, and how undo/redo move the current branch (default keep). */
const UNDOABLE: {
  [K in OpName]?: (...args: OpArgs<K>) => { label: string; move?: history.BranchMove }
} = {
  commit: (_message, amend) => ({ label: amend ? 'Amend commit' : 'Commit', move: 'soft' }),
  // The files are the same: undo only puts the old message back
  reword: (hash) => ({ label: `Reword ${short(hash)}`, move: 'soft' }),
  // Undo gives the added changes back as staged changes
  fixup: (hash) => ({ label: `Fixup ${short(hash)}`, move: 'soft' }),
  // The files are the same before and after
  splitCommit: (hash) => ({ label: `Split ${short(hash)}`, move: 'soft' }),
  reorderCommits: () => ({ label: 'Reorder commits' }),
  checkout: (branch) => ({ label: `Checkout ${branch}` }),
  checkoutRemote: (_remote, localName) => ({ label: `Checkout ${localName}` }),
  checkoutCommit: (hash) => ({ label: `Checkout ${short(hash)}` }),
  createBranch: (name) => ({ label: `Create branch ${name}` }),
  renameBranch: (oldName, newName) => ({ label: `Rename ${oldName} to ${newName}` }),
  deleteBranch: (name) => ({ label: `Delete branch ${name}` }),
  fastForwardBranch: (branch, to) => ({ label: `Fast-forward ${branch} to ${to}` }),
  createTag: (name) => ({ label: `Create tag ${name}` }),
  deleteTag: (name) => ({ label: `Delete tag ${name}` }),
  pull: () => ({ label: 'Pull' }),
  merge: (ref) => ({ label: `Merge ${ref}` }),
  rebase: (onto) => ({ label: `Rebase onto ${onto}` }),
  rebaseInteractive: () => ({ label: 'Interactive rebase' }),
  cherryPick: (hashes) => ({
    label:
      hashes.length === 1
        ? `Cherry-pick ${short(hashes[0])}`
        : `Cherry-pick ${hashes.length} commits`
  }),
  moveCommits: (_from, target) => ({ label: `Move commits to ${target}` }),
  revert: (hash) => ({ label: `Revert ${short(hash)}` }),
  reset: (hash, mode) => ({
    label: `Reset to ${short(hash)} (${mode})`,
    move: mode === 'hard' ? 'keep' : mode
  }),
  restoreBackup: (_id, ref) => ({ label: `Restore ${shortRef(ref)}` })
}

/** Runs a write operation, recording undoable ones in the history once they complete. */
async function recorded<K extends OpName>(
  repo: string,
  name: K,
  args: OpArgs<K>,
  work: () => Promise<OpResult<K>>
): Promise<OpResult<K>> {
  if (name === 'abortOperation') {
    const pending = await history.takePending(repo)
    const result = await work()
    // An abort puts back only what the stopped command changed: an action that did more before
    // it, like moving commits, can still be undone (nothing is recorded if nothing changed)
    if (pending)
      await history.record(
        repo,
        pending.label,
        pending.before,
        await history.captureRefs(repo),
        pending.move
      )
    return result
  }
  if (name === 'continueOperation' || name === 'skipOperation') {
    try {
      return await work()
    } finally {
      // The operation that stopped on conflicts is complete: now it can be undone
      const pending = (await readOperation(repo)) ? undefined : await history.takePending(repo)
      if (pending) {
        await history.record(
          repo,
          pending.label,
          pending.before,
          await history.captureRefs(repo),
          pending.move
        )
      }
    }
  }
  const describe = UNDOABLE[name] as
    ((...a: OpArgs<K>) => { label: string; move?: history.BranchMove }) | undefined
  if (!describe) return work()

  const { label, move = 'keep' } = describe(...args)
  const before = await history.captureRefs(repo)
  let result: OpResult<K> | undefined
  try {
    result = await work()
    return result
  } finally {
    // Recorded even on failure: an auto-stashed checkout can fail after switching branch
    if (await readOperation(repo)) {
      await history.setPending(repo, label, before, move)
    } else {
      await history.takePending(repo)
      // A hard reset returns the stash where it saved the uncommitted changes
      const stash = name === 'reset' && typeof result === 'string' ? result : undefined
      await history.record(repo, label, before, await history.captureRefs(repo), move, stash)
    }
  }
}
