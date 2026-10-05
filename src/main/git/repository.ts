import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import type {
  BisectState,
  Commit,
  CommitDetail,
  GraphFilter,
  HeadInfo,
  Identity,
  LfsInfo,
  Ref,
  Signing,
  RepoOperation,
  RepoSnapshot,
  Submodule,
  WorkingTreeStatus,
  Worktree
} from '../../shared/types'
import {
  FIELD,
  LOG_FORMAT,
  REF_FORMAT,
  SIGNATURE_FORMAT,
  STASH_FORMAT,
  parseIdentity,
  parseLfsPatterns,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseSignature,
  parseSigning,
  parseStashes,
  parseStatus,
  parseSubmodules,
  parseWorktrees
} from './parsers'
import { GitError, runGit, tryGit } from './exec'
import { historyLabels } from './history'
import { gitBinary } from '../settings'
import { gitDirs } from './gitdir'

/** Commits loaded at first, and per page as the graph scrolls down (GRAPH-08). */
export const COMMIT_PAGE = 10000
/** Commits searched by the graph search, beyond the loaded ones. */
export const COMMIT_LIMIT = 10000

const HASH_RE = /^[0-9a-f]{4,64}$/i

const roots = new Map<string, Promise<string>>()

/** Resolves the top-level directory of the repository containing `path`; asked once per path. */
export function resolveRepoRoot(path: string): Promise<string> {
  let root = roots.get(path)
  if (!root) {
    root = findRepoRoot(path)
    roots.set(path, root)
    root.catch(() => roots.delete(path))
  }
  return root
}

async function findRepoRoot(path: string): Promise<string> {
  try {
    const root = await runGit(path, ['rev-parse', '--show-toplevel'])
    return root.trim()
  } catch (e) {
    throw new GitError(
      `Not a git repository: ${path}`,
      [],
      e instanceof GitError ? e.exitCode : null,
      ''
    )
  }
}

/** HEAD, read from its file: two git processes less on every refresh. */
async function readHead(repo: string, refs: Ref[]): Promise<HeadInfo> {
  const { gitDir } = await gitDirs(repo)
  const head = (await readFile(resolve(gitDir, 'HEAD'), 'utf8').catch(() => '')).trim()
  const symbolic = /^ref: refs\/heads\/(.+)$/.exec(head)
  // Reftable repositories keep a placeholder there
  if (symbolic && symbolic[1] !== '.invalid') {
    const hash = refs.find((r) => r.fullName === `refs/heads/${symbolic[1]}`)?.hash ?? null
    return { branch: symbolic[1], hash }
  }
  if (/^[0-9a-f]{40,64}$/.test(head)) return { branch: null, hash: head }
  const [branch, hash] = await Promise.all([
    tryGit(repo, ['symbolic-ref', '-q', '--short', 'HEAD']),
    tryGit(repo, ['rev-parse', '--verify', '-q', 'HEAD'])
  ])
  return { branch: branch?.trim() || null, hash: hash?.trim() || null }
}

