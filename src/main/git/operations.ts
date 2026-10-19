// Repository operations exposed to the renderer through the `repo:op` IPC channel.
import type { OpArgs, OpName, OpResult } from '../../shared/api'
import { tryGit } from './exec'
import { readOperation } from './repository'
import * as history from './history'
import * as backups from './backups'
import { inAction } from './activity'
import { type OpImpl, TRASH, currentBranch, getConfig, defaultRemote, short } from './ops/shared'
import { contentOps } from './ops/content'
import { logOps } from './ops/log'
import { workingTreeOps } from './ops/workingTree'
import { commitOps } from './ops/commit'
import { mergeOps } from './ops/merge'
import { branchesOps } from './ops/branches'
import { remoteOps } from './ops/remote'
import { cleanOps } from './ops/clean'
import { maintenanceOps } from './ops/maintenance'
import { patchesOps } from './ops/patches'
import { hooksOps } from './ops/hooks'

export { setTrash } from './ops/clean'

const ops: OpImpl = {
  ...contentOps,
  ...logOps,
  ...workingTreeOps,
  ...commitOps,
  ...mergeOps,
  ...branchesOps,
  ...remoteOps,
  ...cleanOps,
  ...maintenanceOps,
  ...patchesOps,
  ...hooksOps
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
  'fileAt',
  'saveFileAt',
  'blame',
  'timelapse',
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
  'ignoredFiles',
  'cleanPreview',
  'branchOverview',
  'repoHealth',
  'heaviestObjects',
  'hooks',
  'readHook',
  'patchText',
  'inspectPatch',
  'repoSummary',
  'myCommits'
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

const shortRef = (ref: string): string => ref.replace(/^refs\/(heads|remotes)\//, '')

/** Labels of actions in the activity log that aren't undoable, or read better than the undo label. */
const LABELS: { [K in OpName]?: (...args: OpArgs<K>) => string } = {
  push: (force) => (force ? 'Force push' : 'Push'),
  ignore: (pattern) => `Ignore ${pattern}`,
  cleanFiles: (paths, toTrash) =>
    `${toTrash ? `Move to the ${TRASH}` : 'Delete'} ${paths.length === 1 ? paths[0] : `${paths.length} untracked files and folders`}`,
  setSigning: () => 'Set commit signing',
  worktreeAdd: ({ path }) => `Add worktree ${path}`,
  worktreeRemove: (path) => `Remove worktree ${path}`,
  worktreeLock: (path, locked) => `${locked ? 'Lock' : 'Unlock'} worktree ${path}`,
  restoreBackup: (_id, ref) => `Restore ${shortRef(ref)} from a backup`,
  bisectStart: () => 'Start bisect',
  bisectMark: (mark, hash) =>
    `Bisect: mark ${hash ? short(hash) : 'the checked out commit'} as ${mark === 'skip' ? 'skipped' : mark}`,
  bisectRun: (command) => `Bisect: run ${command}`,
  bisectReset: () => 'Stop bisect',
  savePatch: (dest) => `Save the patch ${dest}`,
  applyPatchFile: (path, stage) => `Apply ${path}${stage ? ' and stage it' : ''}`,
  saveHook: (name) => `Save the ${name} hook`,
  setHookEnabled: (name, enabled) => `Turn ${enabled ? 'on' : 'off'} the ${name} hook`,
  deleteHook: (name) => `Delete the ${name} hook`,
  runHook: (name) => `Run the ${name} hook`,
  maintain: (task) =>
    task === 'gc'
      ? 'Compress the repository (gc)'
      : task === 'prune'
        ? 'Prune unreachable objects'
        : 'Check the repository (fsck)'
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
  restoreBackup: async (_repo, _id, ref) => [ref],
  deleteBranches: async (_repo, names) => names.map((name) => `refs/heads/${name}`)
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
  deleteBranches: (names) => ({
    label: names.length === 1 ? `Delete branch ${names[0]}` : `Delete ${names.length} branches`
  }),
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
  restoreBackup: (_id, ref) => ({ label: `Restore ${shortRef(ref)}` }),
  amPatch: () => ({ label: 'Apply patch commits' })
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
