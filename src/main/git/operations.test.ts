import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runOp } from './operations'
import { loadIdentity, loadSnapshot } from './repository'

// Git on Windows is slow to spawn: remote scenarios run dozens of commands
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

let root: string
let repo: string

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', input: '' }).trim()

function init(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t.it')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'core.autocrlf', 'false')
}

const write = (name: string, content: string): void => writeFileSync(join(repo, name), content)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gitdom-ops-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  init(repo)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

async function commitFile(name: string, content: string, message: string): Promise<void> {
  write(name, content)
  await runOp(repo, 'stage', [[name]])
  await runOp(repo, 'commit', [message, false])
}

describe('staging and commit', () => {
  it('stages, unstages and unstages in an empty repository', async () => {
    write('a.txt', 'a\n')
    await runOp(repo, 'stageAll', [])
    expect((await runOp(repo, 'status', [])).staged).toEqual([{ path: 'a.txt', status: 'A' }])
    // No HEAD yet: unstage must fall back to rm --cached
    await runOp(repo, 'unstage', [['a.txt']])
    expect((await runOp(repo, 'status', [])).unstaged).toEqual([{ path: 'a.txt', status: '?' }])
  })

  it('commits, amends and reads the last message', async () => {
    await commitFile('a.txt', 'a\n', 'first')
    write('b.txt', 'b\n')
    await runOp(repo, 'stage', [['b.txt']])
    await runOp(repo, 'commit', ['first, amended', true])
    expect(await runOp(repo, 'lastCommitMessage', [])).toBe('first, amended')
    expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('1')
  })

  it('handles paths with spaces and glob characters literally', async () => {
    write('my file[1].txt', 'x\n')
    write('my file1.txt', 'y\n')
    await runOp(repo, 'stage', [['my file[1].txt']])
    expect((await runOp(repo, 'status', [])).staged.map((f) => f.path)).toEqual(['my file[1].txt'])
  })

  it('discards tracked changes and deletes untracked files', async () => {
    await commitFile('a.txt', 'a\n', 'init')
    write('a.txt', 'changed\n')
    write('new.txt', 'new\n')
    await runOp(repo, 'discard', [
      [
        { path: 'a.txt', status: 'M' },
        { path: 'new.txt', status: '?' }
      ]
    ])
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('a\n')
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
  })

  it('diffs untracked, unstaged and committed files', async () => {
    write('n.txt', 'hello\n')
    const untracked = await runOp(repo, 'diff', [{ kind: 'untracked' }, 'n.txt'])
    expect(untracked.change).toBe('added')
    expect(untracked.hunks[0].lines).toEqual([{ type: 'add', text: 'hello', newNo: 1 }])

    await commitFile('n.txt', 'hello\n', 'init')
    const hash = git(repo, 'rev-parse', 'HEAD')
    const committed = await runOp(repo, 'diff', [{ kind: 'commit', hash }, 'n.txt'])
    expect(committed.hunks[0].lines[0].text).toBe('hello')

    write('n.txt', 'hello\nworld\n')
    const unstaged = await runOp(repo, 'diff', [{ kind: 'unstaged' }, 'n.txt'])
    expect(unstaged.hunks[0].lines.map((l) => l.type)).toEqual(['context', 'add'])
  })

  it('reports hook failures with their output', async () => {
    write(join('.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "lint failed" >&2\nexit 1\n')
    write('a.txt', 'a\n')
    await runOp(repo, 'stageAll', [])
    await expect(runOp(repo, 'commit', ['msg', false])).rejects.toMatchObject({
      stderr: expect.stringContaining('lint failed')
    })
  })
})

describe('branches', () => {
  beforeEach(() => commitFile('a.txt', 'a\n', 'init'))

  it('creates, renames and deletes branches', async () => {
    await runOp(repo, 'createBranch', ['feature/x', null, false])
    await runOp(repo, 'renameBranch', ['feature/x', 'feature/y'])
    expect(git(repo, 'branch', '--list', 'feature/*')).toBe('feature/y')
    await runOp(repo, 'deleteBranch', ['feature/y', false])
    expect(git(repo, 'branch', '--list', 'feature/*')).toBe('')
  })

  it('rejects names that look like options', async () => {
    await expect(runOp(repo, 'createBranch', ['--force', null, false])).rejects.toThrow('Invalid')
    await expect(runOp(repo, 'createBranch', ['bad..name', null, false])).rejects.toThrow('Invalid')
  })

  it('auto-stashes changes that a checkout would overwrite', async () => {
    await runOp(repo, 'createBranch', ['other', null, true])
    await commitFile('a.txt', 'other\n', 'on other')
    await runOp(repo, 'checkout', ['main', 'none'])
    write('a.txt', 'local change\n')

    await expect(runOp(repo, 'checkout', ['other', 'none'])).rejects.toThrow(/overwritten/)
    // The change conflicts with "other": checkout succeeds, the changes stay stashed
    await expect(runOp(repo, 'checkout', ['other', 'tracked'])).rejects.toThrow(/kept in it/)
    expect(git(repo, 'branch', '--show-current')).toBe('other')
    expect(git(repo, 'stash', 'list')).toContain('GitDom auto-stash')
  })

  it('carries non-conflicting changes across a checkout', async () => {
    await commitFile('b.txt', 'b\n', 'second')
    await runOp(repo, 'createBranch', ['other', null, false])
    write('a.txt', 'local change\n')
    await runOp(repo, 'checkout', ['other', 'tracked'])
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('local change\n')
    expect(git(repo, 'stash', 'list')).toBe('')
  })

  it('stashes untracked files that a checkout would overwrite', async () => {
    await runOp(repo, 'createBranch', ['other', null, true])
    await commitFile('u.txt', 'committed on other\n', 'add u')
    await runOp(repo, 'checkout', ['main', 'none'])
    write('u.txt', 'untracked here\n')
    write('n.txt', 'unrelated\n')

    await expect(runOp(repo, 'checkout', ['other', 'tracked'])).rejects.toThrow(/untracked/)
    // The untracked copy can't come back over the committed one: it stays in the stash
    await expect(runOp(repo, 'checkout', ['other', 'all'])).rejects.toThrow(/kept in it/)
    expect(git(repo, 'branch', '--show-current')).toBe('other')
    expect(readFileSync(join(repo, 'u.txt'), 'utf8')).toBe('committed on other\n')
    expect(git(repo, 'show', 'stash@{0}^3:u.txt')).toBe('untracked here')
  })

  it('carries untracked files across a checkout', async () => {
    await runOp(repo, 'createBranch', ['other', null, false])
    write('n.txt', 'untracked\n')
    await runOp(repo, 'checkout', ['other', 'all'])
    expect(readFileSync(join(repo, 'n.txt'), 'utf8')).toBe('untracked\n')
    expect(git(repo, 'stash', 'list')).toBe('')
  })
})

describe('operations in progress', () => {
  beforeEach(async () => {
    await commitFile('a.txt', 'base\n', 'init')
    await runOp(repo, 'createBranch', ['other', null, true])
    await commitFile('a.txt', 'other\n', 'on other')
    await runOp(repo, 'checkout', ['main', 'none'])
    await commitFile('a.txt', 'main\n', 'on main')
    expect(() => git(repo, 'merge', 'other')).toThrow()
  })

  it('continues a merge only once conflicts are resolved', async () => {
    await expect(runOp(repo, 'continueOperation', [])).rejects.toThrow(/still have conflicts/)
    write('a.txt', 'resolved\n')
    await runOp(repo, 'stage', [['a.txt']])
    await runOp(repo, 'continueOperation', [])
    expect(git(repo, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2)
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  })

  it('diffs a conflicted file against HEAD and resolves it with one side', async () => {
    const diff = await runOp(repo, 'diff', [{ kind: 'unstaged' }, 'a.txt'])
    expect(diff.conflicted).toBe(true)
    expect(diff.hunks[0].lines.some((l) => l.text.startsWith('<<<<<<<'))).toBe(true)
    expect(await runOp(repo, 'conflictMarkers', [['a.txt']])).toEqual(['a.txt'])

    await runOp(repo, 'resolveConflict', [['a.txt'], 'theirs'])
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('other\n')
    expect(await runOp(repo, 'conflictMarkers', [['a.txt']])).toEqual([])
    expect(git(repo, 'status', '--porcelain')).toBe('M  a.txt')
    await expect(runOp(repo, 'conflictMarkers', [['../x']])).rejects.toThrow(/outside/)
  })

  it('aborts a merge', async () => {
    await runOp(repo, 'abortOperation', [])
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('main\n')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    await expect(runOp(repo, 'abortOperation', [])).rejects.toThrow(/No merge/)
  })

  it('continues a rebase', async () => {
    await runOp(repo, 'abortOperation', [])
    await runOp(repo, 'checkout', ['other', 'none'])
    expect(() => git(repo, 'rebase', 'main')).toThrow()
    write('a.txt', 'resolved\n')
    await runOp(repo, 'stage', [['a.txt']])
    await runOp(repo, 'continueOperation', [])
    expect(git(repo, 'log', '--format=%s', '-3')).toBe('on other\non main\ninit')
    expect(git(repo, 'branch', '--show-current')).toBe('other')
  })
})

describe('remotes', () => {
  let remote: string
  let clone: string

  beforeEach(async () => {
    await commitFile('a.txt', 'a\n', 'init')
    remote = join(root, 'remote.git')
    clone = join(root, 'clone')
    git(root, 'init', '-q', '--bare', '-b', 'main', remote)
    await runOp(repo, 'addRemote', ['origin', remote])
  })

  it('sets the upstream on first push, then pulls and fetches', async () => {
    await runOp(repo, 'push', [false])
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'main@{u}')).toBe('origin/main')

    git(root, 'clone', '-q', remote, clone)
    init(clone)
    writeFileSync(join(clone, 'c.txt'), 'c\n')
    git(clone, 'add', 'c.txt')
    git(clone, 'commit', '-qm', 'from clone')
    git(clone, 'push', '-q')

    // Local changes are stashed around the pull
    write('a.txt', 'local change\n')
    expect(await runOp(repo, 'pull', ['ff-only'])).toMatchObject({ conflicts: false })
    expect(existsSync(join(repo, 'c.txt'))).toBe(true)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('local change\n')
    expect(git(repo, 'stash', 'list')).toBe('')
    await runOp(repo, 'discard', [[{ path: 'a.txt', status: 'M' }]])

    await runOp(repo, 'createTag', ['v0', 'HEAD', null])
    await runOp(repo, 'pushTag', ['origin', 'v0'])
    expect(git(remote, 'tag')).toBe('v0')
    await runOp(repo, 'deleteRemoteTag', ['origin', 'v0'])
    expect(git(remote, 'tag')).toBe('')

    git(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/fetched')
    await runOp(repo, 'fetch', [])
    expect(git(repo, 'branch', '-r')).toContain('origin/fetched')
  })

  it('rejects a diverged push unless forced with lease', async () => {
    await runOp(repo, 'push', [false])
    git(root, 'clone', '-q', remote, clone)
    init(clone)
    writeFileSync(join(clone, 'c.txt'), 'c\n')
    git(clone, 'add', '.')
    git(clone, 'commit', '-qm', 'remote work')
    git(clone, 'push', '-q')

    await commitFile('b.txt', 'b\n', 'local work')
    await runOp(repo, 'fetch', [])
    await expect(runOp(repo, 'push', [false])).rejects.toMatchObject({
      stderr: expect.stringMatching(/rejected/)
    })
    await runOp(repo, 'push', [true])
    expect(git(remote, 'log', '-1', '--format=%s', 'main')).toBe('local work')
  })

  it('checks out a remote branch as a tracking branch and deletes it remotely', async () => {
    await runOp(repo, 'createBranch', ['feat', null, true])
    await runOp(repo, 'push', [false])
    await runOp(repo, 'checkout', ['main', 'none'])
    await runOp(repo, 'deleteBranch', ['feat', true])

    await runOp(repo, 'checkoutRemote', ['origin/feat', 'feat', 'none'])
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'feat@{u}')).toBe('origin/feat')

    await runOp(repo, 'checkout', ['main', 'none'])
    await runOp(repo, 'deleteRemoteBranch', ['origin', 'feat'])
    expect(git(remote, 'branch', '--list', 'feat')).toBe('')
  })
})

