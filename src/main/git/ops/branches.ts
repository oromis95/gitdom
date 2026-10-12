// Operations on branches and tags.
import type { BranchInfo, StashMode } from '../../../shared/api'
import { GitError, runGit, tryGit } from '../exec'
import { signingProgramArgs } from '../repository'
import {
  type OpImpl,
  assertArg,
  assertBranchName,
  assertTagName,
  assertRev,
  assertHash
} from './shared'

const AUTO_STASH_MESSAGE = 'GitDom auto-stash before checkout'

/** Unmerged branches checked for a squash merge: one merge-tree each */
const MOST_SQUASH_CHECKS = 200

/**
 * The branch others are compared with: the default branch of origin (or the first remote), then
 * main or master on it, then locally.
 */
async function defaultBase(repo: string): Promise<string | null> {
  const remotes = (await runGit(repo, ['remote'])).split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (remote) {
    const head = await tryGit(repo, [
      'symbolic-ref',
      '-q',
      '--short',
      `refs/remotes/${remote}/HEAD`
    ])
    if (head?.trim()) return head.trim()
  }
  const candidates = remote ? [`refs/remotes/${remote}/main`, `refs/remotes/${remote}/master`] : []
  for (const ref of [...candidates, 'refs/heads/main', 'refs/heads/master']) {
    if ((await tryGit(repo, ['show-ref', '--verify', '-q', ref])) !== null) {
      return ref.replace(/^refs\/(heads|remotes)\//, '')
    }
  }
  return null
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

export const branchesOps: Pick<
  OpImpl,
  | 'checkout'
  | 'checkoutRemote'
  | 'checkoutCommit'
  | 'createBranch'
  | 'renameBranch'
  | 'fastForwardBranch'
  | 'isAncestor'
  | 'mergePreview'
  | 'deleteBranch'
  | 'branchOverview'
  | 'deleteBranches'
  | 'deleteRemoteBranch'
  | 'setUpstream'
  | 'createTag'
  | 'deleteTag'
  | 'pushTag'
  | 'deleteRemoteTag'
> = {
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

  async branchOverview(repo, chosen) {
    if (chosen !== null) assertRev(chosen)
    const base = chosen ?? (await defaultBase(repo))
    const fields = [
      '%(refname:short)',
      '%(objectname)',
      '%(committerdate:unix)',
      '%(authorname)',
      '%(upstream:short)',
      '%(upstream:track)',
      '%(HEAD)',
      '%(worktreepath)',
      base ? `%(ahead-behind:${base})` : '',
      // Last: a summary can hold anything but a newline
      '%(subject)'
    ]
    const list = (format: string[]): Promise<string> =>
      runGit(repo, ['for-each-ref', `--format=${format.join('%00')}`, 'refs/heads'])
    // %(ahead-behind) needs git 2.41: before it, each branch is counted on its own
    const counted = base ? await list(fields).catch(() => null) : null
    const output = counted ?? (await list(fields.map((f, i) => (i === 8 ? '' : f))))
    const baseTree = base ? (await tryGit(repo, ['rev-parse', `${base}^{tree}`]))?.trim() : null
    // The branch the base is, or follows: never offered for deletion
    const baseNames = base ? [base, base.replace(/^[^/]+\//, '')] : []
    const branches = output
      .split('\n')
      .filter(Boolean)
      .map((line): BranchInfo => {
        const [name, hash, date, author, upstream, track, head, worktree, counts, subject] =
          line.split('\0')
        const [ahead, behind]: (number | null)[] = counts
          ? counts.split(' ').map(Number)
          : [null, null]
        const isBase = baseNames.includes(name) || (!!upstream && upstream === base)
        return {
          name,
          hash,
          date: Number(date),
          author,
          subject,
          upstream: upstream || null,
          upstreamGone: track === '[gone]',
          ahead,
          behind,
          merged: !isBase && ahead === 0,
          squashed: false,
          isBase,
          current: head === '*',
          worktree: head !== '*' && worktree ? worktree : null
        }
      })
    if (base && counted === null) {
      await Promise.all(
        branches.map(async (branch) => {
          const counts = await tryGit(repo, [
            'rev-list',
            '--left-right',
            '--count',
            `${branch.hash}...${base}`
          ])
          if (!counts) return
          const [ahead, behind] = counts.trim().split(/\s+/).map(Number)
          Object.assign(branch, { ahead, behind, merged: !branch.isBase && ahead === 0 })
        })
      )
    }
    // Merged with a squash or a rebase: merging it again would leave the base as it is
    if (base && baseTree) {
      const unmerged = branches.filter((b) => !b.isBase && (b.ahead ?? 0) > 0)
      await Promise.all(
        unmerged.slice(0, MOST_SQUASH_CHECKS).map(async (branch) => {
          const tree = await tryGit(repo, ['merge-tree', '--write-tree', base, branch.hash])
          branch.squashed = tree?.split('\n')[0].trim() === baseTree
        })
      )
    }
    return { base, branches }
  },

  async deleteBranches(repo, names) {
    if (!Array.isArray(names) || !names.length) throw new Error('No branches to delete')
    for (const name of names) await assertBranchName(repo, name)
    const refused: string[] = []
    for (const name of names) {
      // git refuses the current branch and the ones other worktrees have checked out
      const deleted = await tryGit(repo, ['branch', '-D', name])
      if (deleted === null) refused.push(name)
    }
    if (refused.length) {
      throw new Error(
        `Not deleted, as checked out here or in another worktree: ${refused.join(', ')}`
      )
    }
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
  }
}
