// Helpers shared by the repository operations: argument checks and small git queries.
import { lstat, readdir } from 'fs/promises'
import { relative, resolve } from 'path'
import type { OpArgs, OpName, OpOutcome, OpResult, PushChoice, PushPlan } from '../../../shared/api'
import { GitError, runGit, tryGit } from '../exec'
import { readOperation } from '../repository'

/** Where deleted files go: "Recycle Bin" on Windows, "Trash" elsewhere */
export const TRASH = process.platform === 'win32' ? 'Recycle Bin' : 'Trash'

export type OpImpl = { [K in OpName]: (repo: string, ...args: OpArgs<K>) => Promise<OpResult<K>> }

const HASH_RE = /^[0-9a-f]{4,64}$/i

/** Files counted in each folder before its size is shown as partial: node_modules can hold 100k */
const CLEAN_COUNT_BUDGET = 5000

/** Rejects values git would parse as options. */
export function assertArg(value: string, what: string): void {
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

export const assertBranchName = (repo: string, name: string): Promise<void> =>
  assertRefName(repo, 'refs/heads/', name, 'branch name')
export const assertTagName = (repo: string, name: string): Promise<void> =>
  assertRefName(repo, 'refs/tags/', name, 'tag name')

/** A revision typed or picked by the user: a hash, a branch or tag name, HEAD~2… */
export function assertRev(rev: string): void {
  assertArg(rev, 'revision')
  // Whitespace and ':' never appear in branch or tag names; ':' would name a path in a tree
  if (/[\s:]/.test(rev)) throw new Error(`Invalid revision: ${rev}`)
}

export function assertHash(hash: string): void {
  if (!HASH_RE.test(hash)) throw new Error(`Invalid commit hash: ${hash}`)
}

/** Absolute path of a file in the working tree, refusing paths that escape it. */
export function repoFile(repo: string, path: string): string {
  assertArg(path, 'path')
  const file = resolve(repo, path)
  const rel = relative(repo, file)
  if (!rel || rel.startsWith('..') || resolve(rel) === rel) {
    throw new Error(`Path outside the repository: ${path}`)
  }
  return file
}

export async function assertIdle(repo: string): Promise<void> {
  const operation = await readOperation(repo)
  if (operation) throw new Error(`A ${operation} is in progress: continue or abort it first`)
}

/**
 * Runs a command that may stop on conflicts. Stopping is an outcome, not an error: the repository
 * is left mid-operation (or with unmerged files, for squash merges) for the user to resolve.
 */
export async function withConflicts(
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
export function runWithPaths(repo: string, args: string[], paths: string[]): Promise<string> {
  return runGit(
    repo,
    ['--literal-pathspecs', ...args, '--pathspec-from-file=-', '--pathspec-file-nul'],
    { input: paths.join('\0') }
  )
}

/** Bytes and files of a file or folder, without following links; partial past the budget. */
export async function entrySize(
  file: string
): Promise<{ size: number; files: number; partial: boolean }> {
  const info = await lstat(file).catch(() => null)
  if (!info) return { size: 0, files: 0, partial: false }
  if (!info.isDirectory()) return { size: info.size, files: 1, partial: false }
  let size = 0
  let files = 0
  let budget = CLEAN_COUNT_BUDGET
  const folders = [file]
  while (folders.length) {
    const folder = folders.pop() as string
    const children = await readdir(folder, { withFileTypes: true }).catch(() => [])
    for (const child of children) {
      if (budget-- <= 0) return { size, files, partial: true }
      const path = resolve(folder, child.name)
      if (child.isDirectory()) folders.push(path)
      else {
        files++
        size += (await lstat(path).catch(() => null))?.size ?? 0
      }
    }
  }
  return { size, files, partial: false }
}

export async function hasHead(repo: string): Promise<boolean> {
  return (await tryGit(repo, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null
}

export async function currentBranch(repo: string): Promise<string> {
  const branch = (await tryGit(repo, ['symbolic-ref', '-q', '--short', 'HEAD']))?.trim()
  if (!branch) throw new Error('HEAD is detached: check out a branch first')
  return branch
}

export async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null
}

export async function getConfig(repo: string, key: string): Promise<string | null> {
  return (await tryGit(repo, ['config', '--get', key]))?.trim() || null
}

/**
 * Values of the config keys matching `pattern`, by key as git writes them: section and name in
 * lowercase, the branch or remote name as it is. The last value of a key wins, as in git.
 */
export async function configValues(repo: string, pattern: string): Promise<Map<string, string>> {
  const output = await tryGit(repo, ['config', '-z', '--get-regexp', pattern])
  const values = new Map<string, string>()
  for (const entry of (output ?? '').split('\0').filter(Boolean)) {
    const at = entry.indexOf('\n')
    // A key without a value is a true boolean
    if (at < 0) values.set(entry, 'true')
    else values.set(entry.slice(0, at), entry.slice(at + 1))
  }
  return values
}

interface PushSettings {
  /**
   * Remote the push goes to, chosen as git does: the branch's pushRemote, remote.pushDefault, the
   * remote of its upstream, the only remote, origin. Null when there are several and none is origin.
   */
  remote: string | null
  /** The upstream's remote and branch (refs/heads/…) */
  upstream: string | null
  merge: string | null
  /** push.default: simple, current, upstream, matching or nothing */
  mode: string
}

async function pushSettings(repo: string, branch: string): Promise<PushSettings> {
  const config = await configValues(
    repo,
    '^(remote\\.pushdefault|push\\.default|branch\\..+\\.(remote|merge|pushremote))$'
  )
  const value = (key: string): string | null => config.get(key) || null
  const upstream = value(`branch.${branch}.remote`)
  const merge = value(`branch.${branch}.merge`)
  const mode = value('push.default') ?? 'simple'
  const configured = value(`branch.${branch}.pushremote`) ?? value('remote.pushdefault') ?? upstream
  if (configured) return { remote: configured, upstream, merge, mode }
  const remotes = (await runGit(repo, ['remote'])).split('\n').filter(Boolean)
  if (remotes.length === 0) throw new Error('No remote configured: add one first')
  const remote = remotes.length === 1 ? remotes[0] : remotes.includes('origin') ? 'origin' : null
  return { remote, upstream, merge, mode }
}

const OWN = (branch: string): string => `refs/heads/${branch}`

/**
 * Whether git would refuse the push: push.default is simple, and the branch follows a branch with
 * another name on the remote it goes to, e.g. one created from origin/main.
 */
const refusedUpstream = (s: PushSettings, branch: string): boolean =>
  s.mode === 'simple' && !!s.merge && s.upstream === s.remote && s.merge !== OWN(branch)

/** What a push of the branch needs from the user, where git can't decide alone. */
export async function pushPlanOf(repo: string, branch: string): Promise<PushPlan> {
  const s = await pushSettings(repo, branch)
  return {
    remote: s.remote,
    renamedUpstream: refusedUpstream(s, branch)
      ? `${s.upstream}/${s.merge!.replace(/^refs\/heads\//, '')}`
      : null
  }
}

export interface PushDestination {
  remote: string
  /** Branch on the remote, e.g. refs/heads/main */
  ref: string
  /** The branch is to follow it afterwards */
  setUpstream: boolean
}

/** Where a push of the branch goes, as git's push.default says; `choice` is the user's answer. */
export async function pushDestination(
  repo: string,
  branch: string,
  choice: PushChoice = {}
): Promise<PushDestination> {
  if (choice.remote !== undefined) assertArg(choice.remote, 'remote')
  const s = await pushSettings(repo, branch)
  if (choice.remote !== undefined) s.remote = choice.remote
  const to = s.remote
  if (!to)
    throw new Error(`There are several remotes and none is origin: choose where to push ${branch}`)
  if (s.mode === 'nothing')
    throw new Error('git is set to push only what you name (push.default=nothing)')
  const own = OWN(branch)
  if (s.upstream !== to || !s.merge) {
    // A fork set as pushRemote gets a branch of the same name, and the upstream stays: but not
    // with push.default=upstream, which only pushes to the upstream
    if (s.mode === 'upstream' && s.merge)
      throw new Error(
        `${branch} would go to ${to}, which isn't its upstream's remote (push.default=upstream)`
      )
    return { remote: to, ref: own, setUpstream: !(s.upstream && s.merge) }
  }
  if (!refusedUpstream(s, branch) || choice.toUpstream === true) {
    // current and matching push to a branch of the same name, upstream to the upstream
    const same = s.mode === 'current' || s.mode === 'matching'
    return { remote: to, ref: same && !choice.toUpstream ? own : s.merge, setUpstream: false }
  }
  // Where git would refuse: to a branch of its own name, followed from then on
  if (choice.toUpstream === false) return { remote: to, ref: own, setUpstream: true }
  throw new Error(
    `${branch} follows ${to}/${s.merge.replace(/^refs\/heads\//, '')}, which has another name: ` +
      'choose where to push it'
  )
}

export async function firstParentOf(repo: string, hash: string): Promise<string | undefined> {
  const [, firstParent] = (await runGit(repo, ['rev-list', '--parents', '-n1', hash]))
    .trim()
    .split(' ')
  return firstParent
}

export const short = (hash: string): string => hash.slice(0, 7)