describe('stash and tags', () => {
  beforeEach(() => commitFile('a.txt', 'a\n', 'init'))

  it('pushes, applies, pops and drops stashes', async () => {
    write('a.txt', 'wip\n')
    write('u.txt', 'untracked\n')
    await runOp(repo, 'stashPush', ['my work', true])
    expect(existsSync(join(repo, 'u.txt'))).toBe(false)
    expect(git(repo, 'stash', 'list')).toContain('my work')

    await runOp(repo, 'stashApply', ['stash@{0}'])
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('wip\n')
    await runOp(repo, 'stashDrop', ['stash@{0}'])
    expect(git(repo, 'stash', 'list')).toBe('')
    await expect(runOp(repo, 'stashPop', ['stash@{0}; rm'])).rejects.toThrow('Invalid stash')
  })

  it('creates lightweight and annotated tags and deletes them', async () => {
    await runOp(repo, 'createTag', ['v1', 'HEAD', null])
    await runOp(repo, 'createTag', ['v2', 'HEAD', 'Release 2'])
    expect(git(repo, 'cat-file', '-t', 'v1')).toBe('commit')
    expect(git(repo, 'cat-file', '-t', 'v2')).toBe('tag')
    await runOp(repo, 'deleteTag', ['v1'])
    expect(git(repo, 'tag')).toBe('v2')
  })
})

