import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setToolSettings } from '../settings'
import { runOp, setTrash } from './operations'
import { ensureCommitGraph, loadCommits, loadIdentity, loadSnapshot } from './repository'

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

describe('big histories (GRAPH-08, NFR-03)', () => {
  it('loads the commits page by page', async () => {
    for (let i = 1; i <= 5; i++) git(repo, 'commit', '-q', '--allow-empty', '-m', `c${i}`)
    const subjects = (page: { commits: { subject: string }[] }): string[] =>
      page.commits.map((c) => c.subject)
    const first = await loadCommits(repo, undefined, 0, 2)
    expect([subjects(first), first.more]).toEqual([['c5', 'c4'], true])
    const last = await loadCommits(repo, undefined, 4, 2)
    expect([subjects(last), last.more]).toEqual([['c1'], false])
    const exact = await loadCommits(repo, undefined, 3, 2)
    expect([subjects(exact), exact.more]).toEqual([['c2', 'c1'], false])
    // An empty repository has no refs to walk: an empty page, not an error
    const empty = join(root, 'empty')
    mkdirSync(empty)
    init(empty)
    expect(await loadCommits(empty, undefined, 0, 2)).toEqual({ commits: [], more: false })
  })

  it('writes the commit-graph file once when it is missing', async () => {
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'one')
    const file = join(repo, '.git', 'objects', 'info', 'commit-graph')
    expect(existsSync(file)).toBe(false)
    await ensureCommitGraph(repo)
    expect(existsSync(file)).toBe(true)
  })

  it('reads HEAD, stashes and worktrees without asking git when it can', async () => {
    // Unborn branch: no commit yet
    expect((await loadSnapshot(repo)).head).toEqual({ branch: 'main', hash: null })
    await commitFile('a.txt', 'a\n', 'first')
    const first = git(repo, 'rev-parse', 'HEAD')
    let snapshot = await loadSnapshot(repo)
    expect(snapshot.head).toEqual({ branch: 'main', hash: first })
    expect(snapshot.stashes).toEqual([])
    expect(snapshot.worktrees).toEqual([
      {
        path: repo.replace(/\\/g, '/'),
        head: first,
        branch: 'main',
        main: true,
        bare: false,
        locked: null,
        prunable: null
      }
    ])

    git(repo, 'checkout', '-q', '--detach')
    write('a.txt', 'changed\n')
    git(repo, 'stash', '-q')
    const linked = join(root, 'linked')
    git(repo, 'worktree', 'add', '-q', '-b', 'side', linked)
    snapshot = await loadSnapshot(repo)
    expect(snapshot.head).toEqual({ branch: null, hash: first })
    expect(snapshot.stashes).toHaveLength(1)
    expect(snapshot.worktrees.map((w) => w.branch)).toEqual([null, 'side'])
  })
})

