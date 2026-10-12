// Operations that merge, rebase, move or reset commits, and undo them.
import { mkdir, rm, writeFile } from 'fs/promises'
import { resolve } from 'path'
import type { CommitsToMove, MergeMode, ResetMode } from '../../../shared/api'
import { REFLOG_FORMAT, parseReflog } from '../parsers'
import { runGit, tryGit } from '../exec'
import { signingProgramArgs } from '../repository'
import * as history from '../history'
import * as backups from '../backups'
import {
  type OpImpl,
  assertArg,
  assertBranchName,
  assertHash,
  assertIdle,
  withConflicts,
  currentBranch
} from './shared'
import { branchesOps } from './branches'

const REFLOG_LIMIT = 2000

async function isMerge(repo: string, hash: string): Promise<boolean> {
  const parents = (await runGit(repo, ['rev-list', '--parents', '-n1', hash])).trim().split(' ')
  return parents.length > 2
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

export const mergeOps: Pick<
  OpImpl,
  | 'merge'
  | 'rebase'
  | 'rebaseCommits'
  | 'rebaseInteractive'
  | 'cherryPick'
  | 'commitsToMove'
  | 'moveCommits'
  | 'revert'
  | 'reset'
  | 'reflog'
  | 'backups'
  | 'restoreBackup'
  | 'deleteBackup'
  | 'undo'
  | 'redo'
> = {
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
    if (await branchesOps.isAncestor(repo, from, `refs/heads/${target}`))
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
  redo: (repo) => history.redo(repo)
}