const subjects = (range = 'HEAD'): string => git(repo, 'log', '--format=%s', range)

describe('merge, rebase and commit operations', () => {
  // main: init - m1, feature (from init): f1 - f2
  beforeEach(async () => {
    await commitFile('a.txt', 'a\n', 'init')
    await runOp(repo, 'createBranch', ['feature', null, true])
    await commitFile('f.txt', '1\n', 'f1')
    await commitFile('f.txt', '2\n', 'f2')
    await runOp(repo, 'checkout', ['main', 'none'])
    await commitFile('m.txt', 'm\n', 'm1')
  })

  it('fast-forwards a branch that is not checked out, refusing diverged ones', async () => {
    const init = git(repo, 'rev-parse', 'main~1')
    await runOp(repo, 'createBranch', ['behind', init, false])
    expect(await runOp(repo, 'isAncestor', ['behind', 'main'])).toBe(true)
    expect(await runOp(repo, 'isAncestor', ['feature', 'main'])).toBe(false)
    await runOp(repo, 'fastForwardBranch', ['behind', 'main'])
    expect(git(repo, 'rev-parse', 'behind')).toBe(git(repo, 'rev-parse', 'main'))
    await runOp(repo, 'undo', [])
    expect(git(repo, 'rev-parse', 'behind')).toBe(init)
    await expect(runOp(repo, 'fastForwardBranch', ['feature', 'main'])).rejects.toThrow(
      /cannot be fast-forwarded/
    )
  })

  it('merges with a merge commit, fast-forward only and squash', async () => {
    await expect(runOp(repo, 'merge', ['feature', 'ff-only'])).rejects.toThrow()
    expect(await runOp(repo, 'merge', ['feature', 'no-ff'])).toMatchObject({ conflicts: false })
    expect(git(repo, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2)

    git(repo, 'reset', '-q', '--hard', 'HEAD~1')
    await runOp(repo, 'merge', ['feature', 'squash'])
    expect(git(repo, 'status', '--porcelain')).toBe('A  f.txt')
    expect(subjects()).toBe('m1\ninit')
  })

  it('reports merge conflicts as an outcome', async () => {
    await commitFile('f.txt', 'main side\n', 'm2')
    const outcome = await runOp(repo, 'merge', ['feature', 'ff'])
    expect(outcome.conflicts).toBe(true)
    await expect(runOp(repo, 'rebase', ['feature'])).rejects.toThrow(/merge is in progress/)
    await expect(runOp(repo, 'skipOperation', [])).rejects.toThrow()
  })

  it('rebases, auto-stashing local changes', async () => {
    await runOp(repo, 'checkout', ['feature', 'none'])
    write('a.txt', 'dirty\n')
    await runOp(repo, 'rebase', ['main'])
    expect(subjects()).toBe('f2\nf1\nm1\ninit')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('dirty\n')
  })

  it('skips the commit that stopped a rebase', async () => {
    await runOp(repo, 'checkout', ['feature', 'none'])
    await commitFile('m.txt', 'feature side\n', 'f3')
    expect((await runOp(repo, 'rebase', ['main'])).conflicts).toBe(true)
    expect((await runOp(repo, 'skipOperation', [])).conflicts).toBe(false)
    expect(subjects()).toBe('f2\nf1\nm1\ninit')
  })

  it('rewrites history with an interactive rebase', async () => {
    await runOp(repo, 'checkout', ['feature', 'none'])
    await commitFile('g.txt', 'g\n', 'f3')
    await commitFile('h.txt', 'h\n', 'f4')
    const base = git(repo, 'rev-parse', 'main~1')
    const { commits, merges } = await runOp(repo, 'rebaseCommits', [base])
    expect(merges).toBe(0)
    expect(commits.map((c) => c.subject)).toEqual(['f1', 'f2', 'f3', 'f4'])
    const [f1, f2, f3, f4] = commits.map((c) => c.hash)

    await runOp(repo, 'rebaseInteractive', [
      base,
      [
        { action: 'reword', hash: f1, message: 'first\n\nwith body' },
        { action: 'pick', hash: f4 },
        { action: 'fixup', hash: f2 },
        { action: 'drop', hash: f3 }
      ]
    ])
    expect(subjects()).toBe('f4\nfirst\ninit')
    expect(git(repo, 'log', '-1', '--format=%B', 'HEAD~1')).toBe('first\n\nwith body')
    expect(git(repo, 'show', 'HEAD:f.txt')).toBe('2')
    expect(existsSync(join(repo, 'g.txt'))).toBe(false)

    await expect(
      runOp(repo, 'rebaseInteractive', [base, [{ action: 'squash', hash: f1 }]])
    ).rejects.toThrow()
  })

  it('cherry-picks several commits, reverts and resets', async () => {
    const [f2, f1] = git(repo, 'rev-list', 'feature', '-2').split('\n')
    await runOp(repo, 'cherryPick', [[f1, f2]])
    expect(subjects()).toBe('f2\nf1\nm1\ninit')

    await runOp(repo, 'revert', [git(repo, 'rev-parse', 'HEAD')])
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('Revert "f2"')
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('1\n')

    await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD~3'), 'soft'])
    expect(git(repo, 'status', '--porcelain')).toBe('A  f.txt')
    await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD'), 'mixed'])
    expect(git(repo, 'status', '--porcelain')).toBe('?? f.txt')
    await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD~1'), 'hard'])
    expect(subjects()).toBe('init')
  })
})

describe('undo and redo', () => {
  beforeEach(() => commitFile('a.txt', 'a\n', 'init'))

  const labels = async (): Promise<unknown> => {
    const { historyLabels } = await import('./history')
    return historyLabels(repo)
  }

  it('undoes and redoes a commit, keeping its changes', async () => {
    await commitFile('a.txt', 'b\n', 'second')
    expect(await labels()).toEqual({ undo: 'Commit', redo: null })
    expect(await runOp(repo, 'undo', [])).toBe('Commit')
    expect(subjects()).toBe('init')
    expect(git(repo, 'status', '--porcelain')).toBe('M  a.txt')
    expect(await labels()).toEqual({ undo: 'Commit', redo: 'Commit' })
    await runOp(repo, 'redo', [])
    expect(subjects()).toBe('second\ninit')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('undoes branch creation, checkout, rename and deletion', async () => {
    await runOp(repo, 'createBranch', ['x', null, true])
    await runOp(repo, 'renameBranch', ['x', 'y'])
    await runOp(repo, 'checkout', ['main', 'none'])
    await runOp(repo, 'deleteBranch', ['y', false])

    await runOp(repo, 'undo', [])
    expect(git(repo, 'branch', '--list', 'y')).toContain('y')
    await runOp(repo, 'undo', [])
    expect(git(repo, 'branch', '--show-current')).toBe('y')
    await runOp(repo, 'undo', [])
    expect(git(repo, 'branch', '--show-current')).toBe('x')
    await runOp(repo, 'undo', [])
    expect(git(repo, 'branch', '--show-current')).toBe('main')
    expect(git(repo, 'branch', '--list', 'x')).toBe('')
    expect(await labels()).toEqual({ undo: 'Commit', redo: 'Create branch x' })

    await runOp(repo, 'redo', [])
    await runOp(repo, 'redo', [])
    expect(git(repo, 'branch', '--show-current')).toBe('y')
  })

  it('undoes a hard reset and a merge completed after conflicts', async () => {
    await commitFile('a.txt', 'b\n', 'second')
    const second = git(repo, 'rev-parse', 'HEAD')
    await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD~1'), 'hard'])
    await runOp(repo, 'undo', [])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(second)
    expect(git(repo, 'status', '--porcelain')).toBe('')

    await runOp(repo, 'createBranch', ['other', 'HEAD~1', true])
    await commitFile('a.txt', 'other\n', 'on other')
    await runOp(repo, 'checkout', ['main', 'none'])
    expect((await runOp(repo, 'merge', ['other', 'ff'])).conflicts).toBe(true)
    write('a.txt', 'resolved\n')
    await runOp(repo, 'stage', [['a.txt']])
    await runOp(repo, 'continueOperation', [])
    expect(await labels()).toMatchObject({ undo: 'Merge other' })
    await runOp(repo, 'undo', [])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(second)
  })

  it('realigns the index when undoing and redoing a mixed reset', async () => {
    await commitFile('f.txt', 'f\n', 'second')
    await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD~1'), 'mixed'])
    expect(git(repo, 'status', '--porcelain')).toBe('?? f.txt')
    await runOp(repo, 'undo', [])
    expect(git(repo, 'status', '--porcelain')).toBe('')
    await runOp(repo, 'redo', [])
    expect(git(repo, 'status', '--porcelain')).toBe('?? f.txt')
  })

  it('keeps the uncommitted changes of a hard reset in a stash, restored by undo', async () => {
    await commitFile('a.txt', 'b\n', 'second')
    write('a.txt', 'uncommitted\n')
    const stash = await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD~1'), 'hard'])
    expect(stash).toMatch(/^[0-9a-f]{40}$/)
    expect(git(repo, 'stash', 'list')).toContain('before hard reset')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('a\n')

    await runOp(repo, 'undo', [])
    expect(subjects()).toBe('second\ninit')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('uncommitted\n')
    expect(git(repo, 'stash', 'list')).toBe('')
  })

  it('survives a restart and ignores changes to unrelated branches', async () => {
    await runOp(repo, 'createBranch', ['x', null, false])
    const { forgetHistories } = await import('./history')
    forgetHistories()
    // Commits made outside GitDom on the current branch don't concern "Create branch x"
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'outside')
    expect(await labels()).toEqual({ undo: 'Create branch x', redo: null })
    await runOp(repo, 'undo', [])
    expect(git(repo, 'branch', '--list', 'x')).toBe('')
    expect(subjects()).toBe('outside\ninit')
  })

  it('refuses to undo after changes made outside GitDom', async () => {
    await commitFile('a.txt', 'b\n', 'second')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'outside')
    await expect(runOp(repo, 'undo', [])).rejects.toThrow(/changed outside GitDom/)
    expect(await labels()).toEqual({ undo: null, redo: null })
  })
})

describe('runOp', () => {
  it('refuses unknown or inherited operation names', async () => {
    await expect(runOp(repo, 'toString' as 'status', [])).rejects.toThrow('Unknown operation')
  })
})

describe('file inspection', () => {
  it('follows a file across a rename and blames it at a commit and in the working tree', async () => {
    await commitFile('old name.txt', 'one\ntwo\nthree\nfour\n', 'create')
    git(repo, 'mv', 'old name.txt', 'new name.txt')
    await runOp(repo, 'commit', ['rename', false])
    await commitFile('new name.txt', 'one\nTWO\nthree\nfour\n', 'edit')
    const history = await runOp(repo, 'fileHistory', ['new name.txt'])
    expect(history.map((r) => [r.subject, r.path, r.status])).toEqual([
      ['edit', 'new name.txt', 'M'],
      ['rename', 'new name.txt', 'R'],
      ['create', 'old name.txt', 'A']
    ])

    write('new name.txt', 'one\nTWO\nthree\nfour\nfive\n')
    const blame = await runOp(repo, 'blame', ['new name.txt', null])
    const subjects = blame.lines.map((l) => blame.commits[l.hash])
    expect(subjects.map((c) => (c.uncommitted ? '*' : c.summary))).toEqual([
      'create',
      'edit',
      'create',
      'create',
      '*'
    ])
    const atCreate = await runOp(repo, 'blame', ['old name.txt', history[2].hash])
    expect(atCreate.lines.map((l) => l.text)).toEqual(['one', 'two', 'three', 'four'])
  })
})

describe('submodules, LFS and identity', () => {
  it('lists submodules and initializes them', async () => {
    // Local clones of submodules are blocked by default since git 2.38
    vi.stubEnv('GIT_CONFIG_PARAMETERS', "'protocol.file.allow=always'")
    const lib = join(root, 'lib')
    mkdirSync(lib)
    init(lib)
    writeFileSync(join(lib, 'lib.txt'), 'lib\n')
    git(lib, 'add', '.')
    git(lib, 'commit', '-q', '-m', 'lib')
    await commitFile('a.txt', 'a\n', 'first')
    git(repo, 'submodule', 'add', '-q', lib, 'libs/my lib')
    git(repo, 'commit', '-q', '-m', 'add submodule')

    const clone = join(root, 'clone')
    git(root, 'clone', '-q', repo, clone)
    const before = await loadSnapshot(clone)
    expect(before.submodules).toEqual([
      {
        name: 'libs/my lib',
        path: 'libs/my lib',
        url: lib,
        hash: git(lib, 'rev-parse', 'HEAD'),
        state: 'uninitialized'
      }
    ])
    await runOp(clone, 'submoduleUpdate', [[]])
    expect(existsSync(join(clone, 'libs', 'my lib', 'lib.txt'))).toBe(true)
    expect((await loadSnapshot(clone)).submodules[0].state).toBe('clean')
    vi.unstubAllEnvs()
  })

  it('tracks and untracks LFS patterns', async () => {
    const snapshot = await loadSnapshot(repo)
    if (!snapshot.lfs.installed) return
    expect(snapshot.lfs.patterns).toEqual([])
    await runOp(repo, 'lfsTrack', ['*.psd'])
    await runOp(repo, 'lfsTrack', ['assets/*.bin'])
    expect((await loadSnapshot(repo)).lfs.patterns).toEqual(['*.psd', 'assets/*.bin'])
    await runOp(repo, 'lfsUntrack', ['*.psd'])
    expect((await loadSnapshot(repo)).lfs.patterns).toEqual(['assets/*.bin'])
  })

  it('sets and clears the repository identity', async () => {
    expect(await loadIdentity(repo)).toEqual({ name: 'T', email: 't@t.it', scope: 'local' })
    await runOp(repo, 'setIdentity', [' Ann Rossi ', 'ann@x.it', 'local'])
    expect(await loadIdentity(repo)).toEqual({
      name: 'Ann Rossi',
      email: 'ann@x.it',
      scope: 'local'
    })
    await expect(runOp(repo, 'setIdentity', ['', 'ann@x.it', 'local'])).rejects.toThrow()
    await runOp(repo, 'clearLocalIdentity', [])
    await runOp(repo, 'clearLocalIdentity', [])
    expect((await loadIdentity(repo)).scope).not.toBe('local')
  })
})
