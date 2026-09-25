// Undo/redo of GitDom actions, by restoring the branches, tags and HEAD captured around each action.
// The history is kept in the git directory, so it survives restarts.
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { runGit, tryGit } from './exec'

export interface RefState {
  /** Checked out branch, null when detached */
  branch: string | null
  /** HEAD commit, null in an empty repository */
  hash: string | null
  /** Full ref name (refs/heads/…, refs/tags/…) → object id; entries keep only the refs they change */
  refs: Record<string, string>
}

/**
 * How undo/redo move the checked out branch: soft keeps index and working tree (commit, soft reset),
 * mixed also realigns the index (mixed reset), keep refuses to lose uncommitted changes.
 */
export type BranchMove = 'soft' | 'mixed' | 'keep'

interface Entry {
  label: string
  before: RefState
  after: RefState
  move: BranchMove
  /** Stash holding the uncommitted changes a hard reset discarded: undo reapplies them */
  stash?: string
}

interface Pending {
  label: string
  before: RefState
  move: BranchMove
}

interface History {
  undo: Entry[]
  redo: Entry[]
  /** Action stopped on conflicts: recorded once continued */
  pending?: Pending
}

const MAX_ENTRIES = 50
const FILE = 'gitdom-history.json'
const histories = new Map<string, History>()

async function historyFile(repo: string): Promise<string> {
  return resolve(repo, (await runGit(repo, ['rev-parse', '--git-path', FILE])).trim())
}

async function historyOf(repo: string): Promise<History> {
  let history = histories.get(repo)
  if (!history) {
    history = { undo: [], redo: [] }
    try {
      const saved = JSON.parse(await readFile(await historyFile(repo), 'utf8')) as History
      if (Array.isArray(saved.undo) && Array.isArray(saved.redo)) history = saved
    } catch {
      // No history yet, or unreadable: start over
    }
    // Another call may have loaded it meanwhile
    history = histories.get(repo) ?? history
    histories.set(repo, history)
  }
  return history
}

async function save(repo: string, history: History): Promise<void> {
  try {
    await writeFile(await historyFile(repo), JSON.stringify(history))
  } catch {
    // Undo still works for this session
  }
}