describe('staging and commit', () => {
  it('stages, unstages and unstages in an empty repository', async () => {
    write('a.txt', 'a\n')
    await runOp(repo, 'stageAll', [])
    expect((await runOp(repo, 'status', [])).staged).toEqual([{ path: 'a.txt', status: 'A' }])
    // No HEAD yet: unstage must fall back to rm --cached
    await runOp(repo, 'unstage', [['a.txt']])
    expect((await runOp(repo, 'status', [])).unstaged).toEqual([{ path: 'a.txt', status: '?' }])
  })

  it('checks the staged changes for secrets, debug code and big files', async () => {
    const all = { secrets: true, debugCode: true, largeFiles: true }
    await commitFile('app.js', 'start()\n', 'init')
    expect(await runOp(repo, 'commitChecks', [all])).toEqual([])
    write('app.js', "start()\nconsole.log('x')\n")
    write('unstaged.js', 'debugger\n')
    write('.gitattributes', '*.bin filter=lfs diff=lfs merge=lfs -text\n')
    writeFileSync(join(repo, 'photo.raw'), Buffer.alloc(600 * 1024))
    writeFileSync(join(repo, 'big.bin'), Buffer.alloc(600 * 1024))
    write('.env', 'KEY=1\n')
    git(repo, 'add', 'app.js', '.gitattributes', 'photo.raw', 'big.bin', '.env')
    expect(await runOp(repo, 'commitChecks', [all])).toEqual([
      { kind: 'secrets', text: 'Looks like an environment file', path: '.env' },
      { kind: 'debugCode', text: 'Adds console.log', path: 'app.js', line: 2 },
      { kind: 'largeFiles', text: 'Binary file of 600 KB: consider Git LFS', path: 'photo.raw' }
    ])
    expect(
      await runOp(repo, 'commitChecks', [{ secrets: false, debugCode: false, largeFiles: true }])
    ).toHaveLength(1)
  })

  it('tells which rule ignores a file, and lists the ignored files', async () => {
    write('.gitignore', '# build output\n*.log\n!keep.log\nbuild/\n')
    write('tracked.log', 'kept in the repository\n')
    git(repo, 'add', '-f', '.gitignore', 'tracked.log')
    git(repo, 'commit', '-q', '-m', 'init')
    mkdirSync(join(repo, 'build'))
    write('build/out.js', 'x\n')
    write('debug.log', 'x\n')
    write('keep.log', 'x\n')
    mkdirSync(join(repo, '.git', 'info'), { recursive: true })
    write('.git/info/exclude', 'notes.txt\n')
    write('notes.txt', 'x\n')

    expect(await runOp(repo, 'ignoreRule', ['debug.log'])).toEqual({
      rule: { path: 'debug.log', source: '.gitignore', line: 2, pattern: '*.log' },
      tracked: false
    })
    expect((await runOp(repo, 'ignoreRule', ['keep.log'])).rule?.pattern).toBe('!keep.log')
    expect(await runOp(repo, 'ignoreRule', ['tracked.log'])).toMatchObject({
      rule: { pattern: '*.log' },
      tracked: true
    })
    expect(await runOp(repo, 'ignoreRule', ['src/app.ts'])).toEqual({ rule: null, tracked: false })
    expect((await runOp(repo, 'ignoreRule', ['notes.txt'])).rule?.source).toBe('.git/info/exclude')

    const { rules, total } = await runOp(repo, 'ignoredFiles', [])
    expect(total).toBe(3)
    expect(rules.map((r) => [r.path, r.pattern])).toEqual([
      ['build/', 'build/'],
      ['debug.log', '*.log'],
      ['notes.txt', 'notes.txt']
    ])
  })

  it('previews and cleans untracked and ignored files, to the Recycle Bin or for good', async () => {
    await commitFile('.gitignore', '*.log\nnode_modules/\n', 'init')
    write('new.txt', 'abc')
    mkdirSync(join(repo, 'drafts'))
    write('drafts/a.txt', '12345')
    write('drafts/b.txt', '12345')
    mkdirSync(join(repo, 'mixed'))
    write('mixed/note.txt', 'x')
    write('mixed/run.log', 'x')
    write('debug.log', 'x')
    mkdirSync(join(repo, 'node_modules/x'), { recursive: true })
    write('node_modules/x/index.js', 'x')
    mkdirSync(join(repo, 'lib'))
    init(join(repo, 'lib'))

    const paths = async (scope: 'untracked' | 'ignored' | 'all'): Promise<string[]> =>
      (await runOp(repo, 'cleanPreview', [scope])).entries.map((e) => e.path).sort()
    // A folder holding ignored files lists its untracked files one by one, leaving those
    expect(await paths('untracked')).toEqual(['drafts/', 'mixed/note.txt', 'new.txt'])
    expect(await paths('ignored')).toEqual(['debug.log', 'mixed/run.log', 'node_modules/'])
    expect(await paths('all')).toEqual([
      'debug.log',
      'drafts/',
      'mixed/',
      'new.txt',
      'node_modules/'
    ])
    const preview = await runOp(repo, 'cleanPreview', ['untracked'])
    expect(preview.nested).toEqual(['lib/'])
    expect(preview.entries[0]).toEqual({
      path: 'drafts/',
      ignored: false,
      size: 10,
      files: 2,
      partial: false
    })

    for (const path of ['.gitignore', '.', 'lib/', '../x']) {
      await expect(runOp(repo, 'cleanFiles', [[path], false])).rejects.toThrow()
    }
    await runOp(repo, 'cleanFiles', [['drafts/', 'mixed/note.txt'], false])
    expect(existsSync(join(repo, 'drafts'))).toBe(false)
    expect(existsSync(join(repo, 'mixed/note.txt'))).toBe(false)
    expect(existsSync(join(repo, 'mixed/run.log'))).toBe(true)

    const trashed: string[] = []
    setTrash(async (path) => {
      trashed.push(path)
      rmSync(path, { recursive: true })
    })
    await runOp(repo, 'cleanFiles', [['node_modules/', 'debug.log'], true])
    expect(trashed).toEqual([join(repo, 'node_modules'), join(repo, 'debug.log')])
    expect(await paths('all')).toEqual(['mixed/', 'new.txt'])
    expect(existsSync(join(repo, 'lib/.git'))).toBe(true)
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

  it('applies diff options and compares any two revisions', async () => {
    await commitFile('n.txt', 'a\nb\nc\nd\ne\nf\ng\nh\n', 'one')
    git(repo, 'tag', 'v1')
    await commitFile('n.txt', 'a\nb\nc\nd  \ne\nf\ng\nX\n', 'two')
    await commitFile('m.txt', 'm\n', 'three')

    const compare = { kind: 'compare' as const, from: 'v1', to: 'main' }
    expect(await runOp(repo, 'compareFiles', ['v1', 'main'])).toEqual([
      { status: 'A', path: 'm.txt' },
      { status: 'M', path: 'n.txt' }
    ])
    const full = await runOp(repo, 'diff', [compare, 'n.txt'])
    expect(full.hunks[0].lines.filter((l) => l.type === 'add').map((l) => l.text)).toEqual([
      'd  ',
      'X'
    ])
    const noSpace = await runOp(repo, 'diff', [
      compare,
      'n.txt',
      undefined,
      { ignoreWhitespace: true }
    ])
    expect(noSpace.hunks[0].lines.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['X'])
    const whole = await runOp(repo, 'diff', [compare, 'n.txt', undefined, { context: 100000 }])
    expect(whole.hunks).toHaveLength(1)
    expect(whole.hunks[0].lines[0]).toMatchObject({ type: 'context', text: 'a' })
    const tight = await runOp(repo, 'diff', [compare, 'n.txt', undefined, { context: 0 }])
    expect(tight.hunks).toHaveLength(2)

    await expect(runOp(repo, 'compareFiles', ['--output=x', 'main'])).rejects.toThrow()
    await expect(runOp(repo, 'compareFiles', ['v1', 'a b'])).rejects.toThrow()
  })

  it('loads both versions of an image', async () => {
    const png = (byte: number): Buffer =>
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, byte])
    writeFileSync(join(repo, 'i.png'), png(1))
    await runOp(repo, 'stage', [['i.png']])
    await runOp(repo, 'commit', ['image', false])
    const hash = git(repo, 'rev-parse', 'HEAD')
    const added = await runOp(repo, 'imagePair', [{ kind: 'commit', hash }, 'i.png'])
    expect(added.before).toBeNull()
    expect(added.after).toBe(`data:image/png;base64,${png(1).toString('base64')}`)

    writeFileSync(join(repo, 'i.png'), png(2))
    const changed = await runOp(repo, 'imagePair', [{ kind: 'unstaged' }, 'i.png'])
    expect(changed.before).toBe(added.after)
    expect(changed.after).toBe(`data:image/png;base64,${png(2).toString('base64')}`)
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

  it('gives an overview of the branches against main, and deletes many at once', async () => {
    git(repo, 'branch', 'merged')
    git(repo, 'checkout', '-q', '-b', 'feature')
    await commitFile('f.txt', '1\n', 'feature one')
    await commitFile('f.txt', '2\n', 'feature two')
    git(repo, 'checkout', '-q', '-b', 'squashed', 'main')
    await commitFile('s.txt', 's\n', 'squash me')
    git(repo, 'checkout', '-q', '-b', 'gone', 'main')
    git(repo, 'remote', 'add', 'origin', join(repo, 'missing'))
    git(repo, 'config', 'branch.gone.remote', 'origin')
    git(repo, 'config', 'branch.gone.merge', 'refs/heads/gone')
    git(repo, 'checkout', '-q', 'main')
    // The squashed branch lands on main as a different commit with the same change
    await commitFile('s.txt', 's\n', 'squash me (#1)')

    const { base, branches } = await runOp(repo, 'branchOverview', [null])
    expect(base).toBe('main')
    const byName = Object.fromEntries(branches.map((b) => [b.name, b]))
    expect(byName.main).toMatchObject({ isBase: true, current: true, merged: false })
    expect(byName.merged).toMatchObject({ ahead: 0, behind: 1, merged: true, isBase: false })
    expect(byName.feature).toMatchObject({
      ahead: 2,
      behind: 1,
      merged: false,
      squashed: false,
      subject: 'feature two'
    })
    expect(byName.squashed).toMatchObject({ ahead: 1, merged: false, squashed: true })
    expect(byName.gone).toMatchObject({ upstream: 'origin/gone', upstreamGone: true })

    // Compared with another branch
    const other = await runOp(repo, 'branchOverview', ['feature'])
    expect(other.branches.find((b) => b.name === 'main')).toMatchObject({ ahead: 1, behind: 2 })

    await expect(runOp(repo, 'deleteBranches', [['merged', 'main']])).rejects.toThrow(/main/)
    expect(git(repo, 'branch', '--list', 'merged')).toBe('')
    await runOp(repo, 'deleteBranches', [['feature', 'squashed']])
    expect(git(repo, 'branch', '--format=%(refname:short)')).toBe('gone\nmain')
    expect(await runOp(repo, 'undo', [])).toBe('Delete 2 branches')
    expect(git(repo, 'rev-parse', 'feature')).toBe(byName.feature.hash)
  })

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

    // The overwritten remote branch is backed up; a plain push isn't
    const [backup] = await runOp(repo, 'backups', [])
    expect(backup).toMatchObject({
      label: 'Force push',
      refs: [{ name: 'refs/remotes/origin/main' }]
    })
    expect(git(repo, 'log', '-1', '--format=%s', backup.refs[0].hash)).toBe('remote work')
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

  it('lists the commits between two tags for the release notes', async () => {
    git(repo, 'tag', 'v1.0.0')
    await commitFile('b.txt', 'b\n', 'feat: b')
    git(repo, 'checkout', '-q', '-b', 'side')
    await commitFile('c.txt', 'c\n', 'fix: c')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'docs: d', '-m', 'Why\n\nBREAKING CHANGE: x')
    git(repo, 'tag', '-a', 'v1.1.0', '-m', 'v1.1.0')
    await commitFile('e.txt', 'e\n', 'chore: e')

    const commits = await runOp(repo, 'releaseCommits', ['v1.0.0', 'v1.1.0'])
    expect(commits.map((c) => c.subject)).toEqual(['docs: d', 'fix: c', 'feat: b'])
    expect(commits[0]).toMatchObject({ author: 'T', body: 'Why\n\nBREAKING CHANGE: x' })
    expect(commits[0].hash).toMatch(/^[0-9a-f]{40}$/)
    expect((await runOp(repo, 'releaseCommits', [null, 'v1.0.0'])).map((c) => c.subject)).toEqual([
      'init'
    ])
    expect(await runOp(repo, 'previousTag', ['HEAD'])).toBe('v1.1.0')
    expect(await runOp(repo, 'previousTag', ['v1.1.0^'])).toBe('v1.0.0')
    expect(await runOp(repo, 'previousTag', ['v1.0.0^'])).toBeNull()
  })

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

  it('hides branches from the graph, shows one alone, and places stashes on their base', async () => {
    await commitFile('b.txt', 'b\n', 'base')
    const base = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'checkout', '-q', '-b', 'side')
    await commitFile('s.txt', 's\n', 'on side')
    git(repo, 'checkout', '-q', 'main')
    await commitFile('m.txt', 'm\n', 'on main')
    write('a.txt', 'wip\n')
    await runOp(repo, 'stashPush', ['my work', false])

    const subjectsOf = async (filter?: {
      hidden: string[]
      solo: string | null
    }): Promise<string[]> => (await loadSnapshot(repo, filter)).commits.map((c) => c.subject)
    expect(await subjectsOf()).toEqual(['on main', 'on side', 'base', 'init'])
    expect(await subjectsOf({ hidden: ['refs/heads/side'], solo: null })).toEqual([
      'on main',
      'base',
      'init'
    ])
    expect(await subjectsOf({ hidden: [], solo: 'refs/heads/side' })).toEqual([
      'on side',
      'base',
      'init'
    ])
    // Invalid names are ignored rather than passed to git
    expect(await subjectsOf({ hidden: ['--all', 'refs/heads/a b'], solo: null })).toHaveLength(4)

    const [stash] = (await loadSnapshot(repo)).stashes
    expect(stash).toMatchObject({ selector: 'stash@{0}', base: git(repo, 'rev-parse', 'HEAD') })
    expect(stash.base).not.toBe(base)
    expect(stash.date).toBeGreaterThan(0)
  })

  it('searches commit messages and changed paths', async () => {
    mkdirSync(join(repo, 'docs'))
    write('docs/Guide.md', 'g\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'Add guide', '-m', 'Fixes the Onboarding issue')
    const guide = git(repo, 'rev-parse', 'HEAD')
    await commitFile('other.txt', 'o\n', 'other')

    expect(await runOp(repo, 'searchCommits', ['message', 'onboarding'])).toEqual([guide])
    expect(await runOp(repo, 'searchCommits', ['file', 'guide.MD'])).toEqual([guide])
    expect(await runOp(repo, 'searchCommits', ['file', 'docs\\gui'])).toEqual([guide])
    expect(await runOp(repo, 'searchCommits', ['file', '*'])).toEqual([])
    expect(await runOp(repo, 'searchCommits', ['message', '  '])).toEqual([])
    await expect(runOp(repo, 'searchCommits', ['message', 'a\nb'])).rejects.toThrow()
  })

  it('finds the commits that add or remove some code, or whose changed lines match', async () => {
    await commitFile('app.js', 'const total = 1\n', 'create')
    const create = git(repo, 'rev-parse', 'HEAD')
    await commitFile('app.js', 'const total = 2\n', 'edit')
    const edit = git(repo, 'rev-parse', 'HEAD')
    await commitFile('app.js', 'const sum = 2\n', 'rename')
    const rename = git(repo, 'rev-parse', 'HEAD')

    // -S: where "total" appeared and went away, not where it only changed line
    expect(await runOp(repo, 'searchCommits', ['code', 'TOTAL'])).toEqual([rename, create])
    expect(await runOp(repo, 'searchCommits', ['code', 'total = 2'])).toEqual([rename, edit])
    // -G: any added or removed line that matches
    expect(await runOp(repo, 'searchCommits', ['regex', 'total = [0-9]'])).toEqual([
      rename,
      edit,
      create
    ])
    expect(await runOp(repo, 'searchCommits', ['regex', '^const (sum|x)'])).toEqual([rename])
    expect(await runOp(repo, 'searchCommits', ['code', '-p'])).toEqual([])
    await expect(runOp(repo, 'searchCommits', ['regex', 'total ('])).rejects.toThrow(
      /Invalid regular expression/
    )
    await runOp(repo, 'cancelSearch', [])
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

  it('previews the conflicts of a merge without touching the working tree', async () => {
    expect(await runOp(repo, 'mergePreview', ['main', 'feature'])).toEqual({ conflicts: [] })
    await commitFile('f.txt', 'main side\n', 'm2')
    await commitFile('a.txt', 'main a\n', 'm3')
    git(repo, 'checkout', '-q', 'feature')
    await commitFile('a.txt', 'feature a\n', 'f3')
    git(repo, 'checkout', '-q', 'main')
    write('m.txt', 'dirty\n')
    expect(await runOp(repo, 'mergePreview', ['HEAD', 'feature'])).toEqual({
      conflicts: ['a.txt', 'f.txt']
    })
    expect(git(repo, 'status', '--porcelain')).toBe('M m.txt')
    git(repo, 'checkout', '-q', '--orphan', 'alone')
    git(repo, 'commit', '-q', '-m', 'alone')
    expect(await runOp(repo, 'mergePreview', ['alone', 'feature'])).toBeNull()
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

  it('moves commits made on the wrong branch to a new or an existing one', async () => {
    await runOp(repo, 'createBranch', ['feature', null, false])
    await commitFile('b.txt', 'b1\n', 'b1')
    await commitFile('b.txt', 'b2\n', 'b2')
    const b1 = git(repo, 'rev-parse', 'HEAD~1')
    const moving = await runOp(repo, 'commitsToMove', [b1])
    expect([moving.branch, moving.commits.map((c) => c.subject), moving.merges]).toEqual([
      'main',
      ['b1', 'b2'],
      0
    ])
    await expect(runOp(repo, 'commitsToMove', [git(repo, 'rev-parse', 'HEAD~2')])).rejects.toThrow(
      /first commit/
    )

    // To a new branch, staying on main with an uncommitted change
    write('a.txt', 'changed\n')
    await runOp(repo, 'moveCommits', [b1, 'fix', true, false])
    expect([git(repo, 'branch', '--show-current'), subjects(), subjects('fix')]).toEqual([
      'main',
      'init',
      'b2\nb1\ninit'
    ])
    expect(git(repo, 'status', '--porcelain')).toBe('M a.txt')
    expect(await labels()).toMatchObject({ undo: 'Move commits to fix' })
    await runOp(repo, 'undo', [])
    expect([subjects(), git(repo, 'branch', '--list', 'fix')]).toEqual(['b2\nb1\ninit', ''])
    git(repo, 'checkout', '--', 'a.txt')

    // To a new branch, checked out
    await runOp(repo, 'moveCommits', [b1, 'fix', true, true])
    expect([git(repo, 'branch', '--show-current'), subjects(), subjects('main')]).toEqual([
      'fix',
      'b2\nb1\ninit',
      'init'
    ])
    await runOp(repo, 'undo', [])
    expect([git(repo, 'branch', '--show-current'), subjects()]).toEqual(['main', 'b2\nb1\ninit'])

    // To an existing branch
    await expect(runOp(repo, 'moveCommits', [b1, 'main', false, false])).rejects.toThrow(
      /already on main/
    )
    git(repo, 'branch', 'copy')
    await expect(runOp(repo, 'moveCommits', [b1, 'copy', false, false])).rejects.toThrow(
      /copy already has these commits/
    )
    await runOp(repo, 'moveCommits', [b1, 'feature', false, false])
    expect([git(repo, 'branch', '--show-current'), subjects(), subjects('main')]).toEqual([
      'feature',
      'b2\nb1\ninit',
      'init'
    ])
    await runOp(repo, 'undo', [])
    expect([git(repo, 'branch', '--show-current'), subjects(), subjects('feature')]).toEqual([
      'main',
      'b2\nb1\ninit',
      'init'
    ])
  })

  it('moves commits through conflicts, and undo takes them back even after an abort', async () => {
    await runOp(repo, 'createBranch', ['other', null, true])
    await commitFile('a.txt', 'other\n', 'on other')
    await runOp(repo, 'checkout', ['main', 'none'])
    await commitFile('a.txt', 'main\n', 'wrong')
    const wrong = git(repo, 'rev-parse', 'HEAD')

    expect((await runOp(repo, 'moveCommits', [wrong, 'other', false, false])).conflicts).toBe(true)
    await runOp(repo, 'abortOperation', [])
    expect([git(repo, 'branch', '--show-current'), subjects('main')]).toEqual(['other', 'init'])
    expect(await labels()).toMatchObject({ undo: 'Move commits to other' })
    await runOp(repo, 'undo', [])
    expect([git(repo, 'branch', '--show-current'), subjects()]).toEqual(['main', 'wrong\ninit'])

    // Resolved and continued, the move is complete
    await runOp(repo, 'moveCommits', [wrong, 'other', false, false])
    write('a.txt', 'both\n')
    await runOp(repo, 'stage', [['a.txt']])
    await runOp(repo, 'continueOperation', [])
    expect([subjects(), subjects('main')]).toEqual(['wrong\non other\ninit', 'init'])
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
  it('lists the files of a commit, shows one as it was and saves it', async () => {
    mkdirSync(join(repo, 'docs'))
    await commitFile('docs/read me.md', '\uFEFFfirst\n', 'create')
    const first = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]))
    writeFileSync(join(repo, 'data.bin'), Buffer.from([1, 0, 2]))
    write('docs/read me.md', 'second\n')
    await runOp(repo, 'stage', [['.']])
    await runOp(repo, 'commit', ['more', false])
    write('docs/read me.md', 'third\n')

    expect(await runOp(repo, 'treeFiles', [first])).toEqual([
      { path: 'docs/read me.md', size: 9, kind: 'file' }
    ])
    expect((await runOp(repo, 'treeFiles', ['HEAD'])).map((f) => f.path)).toEqual([
      'data.bin',
      'docs/read me.md',
      'logo.png'
    ])
    const old = await runOp(repo, 'fileAt', [first, 'docs/read me.md'])
    expect(old).toMatchObject({ text: 'first\n', binary: false, image: null, tooLarge: false })
    expect((await runOp(repo, 'fileAt', ['HEAD', 'docs/read me.md'])).text).toBe('second\n')
    expect((await runOp(repo, 'fileAt', [null, 'docs/read me.md'])).text).toBe('third\n')
    expect(await runOp(repo, 'fileAt', ['HEAD', 'data.bin'])).toMatchObject({
      text: null,
      binary: true,
      size: 3
    })
    const logo = await runOp(repo, 'fileAt', ['HEAD', 'logo.png'])
    expect([logo.binary, logo.image?.startsWith('data:image/png;base64,')]).toEqual([false, true])
    await expect(runOp(repo, 'fileAt', [first, 'logo.png'])).rejects.toThrow()
    await expect(runOp(repo, 'fileAt', [null, '../outside.txt'])).rejects.toThrow(/Invalid path/)
    await expect(runOp(repo, 'treeFiles', ['HEAD:docs'])).rejects.toThrow(/Invalid revision/)

    const dest = join(root, 'saved.bin')
    await runOp(repo, 'saveFileAt', ['HEAD', 'data.bin', dest])
    expect([...readFileSync(dest)]).toEqual([1, 0, 2])
    await expect(runOp(repo, 'saveFileAt', ['HEAD', 'data.bin', 'relative.bin'])).rejects.toThrow(
      /Invalid destination/
    )
  })

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

  it('finds a line of the blame in the version before its commit', async () => {
    const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    await commitFile('old name.txt', lines.join('\n') + '\n', 'create')
    // Renamed with two lines added on top and b changed, in the same commit
    git(repo, 'mv', 'old name.txt', 'new name.txt')
    await commitFile(
      'new name.txt',
      ['x', 'y', 'a', 'B', ...lines.slice(2)].join('\n') + '\n',
      'edit'
    )

    const blame = await runOp(repo, 'blame', ['new name.txt', null])
    const line = blame.lines[3]
    const edit = blame.commits[line.hash]
    expect([line.text, line.sourceLine, edit.summary, edit.previous?.path]).toEqual([
      'B',
      4,
      'edit',
      'old name.txt'
    ])
    expect(await runOp(repo, 'lineBefore', [edit.hash, edit.path, edit.previous!, 4])).toBe(2)
    expect(await runOp(repo, 'lineBefore', [edit.hash, edit.path, edit.previous!, 8])).toBe(6)
  })

  it('follows some lines, or a function, through the commits that changed them', async () => {
    await commitFile('old name.txt', 'one\ntwo\nthree\nfour\n', 'create')
    git(repo, 'mv', 'old name.txt', 'new name.txt')
    await commitFile('new name.txt', 'one\nTWO\nthree\nfour\n', 'edit two')
    await commitFile('new name.txt', 'one\nTWO\nthree\nFOUR\n', 'edit four')

    const lines = await runOp(repo, 'lineHistory', ['new name.txt', '2,3', null])
    expect(lines.map((r) => [r.subject, r.path, r.diff.oldPath])).toEqual([
      ['edit two', 'new name.txt', 'old name.txt'],
      ['create', 'old name.txt', undefined]
    ])
    expect(lines[0].diff.hunks[0].lines.map((l) => l.type + l.text)).toEqual([
      'deltwo',
      'addTWO',
      'contextthree'
    ])
    expect(lines[1].diff.change).toBe('added')
    // Line numbers of an older version
    const before = await runOp(repo, 'lineHistory', ['old name.txt', '4,4', lines[1].hash])
    expect(before.map((r) => r.subject)).toEqual(['create'])

    await commitFile(
      'code.c',
      'int add(int a) {\n  return a;\n}\n\nint sub(int a) {\n  return -a;\n}\n',
      'code'
    )
    await commitFile(
      'code.c',
      'int add(int a) {\n  return a + 1;\n}\n\nint sub(int a) {\n  return -a;\n}\n',
      'fix add'
    )
    const fn = await runOp(repo, 'lineHistory', ['code.c', ':sub', null])
    expect(fn.map((r) => r.subject)).toEqual(['code'])
    await expect(runOp(repo, 'lineHistory', ['code.c', ':mul', null])).rejects.toThrow(
      'no function named “mul”'
    )

    for (const range of ['0,2', '3,1', 'a,b', ':x:y', '1,2 -p'])
      await expect(runOp(repo, 'lineHistory', ['code.c', range, null])).rejects.toThrow(
        'Invalid line range'
      )
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

  it('adds a submodule and syncs its URL', async () => {
    vi.stubEnv('GIT_CONFIG_PARAMETERS', "'protocol.file.allow=always'")
    const lib = join(root, 'lib')
    mkdirSync(lib)
    init(lib)
    writeFileSync(join(lib, 'lib.txt'), 'lib\n')
    git(lib, 'add', '.')
    git(lib, 'commit', '-q', '-m', 'lib')
    await commitFile('a.txt', 'a\n', 'first')

    await runOp(repo, 'submoduleAdd', [lib, 'libs/lib'])
    expect(existsSync(join(repo, 'libs', 'lib', 'lib.txt'))).toBe(true)
    expect((await loadSnapshot(repo)).submodules.map((s) => s.path)).toEqual(['libs/lib'])
    await expect(runOp(repo, 'submoduleAdd', [lib, '../outside'])).rejects.toThrow()

    // A URL changed in .gitmodules reaches the configuration only with a sync
    const moved = join(root, 'lib-moved')
    git(repo, 'config', '-f', '.gitmodules', 'submodule.libs/lib.url', moved)
    await runOp(repo, 'submoduleSync', [[]])
    expect(git(repo, 'config', 'submodule.libs/lib.url')).toBe(moved)
    vi.unstubAllEnvs()
  })

  it('opens the external diff tool on each kind of change (DIFF-12)', async () => {
    await commitFile('a.txt', 'one\n', 'first')
    await commitFile('a.txt', 'two\n', 'second')
    // A "tool" that records the two sides it was given
    git(repo, 'config', 'difftool.fake.cmd', 'cat "$LOCAL" "$REMOTE" >> ../seen.txt')
    const seen = (): string => readFileSync(join(root, 'seen.txt'), 'utf8').replace(/\r/g, '')
    const tools = { gitPath: '', editor: '', mergeTool: '', diffTool: '' }
    // Independent of a diff.tool in the user's own configuration
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'no-global-config'))
    try {
      await expect(runOp(repo, 'openDiffTool', [{ kind: 'unstaged' }, 'a.txt'])).rejects.toThrow(
        /No external diff tool/
      )
      setToolSettings({ ...tools, diffTool: 'fake' })
      await runOp(repo, 'openDiffTool', [
        { kind: 'commit', hash: git(repo, 'rev-parse', 'HEAD') },
        'a.txt'
      ])
      expect(seen()).toBe('one\ntwo\n')
      write('a.txt', 'three\n')
      await runOp(repo, 'openDiffTool', [{ kind: 'unstaged' }, 'a.txt'])
      expect(seen()).toBe('one\ntwo\ntwo\nthree\n')
      setToolSettings({ ...tools, diffTool: 'bad tool' })
      await expect(runOp(repo, 'openDiffTool', [{ kind: 'unstaged' }, 'a.txt'])).rejects.toThrow(
        /Invalid diff tool/
      )
    } finally {
      setToolSettings(tools)
      vi.unstubAllEnvs()
    }
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

describe('safety net', () => {
  beforeEach(async () => {
    await commitFile('a.txt', '1\n', 'one')
    await commitFile('a.txt', '2\n', 'two')
  })

  const head = (): string => git(repo, 'rev-parse', 'HEAD')

  it('backs up the branch before a reset, keeps it out of the graph and restores it', async () => {
    const two = head()
    await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD~1'), 'hard'])
    const [backup] = await runOp(repo, 'backups', [])
    expect(backup).toMatchObject({
      label: expect.stringMatching(/^Reset/),
      refs: [{ name: 'refs/heads/main', hash: two, current: head() }]
    })
    expect(git(repo, 'for-each-ref', '--format=%(objectname)', 'refs/gitdom/')).toBe(two)

    // The backup ref keeps "two" alive, but it's no branch: the graph doesn't show it
    const snapshot = await loadSnapshot(repo)
    expect(snapshot.commits.map((c) => c.subject)).toEqual(['one'])

    await runOp(repo, 'restoreBackup', [backup.id, 'refs/heads/main'])
    expect(head()).toBe(two)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('2\n')
    const labels = (await runOp(repo, 'backups', [])).map((b) => b.label)
    expect(labels).toEqual(['Restore main from a backup', backup.label])

    await runOp(repo, 'undo', [])
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('one')

    await runOp(repo, 'deleteBackup', [backup.id])
    expect((await runOp(repo, 'backups', [])).map((b) => b.id)).not.toContain(backup.id)
    await expect(runOp(repo, 'restoreBackup', [backup.id, 'refs/heads/main'])).rejects.toThrow()
  })

  it('drops the backup of a reset that moves nothing', async () => {
    await runOp(repo, 'reset', [head(), 'mixed'])
    expect(await runOp(repo, 'backups', [])).toEqual([])
    expect(git(repo, 'for-each-ref', 'refs/gitdom/')).toBe('')
  })

  it('refuses to restore anything but a local branch', async () => {
    await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD~1'), 'soft'])
    const [backup] = await runOp(repo, 'backups', [])
    await expect(runOp(repo, 'restoreBackup', [backup.id, 'HEAD'])).rejects.toThrow(
      'local branches'
    )
  })

  it('lists the reflog of HEAD and of a branch', async () => {
    await runOp(repo, 'reset', [git(repo, 'rev-parse', 'HEAD~1'), 'hard'])
    const reflog = await runOp(repo, 'reflog', ['HEAD'])
    expect(reflog[0]).toMatchObject({ action: 'reset', subject: 'one' })
    expect(reflog[1]).toMatchObject({ action: 'commit', message: 'two', subject: 'two' })
    expect(reflog[0].date).toBeGreaterThan(1e9)
    expect((await runOp(repo, 'reflog', ['refs/heads/main'])).length).toBe(3)
    expect(await runOp(repo, 'reflog', ['refs/heads/missing'])).toEqual([])
    await expect(runOp(repo, 'reflog', ['--all'])).rejects.toThrow()
  })

  it('logs the commands of an action together, hiding credentials', async () => {
    const { activityEntries, clearActivity } = await import('./activity')
    clearActivity()
    await runOp(repo, 'createBranch', ['topic', null, false])
    await runOp(repo, 'addRemote', ['origin', 'https://me:secret@example.com/r.git'])
    const entries = activityEntries()
    const branch = entries.filter((e) => e.action === 'Create branch topic')
    expect(branch.length).toBeGreaterThan(0)
    expect(new Set(branch.map((e) => e.actionId)).size).toBe(1)
    expect(branch.some((e) => e.args.includes('branch') && e.ok)).toBe(true)
    const text = JSON.stringify(entries)
    expect(text).not.toContain('secret')
    expect(text).toContain('https://***@example.com')
  })
})

describe('complete commits', () => {
  beforeEach(async () => {
    await commitFile('a.txt', '1\n', 'one')
    await commitFile('a.txt', '2\n', 'two')
  })

  const subjects = (): string[] => git(repo, 'log', '--format=%s').split('\n')

  it('skips hooks and sets another author', async () => {
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho no >&2\nexit 1\n')
    write('b.txt', 'b\n')
    await runOp(repo, 'stage', [['b.txt']])
    await expect(runOp(repo, 'commit', ['blocked', false])).rejects.toThrow()
    await runOp(repo, 'commit', ['skipped', false, { noVerify: true, author: 'Ann <ann@x.it>' }])
    expect(git(repo, 'log', '-1', '--format=%s|%an|%ae|%cn')).toBe('skipped|Ann|ann@x.it|T')
    await expect(
      runOp(repo, 'commit', ['bad', true, { noVerify: true, author: 'no email' }])
    ).rejects.toThrow('Name <email>')
  })

  it('rewords the last commit, leaving staged changes out', async () => {
    write('a.txt', 'staged\n')
    await runOp(repo, 'stage', [['a.txt']])
    await runOp(repo, 'reword', [git(repo, 'rev-parse', 'HEAD'), 'two, reworded\n\nbody'])
    expect(git(repo, 'log', '-1', '--format=%B')).toBe('two, reworded\n\nbody')
    expect(git(repo, 'show', 'HEAD:a.txt')).toBe('2')
    expect((await runOp(repo, 'status', [])).staged).toEqual([{ path: 'a.txt', status: 'M' }])
  })

  it('rewords an older commit, backed up and undoable', async () => {
    await commitFile('b.txt', 'b\n', 'three')
    write('a.txt', 'dirty\n')
    const tip = git(repo, 'rev-parse', 'HEAD')
    const outcome = await runOp(repo, 'reword', [git(repo, 'rev-parse', 'HEAD~2'), 'one, reworded'])
    expect(outcome.conflicts).toBe(false)
    expect(subjects()).toEqual(['three', 'two', 'one, reworded'])
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('dirty\n')
    expect((await runOp(repo, 'backups', []))[0].refs[0]).toMatchObject({ hash: tip })
    await runOp(repo, 'undo', [])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tip)
  })

  it('rewords without running the commit hooks', async () => {
    await commitFile('b.txt', 'b\n', 'three')
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n')
    await runOp(repo, 'reword', [git(repo, 'rev-parse', 'HEAD'), 'three, reworded'])
    const outcome = await runOp(repo, 'reword', [git(repo, 'rev-parse', 'HEAD~2'), 'one, reworded'])
    expect(outcome.conflicts).toBe(false)
    expect(subjects()).toEqual(['three, reworded', 'two', 'one, reworded'])
  })

  it('refuses to reword across merges or off the current branch', async () => {
    const one = git(repo, 'rev-parse', 'HEAD~1')
    git(repo, 'checkout', '-q', '-b', 'side', one)
    await commitFile('s.txt', 's\n', 'side')
    const side = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'checkout', '-q', 'main')
    await expect(runOp(repo, 'reword', [side, 'x'])).rejects.toThrow('not on the current branch')
    git(repo, 'merge', '-q', '--no-edit', 'side')
    await expect(runOp(repo, 'reword', [one, 'x'])).rejects.toThrow('merge')
    // The merge itself is the last commit: amending it is fine
    await runOp(repo, 'reword', [git(repo, 'rev-parse', 'HEAD'), 'merged'])
    expect(git(repo, 'rev-list', '--parents', '-n1', 'HEAD').split(' ')).toHaveLength(3)
  })

  it('adds staged changes to the last commit or to an older one, undoable', async () => {
    await expect(runOp(repo, 'fixup', [git(repo, 'rev-parse', 'HEAD')])).rejects.toThrow(
      'Stage the changes'
    )
    write('a.txt', 'amended\n')
    await runOp(repo, 'stage', [['a.txt']])
    await runOp(repo, 'fixup', [git(repo, 'rev-parse', 'HEAD')])
    expect(subjects()).toEqual(['two', 'one'])
    expect(git(repo, 'show', 'HEAD:a.txt')).toBe('amended')

    await commitFile('b.txt', 'b\n', 'three')
    write('c.txt', 'c\n')
    write('b.txt', 'dirty\n')
    await runOp(repo, 'stage', [['c.txt']])
    const tip = git(repo, 'rev-parse', 'HEAD')
    const outcome = await runOp(repo, 'fixup', [git(repo, 'rev-parse', 'HEAD~2')])
    expect(outcome.conflicts).toBe(false)
    expect(subjects()).toEqual(['three', 'two', 'one'])
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD~2').split('\n')).toContain('c.txt')
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('b.txt')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('dirty\n')
    expect((await runOp(repo, 'status', [])).staged).toEqual([])

    await runOp(repo, 'undo', [])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tip)
    expect((await runOp(repo, 'status', [])).staged).toEqual([{ path: 'c.txt', status: 'A' }])
  })

  it('refuses to fix up across merges, leaving the staged changes alone', async () => {
    const one = git(repo, 'rev-parse', 'HEAD~1')
    git(repo, 'checkout', '-q', '-b', 'side', one)
    await commitFile('s.txt', 's\n', 'side')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'merge', '-q', '--no-edit', 'side')
    const tip = git(repo, 'rev-parse', 'HEAD')
    write('c.txt', 'c\n')
    await runOp(repo, 'stage', [['c.txt']])
    await expect(runOp(repo, 'fixup', [one])).rejects.toThrow('merge')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tip)
    expect((await runOp(repo, 'status', [])).staged).toEqual([{ path: 'c.txt', status: 'A' }])
  })

  it('splits an older commit, keeping the merges after it and the uncommitted changes', async () => {
    write('b.txt', 'b\n')
    write('c.txt', 'c\n')
    write('a.txt', '3\n')
    await runOp(repo, 'stage', [['a.txt', 'b.txt', 'c.txt']])
    await runOp(repo, 'commit', ['mixed\n\nbody', false, { author: 'Ann <ann@x.it>' }])
    const mixed = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'checkout', '-q', '-b', 'side')
    await commitFile('s.txt', 's\n', 'side')
    git(repo, 'checkout', '-q', 'main')
    await commitFile('m.txt', 'm\n', 'main work')
    git(repo, 'merge', '-q', '--no-edit', 'side')
    const tip = git(repo, 'rev-parse', 'HEAD')
    const tree = git(repo, 'rev-parse', 'HEAD^{tree}')
    write('s.txt', 'dirty\n')
    write('m.txt', 'staged\n')
    await runOp(repo, 'stage', [['m.txt']])

    await runOp(repo, 'splitCommit', [mixed, ['b.txt', 'c.txt'], 'add b and c', 'change a'])
    expect(git(repo, 'rev-parse', 'HEAD^{tree}')).toBe(tree)
    expect(git(repo, 'log', '--first-parent', '--format=%s|%an', 'HEAD~1').split('\n')).toEqual([
      'main work|T',
      'change a|Ann',
      'add b and c|Ann',
      'two|T',
      'one|T'
    ])
    expect(git(repo, 'rev-list', '--parents', '-n1', 'HEAD').split(' ')).toHaveLength(3)
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD~2')).toBe('a.txt')
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD~3').split('\n')).toEqual([
      'b.txt',
      'c.txt'
    ])
    expect(readFileSync(join(repo, 's.txt'), 'utf8')).toBe('dirty\n')
    expect((await runOp(repo, 'status', [])).staged).toEqual([{ path: 'm.txt', status: 'M' }])

    await runOp(repo, 'undo', [])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tip)
    expect((await runOp(repo, 'status', [])).staged).toEqual([{ path: 'm.txt', status: 'M' }])
  })

  it('splits the last commit and the root one, and refuses what cannot be split', async () => {
    git(repo, 'rm', '-q', 'a.txt')
    write('b.txt', 'b\n')
    await runOp(repo, 'stage', [['b.txt']])
    await runOp(repo, 'commit', ['swap', false])
    const head = git(repo, 'rev-parse', 'HEAD')
    await expect(runOp(repo, 'splitCommit', [head, ['a.txt', 'b.txt'], 'x', 'y'])).rejects.toThrow(
      'not all'
    )
    await expect(runOp(repo, 'splitCommit', [head, [], 'x', 'y'])).rejects.toThrow('not all')
    await expect(runOp(repo, 'splitCommit', [head, ['c.txt'], 'x', 'y'])).rejects.toThrow(
      "didn't change c.txt"
    )
    await expect(runOp(repo, 'splitCommit', [head, ['a.txt'], 'x', ' '])).rejects.toThrow('message')
    await runOp(repo, 'splitCommit', [head, ['a.txt'], 'remove a', 'add b'])
    expect(subjects()).toEqual(['add b', 'remove a', 'two', 'one'])
    expect(git(repo, 'ls-tree', '--name-only', 'HEAD~1')).toBe('')

    git(repo, 'checkout', '-q', '--orphan', 'other')
    git(repo, 'rm', '-q', '-r', '--cached', '.')
    git(repo, 'clean', '-q', '-f')
    write('d.txt', 'd\n')
    write('e.txt', 'e\n')
    await runOp(repo, 'stage', [['d.txt', 'e.txt']])
    await runOp(repo, 'commit', ['root pair', false])
    const pair = git(repo, 'rev-parse', 'HEAD')
    await commitFile('f.txt', 'f\n', 'other')
    await runOp(repo, 'splitCommit', [pair, ['e.txt'], 'e first', 'the rest'])
    expect(subjects()).toEqual(['other', 'the rest', 'e first'])
    expect(git(repo, 'ls-tree', '--name-only', 'HEAD~2')).toBe('e.txt')

    git(repo, 'checkout', '-q', 'main')
    git(repo, 'merge', '-q', '--no-edit', '--allow-unrelated-histories', 'other')
    await expect(
      runOp(repo, 'splitCommit', [git(repo, 'rev-parse', 'HEAD'), ['d.txt'], 'x', 'y'])
    ).rejects.toThrow('merge commit')
  })

  it('reorders the commits of the branch, keeping the uncommitted changes, undoable', async () => {
    await commitFile('b.txt', 'b\n', 'three')
    await commitFile('c.txt', 'c\n', 'four')
    write('b.txt', 'dirty\n')
    const tip = git(repo, 'rev-parse', 'HEAD')
    const [four, three, two] = git(repo, 'rev-list', 'HEAD~3..HEAD').split('\n')
    const outcome = await runOp(repo, 'reorderCommits', [
      git(repo, 'rev-parse', 'HEAD~3'),
      [three, four, two]
    ])
    expect(outcome.conflicts).toBe(false)
    expect(subjects()).toEqual(['two', 'four', 'three', 'one'])
    expect(git(repo, 'show', 'HEAD:a.txt')).toBe('2')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('dirty\n')
    expect((await runOp(repo, 'backups', []))[0].refs[0]).toMatchObject({ hash: tip })
    await runOp(repo, 'undo', [])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tip)
  })

  it('refuses a reorder that would lose a commit or flatten a merge', async () => {
    await commitFile('b.txt', 'b\n', 'three')
    const [three, two] = git(repo, 'rev-list', 'HEAD~2..HEAD').split('\n')
    const base = git(repo, 'rev-parse', 'HEAD~2')
    await expect(runOp(repo, 'reorderCommits', [base, [three]])).rejects.toThrow('changed')
    await expect(runOp(repo, 'reorderCommits', [base, [three, three]])).rejects.toThrow('changed')
    await expect(runOp(repo, 'reorderCommits', [base, [two, three]])).rejects.toThrow('already')
    git(repo, 'checkout', '-q', '-b', 'side', base)
    await commitFile('s.txt', 's\n', 'side')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'merge', '-q', '--no-edit', 'side')
    const tip = git(repo, 'rev-parse', 'HEAD')
    await expect(runOp(repo, 'reorderCommits', [base, [three, two]])).rejects.toThrow('merge')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tip)
  })

  it('adds patterns to .gitignore and stops tracking files', async () => {
    write('.gitignore', 'node_modules/\r\n*.tmp')
    write('app.log', 'x\n')
    await commitFile('build.log', 'x\n', 'logs')
    await runOp(repo, 'ignore', ['*.log', ['build.log']])
    await runOp(repo, 'ignore', ['*.log', []])
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe(
      'node_modules/\r\n*.tmp\r\n*.log\r\n'
    )
    const status = await runOp(repo, 'status', [])
    expect(status.staged).toEqual([{ path: 'build.log', status: 'D' }])
    expect(status.unstaged.map((f) => f.path)).toEqual(['.gitignore'])
    expect(existsSync(join(repo, 'build.log'))).toBe(true)
    await expect(runOp(repo, 'ignore', ['a\nb', []])).rejects.toThrow('Invalid pattern')
  })

  it('reads the commit message template', async () => {
    expect(await runOp(repo, 'commitTemplate', [])).toBeNull()
    writeFileSync(join(root, 'template.txt'), 'Subject\n\n# Why?\n')
    git(repo, 'config', 'commit.template', join(root, 'template.txt'))
    expect(await runOp(repo, 'commitTemplate', [])).toBe('Subject\n\n# Why?\n')
  })

  it('stashes only the staged changes, or only some files', async () => {
    await commitFile('b.txt', 'b\n', 'three')
    write('a.txt', 'staged\n')
    await runOp(repo, 'stage', [['a.txt']])
    write('b.txt', 'unstaged\n')
    await runOp(repo, 'stashPush', ['staged only', false, { staged: true }])
    expect(git(repo, 'stash', 'show', '--name-only', 'stash@{0}')).toBe('a.txt')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('unstaged\n')

    write('new.txt', 'new\n')
    await runOp(repo, 'stashPush', ['one file', true, { paths: ['new.txt'] }])
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('unstaged\n')
    await expect(
      runOp(repo, 'stashPush', ['', false, { staged: true, paths: ['b.txt'] }])
    ).rejects.toThrow('not by file')
  })

  it('merges with local changes, stashing them around the merge', async () => {
    git(repo, 'checkout', '-q', '-b', 'side')
    await commitFile('s.txt', 's\n', 'side')
    git(repo, 'checkout', '-q', 'main')
    await commitFile('m.txt', 'm\n', 'main')
    write('a.txt', 'dirty\n')
    const outcome = await runOp(repo, 'merge', ['side', 'no-ff'])
    expect(outcome.conflicts).toBe(false)
    expect(existsSync(join(repo, 's.txt'))).toBe(true)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('dirty\n')
  })
})

