// Operations on remotes, submodules, worktrees and Git LFS.
import { resolve } from 'path'
import { runGit } from '../exec'
import { PUSH_PHASES, progressReader, reportProgress } from '../progress'
import {
  type OpImpl,
  assertArg,
  assertBranchName,
  assertRev,
  repoFile,
  assertIdle,
  withConflicts,
  currentBranch,
  pushDestination,
  pushRemoteOf
} from './shared'

export const remoteOps: Pick<
  OpImpl,
  | 'fetch'
  | 'pull'
  | 'push'
  | 'pushRemote'
  | 'addRemote'
  | 'removeRemote'
  | 'renameRemote'
  | 'setRemoteUrl'
  | 'submoduleUpdate'
  | 'submoduleAdd'
  | 'submoduleSync'
  | 'worktreeAdd'
  | 'worktreeRemove'
  | 'worktreePrune'
  | 'worktreeLock'
  | 'lfsTrack'
  | 'lfsUntrack'
  | 'lfsPull'
  | 'lfsPush'
> = {
  async fetch(repo, background) {
    await runGit(repo, ['fetch', '--all', '--prune'], { noPrompt: !!background })
  },

  async pull(repo, mode) {
    await assertIdle(repo)
    const flag = { ff: '--no-rebase', 'ff-only': '--ff-only', rebase: '--rebase' }[mode]
    return withConflicts(repo, ['pull', '--autostash', flag])
  },

  async push(repo, forceWithLease, name, remote) {
    if (name !== undefined) assertArg(name, 'branch name')
    const branch = name ?? (await currentBranch(repo))
    const to = await pushDestination(repo, branch, remote)
    // --progress: git only reports it to a terminal otherwise
    const args = ['push', '--progress']
    if (forceWithLease) args.push('--force-with-lease')
    if (to.setUpstream) args.push('-u')
    // Explicit refspec: works even when the upstream has a different name (push.default=simple would refuse)
    args.push(to.remote, `refs/heads/${branch}:${to.ref}`)
    return runGit(repo, args, {
      withStderr: true,
      onStderr: progressReader(PUSH_PHASES, reportProgress)
    })
  },

  async pushRemote(repo, name) {
    if (name !== undefined) assertArg(name, 'branch name')
    return pushRemoteOf(repo, name ?? (await currentBranch(repo)))
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
  }
}