export async function loadStatus(repo: string): Promise<WorkingTreeStatus> {
  return parseStatus(
    await runGit(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  )
}

/** Detects a merge/rebase/cherry-pick/revert left in progress, from the marker files in the git dir. */
export async function readOperation(repo: string): Promise<RepoOperation | null> {
  const { gitDir } = await gitDirs(repo)
  const has = (name: string): boolean => existsSync(resolve(gitDir, name))
  // git am keeps its patches in rebase-apply too, and marks them as its own
  if (has('rebase-apply/applying')) return 'am'
  if (has('rebase-merge') || has('rebase-apply')) return 'rebase'
  if (has('MERGE_HEAD')) return 'merge'
  if (has('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (has('REVERT_HEAD')) return 'revert'
  return null
}

/** The bisect in progress, from its files and refs/bisect; null when there is none. */
export async function readBisect(
  repo: string,
  refsOutput: Promise<string>
): Promise<BisectState | null> {
  const { gitDir } = await gitDirs(repo)
  const start = await readFile(resolve(gitDir, 'BISECT_START'), 'utf8').catch(() => null)
  if (start === null) return null
  let bad: string | null = null
  const good: string[] = []
  const skipped: string[] = []
  for (const line of (await refsOutput).split('\n')) {
    const [name, hash] = line.split(FIELD)
    if (name === 'refs/bisect/bad') bad = hash
    else if (name?.startsWith('refs/bisect/good-')) good.push(hash)
    else if (name?.startsWith('refs/bisect/skip-')) skipped.push(hash)
  }
  // Between the good commits and the bad one: where the problem came in
  const candidates =
    bad && good.length
      ? (await runGit(repo, ['rev-list', bad, '--not', ...good])).split('\n').filter(Boolean)
      : []
  const untested = candidates.filter((hash) => hash !== bad && !skipped.includes(hash))
  return {
    original: start.trim(),
    bad,
    good,
    skipped,
    candidates: candidates.length,
    culprit: candidates.length === 1 ? bad : null,
    onlySkipped: candidates.length > 1 && untested.length === 0
  }
}

/** Submodules, when the repository declares any: `submodule status` is slow on large repositories. */
async function loadSubmodules(repo: string): Promise<Submodule[]> {
  if (!existsSync(resolve(repo, '.gitmodules'))) return []
  const [status, config] = await Promise.all([
    tryGit(repo, ['submodule', 'status']),
    tryGit(repo, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url)$'])
  ])
  return parseSubmodules(status ?? '', config ?? '')
}

// Installing git-lfs while GitDom runs is rare: checked once
let lfsInstalled: Promise<boolean> | null = null

/**
 * Whether git-lfs is next to git or on the PATH, looking at the disk: `git lfs version` takes most
 * of a second on some machines, and the first snapshot waited for it. Null when unsure.
 */
export function lfsOnDisk(
  git: string,
  path = process.env.PATH ?? '',
  exists: (file: string) => boolean = existsSync
): boolean | null {
  if (process.platform !== 'win32') return null
  const dirs = path.split(';').filter(Boolean)
  // Git for Windows: <root>\cmd\git.exe, with git-lfs in <root>\mingw64\bin
  const gitDir = git.includes('\\') || git.includes('/') ? dirname(git) : null
  const roots = [gitDir, ...dirs.filter((d) => exists(join(d, 'git.exe')))]
    .filter((d): d is string => !!d)
    .map((d) => resolve(d, '..'))
  const candidates = [
    ...dirs.map((d) => join(d, 'git-lfs.exe')),
    ...roots.flatMap((r) => [
      join(r, 'mingw64', 'bin', 'git-lfs.exe'),
      join(r, 'mingw64', 'libexec', 'git-core', 'git-lfs.exe')
    ])
  ]
  return candidates.some((c) => exists(c)) ? true : null
}

async function loadLfs(repo: string): Promise<LfsInfo> {
  lfsInstalled ??= lfsOnDisk(gitBinary())
    ? Promise.resolve(true)
    : tryGit(repo, ['lfs', 'version']).then((v) => v !== null)
  const attributes = await readFile(resolve(repo, '.gitattributes'), 'utf8').catch(() => '')
  return { installed: await lfsInstalled, patterns: parseLfsPatterns(attributes) }
}

export async function loadIdentity(repo: string): Promise<Identity> {
  const output = await tryGit(repo, [
    'config',
    '--show-scope',
    '--get-regexp',
    '^user\\.(name|email)$'
  ])
  return parseIdentity(output ?? '')
}

/** Identity and signing settings with one git process. */
async function loadIdentityAndSigning(repo: string): Promise<[Identity, Signing]> {
  const output = await tryGit(repo, [
    'config',
    '--show-scope',
    '--get-regexp',
    '^(user\\.(name|email|signingkey)|gpg\\.format|commit\\.gpgsign|tag\\.gpgsign)$'
  ])
  const lines = (output ?? '').split('\n')
  // parseSigning reads "key value" lines: drop the scope
  const signing = lines.map((line) => line.slice(line.indexOf('\t') + 1)).join('\n')
  return [parseIdentity(output ?? ''), parseSigning(signing)]
}

/** Stashes, when refs/stash exists: most repositories have none. */
async function loadStashes(repo: string, refs: Promise<string>): Promise<string> {
  if (!(await refs).split('\n').some((line) => line.startsWith(`refs/stash${FIELD}`))) return ''
  return (await tryGit(repo, ['stash', 'list', `--format=${STASH_FORMAT}`])) ?? ''
}

/** Worktrees; without linked ones, the main one alone, without asking git. */
async function loadWorktrees(repo: string, head: Promise<HeadInfo>): Promise<Worktree[]> {
  const { commonDir } = await gitDirs(repo)
  if (!existsSync(resolve(commonDir, 'worktrees'))) {
    const { branch, hash } = await head
    const main = { path: repo.replace(/\\/g, '/'), head: hash, branch, main: true, bare: false }
    return [{ ...main, locked: null, prunable: null }]
  }
  return parseWorktrees((await tryGit(repo, ['worktree', 'list', '--porcelain'])) ?? '')
}

const SIGNING_PROGRAMS: Record<string, string> = {
  'gpg.program': 'gpg',
  'gpg.ssh.program': 'ssh-keygen',
  'gpg.x509.program': 'gpgsm'
}

/**
 * `-c` options restoring the default of signing programs configured as empty: git would fail to
 * sign, and report every signature as bad.
 */
export async function signingProgramArgs(repo: string): Promise<string[]> {
  const output = await tryGit(repo, ['config', '--get-regexp', '^gpg\\.(ssh\\.|x509\\.)?program$'])
  const programs = new Map<string, string>()
  for (const line of (output ?? '').split('\n')) {
    const [key, ...value] = line.replace(/\r$/, '').split(' ')
    if (key in SIGNING_PROGRAMS) programs.set(key, value.join(' ').trim())
  }
  return [...programs]
    .filter(([, value]) => !value)
    .flatMap(([key]) => ['-c', `${key}=${SIGNING_PROGRAMS[key]}`])
}

/** Revisions for `git log`: every ref but the hidden ones, or the single ref shown alone. */
export function logRevisions(filter?: GraphFilter): string[] {
  // Whitespace, control characters and '..' never appear in ref names
  const valid = (ref: string): boolean =>
    ref.startsWith('refs/') &&
    !/\s/.test(ref) &&
    ![...ref].some((ch) => ch.charCodeAt(0) < 32) &&
    !ref.includes('..')
  if (filter?.solo && valid(filter.solo)) return [filter.solo]
  const hidden = (filter?.hidden ?? []).filter(valid)
  // Glob characters in a hidden name would hide more than asked: escape them
  const exclude = hidden.map((ref) => `--exclude=${ref.replace(/[*?[\\]/g, '\\$&')}`)
  // Backups (backups.ts) keep old commits alive: they'd bring them back into the graph
  return ['--exclude=refs/stash', '--exclude=refs/gitdom/*', ...exclude, '--all']
}

/** The graph's commits from `skip` on, newest first; `more` when there are older ones. */
export async function loadCommits(
  repo: string,
  filter: GraphFilter | undefined,
  skip: number,
  count: number
): Promise<{ commits: Commit[]; more: boolean }> {
  // An empty repository has no refs, so log may fail: treat it as no commits
  const log = await tryGit(repo, [
    'log',
    '--date-order',
    `--skip=${Math.max(0, Math.floor(skip))}`,
    `-n${Math.floor(count) + 1}`,
    `--format=${LOG_FORMAT}`,
    ...logRevisions(filter),
    '--'
  ])
  const commits = parseLog(log ?? '')
  const more = commits.length > count
  if (more) commits.length = count
  return { commits, more }
}

const commitGraphChecked = new Set<string>()

/**
 * Writes git's commit-graph file when a big repository lacks one (NFR-03): without it, sorting
 * the history for the graph reads every commit, some seconds on a million of them. Git writes it
 * itself only on gc. Once per repository and session, in the background.
 */
export async function ensureCommitGraph(repo: string): Promise<void> {
  if (commitGraphChecked.has(repo)) return
  commitGraphChecked.add(repo)
  const [single, chain] = (
    await runGit(repo, [
      'rev-parse',
      '--git-path',
      'objects/info/commit-graph',
      '--git-path',
      'objects/info/commit-graphs/commit-graph-chain'
    ])
  )
    .split('\n')
    .map((p) => resolve(repo, p.trim()))
  if (existsSync(single) || existsSync(chain)) return
  await tryGit(repo, ['commit-graph', 'write', '--reachable'])
}

/**
 * The snapshot of the repository at `path`, any folder of it. A tab is nearly always the top folder:
 * then the snapshot doesn't wait for git to confirm it, one process less before the graph.
 */
export async function openSnapshot(
  path: string,
  filter?: GraphFilter,
  limit?: number
): Promise<RepoSnapshot> {
  if (roots.has(path) || !existsSync(join(path, '.git')))
    return loadSnapshot(await resolveRepoRoot(path), filter, limit)
  const [root, snapshot] = await Promise.all([
    resolveRepoRoot(path),
    loadSnapshot(path, filter, limit)
  ])
  return { ...snapshot, path: root, name: basename(root) }
}

export async function loadSnapshot(
  repo: string,
  filter?: GraphFilter,
  limit = COMMIT_PAGE
): Promise<RepoSnapshot> {
  // Starting git is slow on some machines: every process spared counts (NFR-02)
  const refsOutput = runGit(repo, ['for-each-ref', `--format=${REF_FORMAT}`])
  const parsedRefs = refsOutput.then(parseRefs)
  const headInfo = parsedRefs.then((refs) => readHead(repo, refs))
  const [
    head,
    page,
    refs,
    stashes,
    remotes,
    status,
    operation,
    bisect,
    submodules,
    lfs,
    [identity, signing],
    worktrees,
    history
  ] = await Promise.all([
    headInfo,
    loadCommits(repo, filter, 0, Math.max(COMMIT_PAGE, limit)),
    parsedRefs,
    loadStashes(repo, refsOutput),
    runGit(repo, ['remote', '-v']),
    loadStatus(repo),
    readOperation(repo),
    readBisect(repo, refsOutput),
    loadSubmodules(repo),
    loadLfs(repo),
    loadIdentityAndSigning(repo),
    loadWorktrees(repo, headInfo),
    historyLabels(repo)
  ])

  return {
    path: repo,
    name: basename(repo),
    head,
    commits: page.commits,
    refs,
    stashes: parseStashes(stashes),
    remotes: parseRemotes(remotes),
    status,
    operation,
    bisect,
    history,
    truncated: page.more,
    submodules,
    worktrees,
    lfs,
    identity,
    signing
  }
}

export async function loadCommitDetail(repo: string, hash: string): Promise<CommitDetail> {
  if (!HASH_RE.test(hash)) throw new Error(`Invalid commit hash: ${hash}`)

  // The signature is verified with the configured program (gpg, ssh-keygen…), before the free text
  const format = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ct', SIGNATURE_FORMAT, '%s', '%b'].join(
    '%x1f'
  )
  const header = await runGit(repo, [
    ...(await signingProgramArgs(repo)),
    'show',
    '-s',
    `--format=${format}`,
    hash
  ])
  const [
    fullHash,
    parents,
    authorName,
    authorEmail,
    authorDate,
    committerName,
    committerDate,
    signatureStatus,
    signer,
    signingKey,
    subject,
    body
  ] = header.split(FIELD)
  const parentList = parents ? parents.split(' ') : []

  // Merge commits are shown against their first parent
  const files =
    parentList.length > 1
      ? await runGit(repo, ['diff', '--name-status', '-z', '-M', parentList[0], fullHash])
      : await runGit(repo, [
          'diff-tree',
          '--no-commit-id',
          '-r',
          '--root',
          '--name-status',
          '-z',
          '-M',
          fullHash
        ])

  return {
    hash: fullHash,
    parents: parentList,
    authorName,
    authorEmail,
    authorDate: Number(authorDate),
    committerName,
    committerDate: Number(committerDate),
    subject,
    body: (body ?? '').trim(),
    signature: parseSignature(signatureStatus, signer, signingKey),
    files: parseNameStatus(files)
  }
}