// ssh-keygen comes with Git for Windows and OpenSSH
const sshKeygen = ((): boolean => {
  try {
    execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' })
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ENOENT'
  }
})()

describe.skipIf(!sshKeygen)('signing', () => {
  it('configures SSH signing, signs commits and tags and verifies them', async () => {
    const key = join(root, 'key').replace(/\\/g, '/')
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 't@t.it', '-f', key])
    // An empty program, as some setups have, would make git fail: the default is used instead
    git(repo, 'config', 'gpg.ssh.program', '')
    git(repo, 'config', 'gpg.ssh.allowedSignersFile', '')

    await runOp(repo, 'setSigning', [
      { format: 'ssh', key: `${key}.pub`, commits: true, tags: false },
      'local'
    ])
    expect((await loadSnapshot(repo)).signing).toEqual({
      format: 'ssh',
      key: `${key}.pub`,
      commits: true,
      tags: false
    })

    await commitFile('a.txt', '1\n', 'signed by default')
    write('a.txt', '2\n')
    await runOp(repo, 'stage', [['a.txt']])
    await runOp(repo, 'commit', ['unsigned', false, { sign: false }])
    const [unsigned, signed] = git(repo, 'rev-list', 'HEAD').split('\n')
    expect((await runOp(repo, 'commitDetail', [unsigned])).signature).toBeNull()
    const detail = await runOp(repo, 'commitDetail', [signed])
    expect(detail.signature?.status).toBe('untrusted')
    expect(detail.signature?.key).toMatch(/^SHA256:/)

    const allowed = join(root, 'allowed').replace(/\\/g, '/')
    writeFileSync(allowed, `t@t.it ${readFileSync(`${key}.pub`, 'utf8')}`)
    git(repo, 'config', 'gpg.ssh.allowedSignersFile', allowed)
    expect((await runOp(repo, 'commitDetail', [signed])).signature).toMatchObject({
      status: 'good',
      signer: 't@t.it'
    })

    await runOp(repo, 'createTag', ['v1', 'HEAD', null, true])
    await runOp(repo, 'createTag', ['light', 'HEAD', null, undefined])
    expect(git(repo, 'cat-file', '-p', 'v1')).toContain('BEGIN SSH SIGNATURE')
    expect(git(repo, 'cat-file', '-t', 'light')).toBe('commit')

    await runOp(repo, 'setSigning', [
      { format: 'openpgp', key: null, commits: false, tags: true },
      'local'
    ])
    const signing = (await loadSnapshot(repo)).signing
    expect(signing).toMatchObject({ format: 'openpgp', commits: false, tags: true })
    // With tag.gpgsign a tag without message stays lightweight, instead of waiting on an editor
    await runOp(repo, 'createTag', ['light2', 'HEAD', null, undefined])
    expect(git(repo, 'cat-file', '-t', 'light2')).toBe('commit')
    await expect(
      runOp(repo, 'setSigning', [
        { format: 'ssh', key: '-x', commits: false, tags: false },
        'local'
      ])
    ).rejects.toThrow('Invalid signing key')
  })
})

