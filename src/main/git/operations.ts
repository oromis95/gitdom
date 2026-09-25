// Repository operations exposed to the renderer through the `repo:op` IPC channel.
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { relative, resolve } from 'path'
import type {
  MergeMode,
  OpArgs,
  OpName,
  OpOutcome,
  OpResult,
  ResetMode,
  StashMode
} from '../../shared/api'
import { parseDiff } from '../../shared/diff'
import {
  FILE_LOG_FORMAT,
  REFLOG_FORMAT,
  parseBlame,
  parseFileLog,
  parseNameStatus,
  parseReflog
} from './parsers'
import type { DiffOptions, FileDiff, ImagePair } from '../../shared/types'
import { GitError, runGit, tryGit } from './exec'
import { toolSettings } from '../settings'
import {
  COMMIT_LIMIT,
  loadCommitDetail,
  loadStatus,
  logRevisions,
  readOperation
} from './repository'
import * as history from './history'
import * as backups from './backups'
import { inAction } from './activity'

type OpImpl = { [K in OpName]: (repo: string, ...args: OpArgs<K>) => Promise<OpResult<K>> }

const HASH_RE = /^[0-9a-f]{4,64}$/i
const STASH_RE = /^stash@\{\d+\}$/
const AUTO_STASH_MESSAGE = 'GitDom auto-stash before checkout'
const FILE_HISTORY_LIMIT = 5000
const REFLOG_LIMIT = 2000
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

/** An image in the working tree as a data URL, or null when it was deleted. */
async function worktreeImage(repo: string, path: string): Promise<string | null> {
  const full = resolve(repo, path)
  if (relative(repo, full).startsWith('..')) throw new Error(`Invalid path: ${path}`)
  const info = await stat(full).catch(() => null)
  if (!info) return null
  if (info.size > IMAGE_LIMIT) throw new Error(`${path} is too large to preview`)
  return `data:${imageType(path)};base64,${(await readFile(full)).toString('base64')}`
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
    if (!text.trim()) return []
    if (/[\0\n\r]/.test(text)) throw new Error('Invalid search text')
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

  async compareFiles(repo, from, to) {
    assertRev(from)
    assertRev(to)
    return parseNameStatus(
      await runGit(repo, ['diff', '--no-ext-diff', '--name-status', '-z', '-M', from, to])
    )
  },

  commitDetail: (repo, hash) => loadCommitDetail(repo, hash),

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

  commit(repo, message, amend) {
    if (!message.trim()) throw new Error('The commit message is empty')
    const args = ['commit', '-F', '-']
    if (amend) args.push('--amend')
    return runGit(repo, args, { input: message, withStderr: true })
  },

  async lastCommitMessage(repo) {
    return (await runGit(repo, ['log', '-1', '--format=%B'])).trim()
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
    return withConflicts(repo, ['merge', '--no-edit', ...flags[mode], ref])
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
          `exec git commit --amend --allow-empty -q -F ${quote(file)}`
        )
      } else {
        lines.push(`${step.action} ${step.hash}`)
      }
    }
    const todoFile = resolve(dir, 'todo.txt')
    await writeFile(todoFile, lines.join('\n') + '\n', 'utf8')

    return withConflicts(
      repo,
      ['rebase', '-i', '--autostash', base ?? '--root'],
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

  async isAncestor(repo, ancestor, descendant) {
    assertArg(ancestor, 'commit')
    assertArg(descendant, 'commit')
    return (await tryGit(repo, ['merge-base', '--is-ancestor', ancestor, descendant])) !== null
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

  async stashPush(repo, message, includeUntracked) {
    const args = ['stash', 'push']
    if (includeUntracked) args.push('--include-untracked')
    if (message.trim()) args.push('-m', message.trim())
    await runGit(repo, args)
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

  async createTag(repo, name, target, message) {
    await assertTagName(repo, name)
    assertArg(target, 'tag target')
    const args = message?.trim()
      ? ['tag', '-a', '-m', message.trim(), name, target]
      : ['tag', name, target]
    await runGit(repo, args)
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

  async lfsTrack(repo, pattern) {
    assertArg(pattern, 'pattern')
    await runGit(repo, ['lfs', 'track', pattern])
  },

  async lfsUntrack(repo, pattern) {
    assertArg(pattern, 'pattern')
    await runGit(repo, ['lfs', 'untrack', pattern])
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
  }
}

/** Operations that only read: they skip the queue so a slow fetch doesn't delay diffs. */
const READ_ONLY = new Set<OpName>([
  'status',
  'diff',
  'commitDetail',
  'fileHistory',
  'blame',
  'lastCommitMessage',
  'conflictMarkers',
  'rebaseCommits',
  'readConflictFile',
  'isAncestor',
  'searchCommits',
  'compareFiles',
  'imagePair',
  'reflog',
  'backups'
])

/**
 * Operations that wait on the user, outside the queue: an external merge tool can stay open for
 * minutes, and only touches the index when it exits.
 */
const UNQUEUED = new Set<OpName>(['openMergeTool'])

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
    await history.takePending(repo)
    return work()
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