export async function captureRefs(repo: string): Promise<RefState> {
  const [symbolic, head, list] = await Promise.all([
    tryGit(repo, ['symbolic-ref', '-q', 'HEAD']),
    tryGit(repo, ['rev-parse', '-q', '--verify', 'HEAD']),
    runGit(repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags'])
  ])
  const refs: Record<string, string> = {}
  for (const line of list.split('\n')) {
    const space = line.lastIndexOf(' ')
    if (space > 0) refs[line.slice(0, space)] = line.slice(space + 1)
  }
  return {
    branch: symbolic?.trim().replace(/^refs\/heads\//, '') || null,
    hash: head?.trim() || null,
    refs
  }
}

/** Refs whose value differs between two states, including created and deleted ones. */
function changedRefs(a: RefState, b: RefState): string[] {
  const keys = new Set([...Object.keys(a.refs), ...Object.keys(b.refs)])
  return [...keys].filter((k) => a.refs[k] !== b.refs[k])
}

const pick = (state: RefState, keys: string[]): RefState => ({
  ...state,
  refs: Object.fromEntries(keys.filter((k) => k in state.refs).map((k) => [k, state.refs[k]]))
})

/** Records a completed action, unless it changed nothing. */
export async function record(
  repo: string,
  label: string,
  before: RefState,
  after: RefState,
  move: BranchMove,
  stash?: string
): Promise<void> {
  const changed = changedRefs(before, after)
  const headMoved = before.branch !== after.branch || before.hash !== after.hash
  if (!changed.length && !headMoved) return
  const history = await historyOf(repo)
  // Only the refs the action changed matter to undo it: the others are left alone
  history.undo.push({
    label,
    before: pick(before, changed),
    after: pick(after, changed),
    move,
    ...(stash ? { stash } : {})
  })
  if (history.undo.length > MAX_ENTRIES) history.undo.shift()
  history.redo = []
  await save(repo, history)
}

/** Remembers an action that stopped on conflicts, to record it when it's continued. */
export async function setPending(
  repo: string,
  label: string,
  before: RefState,
  move: BranchMove
): Promise<void> {
  const history = await historyOf(repo)
  history.pending = { label, before, move }
  await save(repo, history)
}

export async function takePending(repo: string): Promise<Pending | undefined> {
  const history = await historyOf(repo)
  const pending = history.pending
  if (pending) {
    history.pending = undefined
    await save(repo, history)
  }
  return pending
}

export async function historyLabels(
  repo: string
): Promise<{ undo: string | null; redo: string | null }> {
  const history = await historyOf(repo)
  return {
    undo: history.undo.at(-1)?.label ?? null,
    redo: history.redo.at(-1)?.label ?? null
  }
}

/** Moves branches, tags and HEAD from `current` to `target`. */
async function restore(
  repo: string,
  current: RefState,
  target: RefState,
  move: BranchMove
): Promise<void> {
  const refs = { ...current.refs }
  const isBranch = (ref: string): boolean => ref.startsWith('refs/heads/')
  const shortName = (ref: string): string => ref.replace(/^refs\/heads\//, '')
  let currentBranch = current.branch

  // A single branch that disappeared while another appeared on the same commit was renamed:
  // rename it back, keeping its configuration (upstream…)
  const removed = Object.keys(refs).filter((r) => isBranch(r) && !(r in target.refs))
  const added = Object.keys(target.refs).filter((r) => isBranch(r) && !(r in refs))
  if (removed.length === 1 && added.length === 1 && refs[removed[0]] === target.refs[added[0]]) {
    await runGit(repo, ['branch', '-m', shortName(removed[0]), shortName(added[0])])
    refs[added[0]] = refs[removed[0]]
    delete refs[removed[0]]
    if (currentBranch === shortName(removed[0])) currentBranch = shortName(added[0])
  }

  const checkedOut = currentBranch ? `refs/heads/${currentBranch}` : null
  // Refs other than the checked out branch can move freely
  for (const [ref, hash] of Object.entries(target.refs)) {
    if (ref !== checkedOut && refs[ref] !== hash) {
      await runGit(repo, ['update-ref', ref, hash])
      refs[ref] = hash
    }
  }

  if (target.branch !== currentBranch || (!target.branch && target.hash !== current.hash)) {
    if (target.branch) await runGit(repo, ['checkout', target.branch, '--'])
    else if (target.hash) await runGit(repo, ['checkout', '--detach', target.hash, '--'])
    // The previously checked out branch is free now
    if (checkedOut && checkedOut in target.refs && refs[checkedOut] !== target.refs[checkedOut]) {
      await runGit(repo, ['update-ref', checkedOut, target.refs[checkedOut]])
    }
  } else if (target.hash && target.hash !== current.hash) {
    await runGit(repo, ['reset', `--${move}`, target.hash])
  }

  for (const ref of Object.keys(refs)) {
    if (!(ref in target.refs)) await runGit(repo, ['update-ref', '-d', ref])
  }
}

/** Reapplies the changes a hard reset saved, dropping the stash when they apply cleanly. */
async function reapplyStash(repo: string, stash: string): Promise<void> {
  try {
    await runGit(repo, ['stash', 'apply', '--index', stash])
  } catch {
    throw new Error(
      'Undone, but the changes saved before the hard reset could not be fully reapplied: resolve the conflicts, or apply the stash later (they are kept in it)'
    )
  }
  const list = (await runGit(repo, ['stash', 'list', '--format=%gd %H'])).split('\n')
  const selector = list.find((line) => line.endsWith(` ${stash}`))?.split(' ')[0]
  if (selector) await runGit(repo, ['stash', 'drop', '-q', selector])
}

async function travel(repo: string, direction: 'undo' | 'redo'): Promise<string> {
  const history = await historyOf(repo)
  const entry = history[direction].at(-1)
  if (!entry) throw new Error(direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo')
  const [from, to] =
    direction === 'undo' ? [entry.after, entry.before] : [entry.before, entry.after]
  const current = await captureRefs(repo)

  // Only the refs the action changed, and HEAD, must be as it left them
  const keys = changedRefs(entry.before, entry.after)
  const untouched =
    current.branch === from.branch &&
    (from.branch !== null || current.hash === from.hash) &&
    keys.every((k) => current.refs[k] === from.refs[k])
  if (!untouched) {
    history.undo = []
    history.redo = []
    await save(repo, history)
    throw new Error(
      `The repository changed outside GitDom after "${entry.label}": it can no longer be ${
        direction === 'undo' ? 'undone' : 'redone'
      }`
    )
  }

  const target: RefState = { branch: to.branch, hash: to.hash, refs: { ...current.refs } }
  for (const k of keys) {
    if (k in to.refs) target.refs[k] = to.refs[k]
    else delete target.refs[k]
  }
  // On a branch, HEAD follows it: commits made since on a branch the action didn't touch stay
  if (to.branch) target.hash = target.refs[`refs/heads/${to.branch}`] ?? to.hash
  await restore(repo, current, target, entry.move)
  history[direction].pop()
  history[direction === 'undo' ? 'redo' : 'undo'].push(entry)
  await save(repo, history)
  if (direction === 'undo' && entry.stash) await reapplyStash(repo, entry.stash)
  return entry.label
}

/** Drops the in-memory copies, as after a restart: for tests. */
export function forgetHistories(): void {
  histories.clear()
}

export const undo = (repo: string): Promise<string> => travel(repo, 'undo')
export const redo = (repo: string): Promise<string> => travel(repo, 'redo')