describe('hover previews', () => {
  it('previews a commit with its body and line counts, and a merge against its first parent', async () => {
    await commitFile('a.txt', 'one\ntwo\n', 'first')
    write('a.txt', 'one\n2\nthree\n')
    write('b.txt', 'b\n')
    await runOp(repo, 'stage', [['a.txt', 'b.txt']])
    await runOp(repo, 'commit', ['second\n\nwhy it changed', false])
    const preview = await runOp(repo, 'commitPreview', [git(repo, 'rev-parse', 'HEAD')])
    expect(preview.body).toBe('why it changed')
    expect(preview.files).toEqual([
      { status: 'M', path: 'a.txt', additions: 2, deletions: 1 },
      { status: 'A', path: 'b.txt', additions: 1, deletions: 0 }
    ])
    const root = await runOp(repo, 'commitPreview', [git(repo, 'rev-parse', 'HEAD~1')])
    expect(root.files).toEqual([{ status: 'A', path: 'a.txt', additions: 2, deletions: 0 }])
  })

  it('reads annotated tags, and null for lightweight ones', async () => {
    await commitFile('a.txt', '1\n', 'one')
    git(repo, 'tag', '-a', 'v1', '-m', 'Release one', '-m', 'Notes')
    git(repo, 'tag', 'light')
    expect(await runOp(repo, 'tagInfo', ['v1'])).toMatchObject({
      tagger: 'T',
      subject: 'Release one',
      body: 'Notes'
    })
    expect(await runOp(repo, 'tagInfo', ['light'])).toBeNull()
    await expect(runOp(repo, 'tagInfo', ['-x'])).rejects.toThrow('Invalid tag name')
  })
})

