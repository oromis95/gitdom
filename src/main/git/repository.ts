import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename, resolve } from 'path'
import type {
  CommitDetail,
  GraphFilter,
  HeadInfo,
  Identity,
  LfsInfo,
  RepoOperation,
  RepoSnapshot,
  Submodule,
  WorkingTreeStatus
} from '../../shared/types'
import {
  FIELD,
  LOG_FORMAT,
  REF_FORMAT,
  STASH_FORMAT,
  parseIdentity,
  parseLfsPatterns,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseRemotes,
  parseStashes,
  parseStatus,
  parseSubmodules
} from './parsers'
import { GitError, runGit, tryGit } from './exec'
import { historyLabels } from './history'

/** Commits loaded per snapshot; incremental loading comes later (GRAPH-08). */
export const COMMIT_LIMIT = 10000

const HASH_RE = /^[0-9a-f]{4,64}$/i

/** Resolves the top-level directory of the repository containing `path`. */
export async function resolveRepoRoot(path: string): Promise<string> {
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

async function readHead(repo: string): Promise<HeadInfo> {
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
  const gitDir = resolve(repo, (await runGit(repo, ['rev-parse', '--git-dir'])).trim())
  const has = (name: string): boolean => existsSync(resolve(gitDir, name))
  if (has('rebase-merge') || has('rebase-apply')) return 'rebase'
  if (has('MERGE_HEAD')) return 'merge'
  if (has('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (has('REVERT_HEAD')) return 'revert'
  return null
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

async function loadLfs(repo: string): Promise<LfsInfo> {
  lfsInstalled ??= tryGit(repo, ['lfs', 'version']).then((v) => v !== null)
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
  return ['--exclude=refs/stash', ...exclude, '--all']
}

export async function loadSnapshot(repo: string, filter?: GraphFilter): Promise<RepoSnapshot> {
  const [head, log, refs, stashes, remotes, status, operation, submodules, lfs, identity] =
    await Promise.all([
      readHead(repo),
      // An empty repository has no refs, so log may fail: treat it as no commits
      tryGit(repo, [
        'log',
        '--date-order',
        `-n${COMMIT_LIMIT + 1}`,
        `--format=${LOG_FORMAT}`,
        ...logRevisions(filter),
        '--'
      ]),
      runGit(repo, ['for-each-ref', `--format=${REF_FORMAT}`]),
      tryGit(repo, ['stash', 'list', `--format=${STASH_FORMAT}`]),
      runGit(repo, ['remote', '-v']),
      loadStatus(repo),
      readOperation(repo),
      loadSubmodules(repo),
      loadLfs(repo),
      loadIdentity(repo)
    ])

  const commits = parseLog(log ?? '')
  const truncated = commits.length > COMMIT_LIMIT
  if (truncated) commits.length = COMMIT_LIMIT

  return {
    path: repo,
    name: basename(repo),
    head,
    commits,
    refs: parseRefs(refs),
    stashes: parseStashes(stashes ?? ''),
    remotes: parseRemotes(remotes),
    status,
    operation,
    history: await historyLabels(repo),
    truncated,
    submodules,
    lfs,
    identity
  }
}

export async function loadCommitDetail(repo: string, hash: string): Promise<CommitDetail> {
  if (!HASH_RE.test(hash)) throw new Error(`Invalid commit hash: ${hash}`)

  const format = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ct', '%s', '%b'].join('%x1f')
  const header = await runGit(repo, ['show', '-s', `--format=${format}`, hash])
  const [
    fullHash,
    parents,
    authorName,
    authorEmail,
    authorDate,
    committerName,
    committerDate,
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
    files: parseNameStatus(files)
  }
}