describe('repository health', () => {
  it('measures the repository, finds the heaviest files in the history, and maintains it', async () => {
    await commitFile('big.bin', 'b'.repeat(200000), 'big')
    await commitFile('kept.txt', 'k'.repeat(50000), 'kept')
    await commitFile('kept.txt', 'k'.repeat(60000), 'kept, bigger')
    git(repo, 'rm', '-q', 'big.bin')
    git(repo, 'commit', '-qm', 'drop big')
    // Only in a dropped stash: unreachable, so not listed
    write('kept.txt', 'u'.repeat(300000))
    git(repo, 'stash', 'push', '-q')
    git(repo, 'stash', 'drop', '-q')

    let health = await runOp(repo, 'repoHealth', [])
    expect(health).toMatchObject({ packs: { count: 0, size: 0 }, lfs: null, commits: 4 })
    expect(health.loose.count).toBeGreaterThan(8)
    expect(health.loose.size).toBeGreaterThan(0)

    const heavy = await runOp(repo, 'heaviestObjects', [])
    expect(heavy.map((o) => [o.path, o.size, o.state]).slice(0, 3)).toEqual([
      ['big.bin', 200000, 'deleted'],
      ['kept.txt', 60000, 'current'],
      ['kept.txt', 50000, 'older']
    ])
    expect(heavy[0].hash).toMatch(/^[0-9a-f]{40}$/)
    expect(heavy[0].diskSize).toBeGreaterThan(0)

    await runOp(repo, 'maintain', ['gc'])
    health = await runOp(repo, 'repoHealth', [])
    // A second, cruft pack holds the unreachable objects since git 2.40
    expect(health.packs.count).toBeGreaterThanOrEqual(1)
    expect(health.loose.count).toBeLessThan(5)
    expect(await runOp(repo, 'maintain', ['prune'])).toEqual([])
    expect(await runOp(repo, 'maintain', ['fsck'])).toEqual([])

    // A missing object is reported, not thrown
    await commitFile('lost.txt', 'lost', 'lost')
    const lost = git(repo, 'rev-parse', 'HEAD:lost.txt')
    rmSync(join(repo, '.git', 'objects', lost.slice(0, 2), lost.slice(2)))
    expect((await runOp(repo, 'maintain', ['fsck'])).join(' ')).toContain(lost)
  })
})

describe('worktrees', () => {
  const norm = (p: string): string => p.replace(/[\\/]+/g, '/').toLowerCase()

  it('adds worktrees for a branch, a new branch and detached, lists and removes them', async () => {
    await commitFile('a.txt', '1\n', 'one')
    git(repo, 'branch', 'feature')
    const feature = await runOp(repo, 'worktreeAdd', [{ path: '../wt-feature', branch: 'feature' }])
    expect(norm(feature)).toBe(norm(join(root, 'wt-feature')))
    await runOp(repo, 'worktreeAdd', [
      { path: join(root, 'wt-new'), newBranch: 'fix', start: 'main' }
    ])
    await runOp(repo, 'worktreeAdd', [{ path: join(root, 'wt-detached'), start: 'HEAD' }])

    const { worktrees } = await loadSnapshot(repo)
    expect(worktrees.map((w) => w.main)).toEqual([true, false, false, false])
    expect(worktrees[0].branch).toBe('main')
    expect(worktrees.slice(1).map((w) => w.branch ?? 'detached')).toEqual(
      expect.arrayContaining(['feature', 'fix', 'detached'])
    )
    expect(norm(worktrees[0].path)).toBe(norm(git(repo, 'rev-parse', '--show-toplevel')))

    // A worktree with changes is only removed when forced
    writeFileSync(join(root, 'wt-new', 'a.txt'), 'changed\n')
    await expect(runOp(repo, 'worktreeRemove', [join(root, 'wt-new'), false])).rejects.toThrow()
    await runOp(repo, 'worktreeRemove', [join(root, 'wt-new'), true])
    expect(existsSync(join(root, 'wt-new'))).toBe(false)
    expect((await loadSnapshot(repo)).worktrees).toHaveLength(3)
  })

  it('locks, unlocks and prunes worktrees whose folder is gone', async () => {
    await commitFile('a.txt', '1\n', 'one')
    const path = join(root, 'wt')
    await runOp(repo, 'worktreeAdd', [{ path, newBranch: 'side' }])
    await runOp(repo, 'worktreeLock', [path, true])
    expect((await loadSnapshot(repo)).worktrees[1].locked).toBe('')
    await expect(runOp(repo, 'worktreeRemove', [path, false])).rejects.toThrow()
    await runOp(repo, 'worktreeLock', [path, false])

    rmSync(path, { recursive: true, force: true })
    expect((await loadSnapshot(repo)).worktrees[1].prunable).not.toBeNull()
    await runOp(repo, 'worktreePrune', [])
    expect((await loadSnapshot(repo)).worktrees).toHaveLength(1)
  })

  it('rejects folders and branches that look like options', async () => {
    await commitFile('a.txt', '1\n', 'one')
    await expect(runOp(repo, 'worktreeAdd', [{ path: '-x' }])).rejects.toThrow('Invalid folder')
    await expect(
      runOp(repo, 'worktreeAdd', [{ path: join(root, 'wt'), branch: '--orphan' }])
    ).rejects.toThrow('Invalid revision')
  })
})

describe('hooks', () => {
  it('lists, writes, turns off and on, runs and deletes hooks', async () => {
    await commitFile('a.txt', 'a\n', 'init')
    const hooksDir = join(repo, '.git', 'hooks')
    const state = async (name: string): Promise<string | undefined> =>
      (await runOp(repo, 'hooks', [])).hooks.find((h) => h.name === name)?.state

    const info = await runOp(repo, 'hooks', [])
    expect(info.dir.replace(/\\/g, '/')).toBe(hooksDir.replace(/\\/g, '/'))
    expect(info).toMatchObject({ hooksPath: null, manager: null })
    // git init writes the samples; server hooks only show when there is a script for them
    expect(info.hooks[0]).toMatchObject({ name: 'pre-commit', skippable: true, runnable: true })
    expect(await state('pre-commit')).toBe('sample')
    expect(await state('update')).toBe('sample')
    expect(await state('post-rewrite')).toBe('none')
    expect(await runOp(repo, 'readHook', ['pre-commit'])).toContain('#!/bin/sh')

    // A pre-commit that stops every commit, written with Windows line ends
    await runOp(repo, 'saveHook', [
      'pre-commit',
      '#!/bin/sh\r\necho "tests failed" >&2\r\nexit 1\r\n'
    ])
    expect(readFileSync(join(hooksDir, 'pre-commit'), 'utf8')).toBe(
      '#!/bin/sh\necho "tests failed" >&2\nexit 1\n'
    )
    expect(await state('pre-commit')).toBe('active')
    write('a.txt', 'b\n')
    await runOp(repo, 'stage', [['a.txt']])
    await expect(runOp(repo, 'commit', ['blocked', false])).rejects.toThrow()
    expect(await runOp(repo, 'runHook', ['pre-commit'])).toEqual({
      ok: false,
      output: 'tests failed'
    })

    // Off: the commit goes through; saving keeps it off
    await runOp(repo, 'setHookEnabled', ['pre-commit', false])
    expect(await state('pre-commit')).toBe('disabled')
    await runOp(repo, 'commit', ['passes', false])
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('passes')
    await runOp(repo, 'saveHook', ['pre-commit', '#!/bin/sh\necho fine\n'])
    expect(await state('pre-commit')).toBe('disabled')
    expect(await runOp(repo, 'readHook', ['pre-commit'])).toBe('#!/bin/sh\necho fine\n')
    await runOp(repo, 'setHookEnabled', ['pre-commit', true])
    expect(await runOp(repo, 'runHook', ['pre-commit'])).toEqual({ ok: true, output: 'fine' })

    // Deleting leaves the sample
    await runOp(repo, 'deleteHook', ['pre-commit'])
    expect(await state('pre-commit')).toBe('sample')
    // A script git doesn't know is listed too
    writeFileSync(join(hooksDir, 'my-check'), '#!/bin/sh\n')
    expect((await runOp(repo, 'hooks', [])).hooks.at(-1)).toMatchObject({
      name: 'my-check',
      state: 'active',
      runnable: false
    })

    await expect(runOp(repo, 'readHook', ['../config'])).rejects.toThrow('Not a hook name')
    await expect(runOp(repo, 'runHook', ['commit-msg'])).rejects.toThrow("can't run by itself")
    await expect(runOp(repo, 'setHookEnabled', ['post-merge', true])).rejects.toThrow(
      'no post-merge hook'
    )

    // core.hooksPath: the hooks of the project, or of a tool
    git(repo, 'config', 'core.hooksPath', '.husky/_')
    const husky = await runOp(repo, 'hooks', [])
    expect(husky.dir.replace(/\\/g, '/')).toBe(join(repo, '.husky', '_').replace(/\\/g, '/'))
    expect(husky).toMatchObject({ hooksPath: '.husky/_', manager: 'Husky' })
    expect(husky.hooks.every((h) => h.state === 'none')).toBe(true)
  })
})

describe('bisect (ADV-06)', () => {
  // c1 … c8; the bug comes in with c5
  const hashes: string[] = []
  beforeEach(async () => {
    hashes.length = 0
    for (let i = 1; i <= 8; i++) {
      await commitFile('app.txt', i >= 5 ? `bug ${i}\n` : `ok ${i}\n`, `c${i}`)
      hashes.push(git(repo, 'rev-parse', 'HEAD'))
    }
  })
  const bisect = async (): Promise<
    NonNullable<Awaited<ReturnType<typeof loadSnapshot>>['bisect']>
  > => {
    const state = (await loadSnapshot(repo)).bisect
    expect(state).not.toBeNull()
    return state!
  }
  const head = (): string => git(repo, 'rev-parse', 'HEAD')
  const buggy = (): boolean => readFileSync(join(repo, 'app.txt'), 'utf8').startsWith('bug')

  it('finds the first bad commit by marking, and goes back when stopped', async () => {
    expect((await loadSnapshot(repo)).bisect).toBeNull()
    // Only the bad one: waiting for a good one
    await runOp(repo, 'bisectStart', ['HEAD', null])
    expect(await bisect()).toMatchObject({
      original: 'main',
      bad: hashes[7],
      good: [],
      candidates: 0,
      culprit: null
    })
    await expect(runOp(repo, 'bisectStart', ['HEAD', null])).rejects.toThrow('already in progress')
    await runOp(repo, 'bisectMark', ['good', hashes[0]])
    expect(await bisect()).toMatchObject({ good: [hashes[0]], candidates: 7, culprit: null })
    // Test what git checks out, until it is found
    for (let step = 0; step < 5 && !(await bisect()).culprit; step++)
      await runOp(repo, 'bisectMark', [buggy() ? 'bad' : 'good', null])
    expect((await bisect()).culprit).toBe(hashes[4])
    await runOp(repo, 'bisectReset', [])
    expect((await loadSnapshot(repo)).bisect).toBeNull()
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD')).toBe('main')
    expect(head()).toBe(hashes[7])
  })

  it('skips commits, refuses with changes, and runs a command', async () => {
    write('app.txt', 'changed\n')
    await expect(runOp(repo, 'bisectStart', ['HEAD', hashes[0]])).rejects.toThrow(
      'Commit or stash your changes first'
    )
    git(repo, 'checkout', '--', 'app.txt')
    await expect(runOp(repo, 'bisectStart', ['nothing', null])).rejects.toThrow('Not a commit')
    await expect(runOp(repo, 'bisectMark', ['good', null])).rejects.toThrow('No bisect')

    // Skipping all the commits around the bug: only skipped ones left
    await runOp(repo, 'bisectStart', [hashes[5], hashes[2]])
    await runOp(repo, 'bisectMark', ['skip', hashes[3]])
    await runOp(repo, 'bisectMark', ['skip', hashes[4]])
    const state = await bisect()
    expect(state).toMatchObject({ candidates: 3, culprit: null, onlySkipped: true })
    expect(state.skipped.sort()).toEqual([hashes[3], hashes[4]].sort())
    await runOp(repo, 'bisectReset', [])

    // A command tells good from bad: fails where the bug is (shell builtins only, for Windows)
    await runOp(repo, 'bisectStart', ['HEAD', hashes[0]])
    const output = await runOp(repo, 'bisectRun', [
      'read line < app.txt; case "$line" in ok*) exit 0 ;; *) exit 1 ;; esac'
    ])
    expect(output).toContain(`${hashes[4]} is the first bad commit`)
    expect((await bisect()).culprit).toBe(hashes[4])
    await runOp(repo, 'bisectReset', [])
  })
})
