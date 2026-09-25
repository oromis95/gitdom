import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloneProgress } from '../../shared/api'
import { repoNameFromUrl } from '../../shared/templates'
import { cancelClone, cloneRepository, initRepository, parseCloneProgress } from './clone'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

let root: string
let origin: string

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', input: '' }).trim()

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gitdom-clone-'))
  origin = join(root, 'origin')
  mkdirSync(origin)
  git(origin, 'init', '-q', '-b', 'main')
  git(origin, 'config', 'user.email', 't@t.it')
  git(origin, 'config', 'user.name', 'T')
  git(origin, 'config', 'core.autocrlf', 'false')
  for (const n of [1, 2, 3]) {
    writeFileSync(join(origin, 'a.txt'), `${n}\n`)
    git(origin, 'add', 'a.txt')
    git(origin, 'commit', '-q', '-m', `c${n}`)
  }
  git(origin, 'branch', 'feature')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('parseCloneProgress', () => {
  it('maps each phase onto a share of the overall bar', () => {
    expect(parseCloneProgress('remote: Counting objects: 100% (10/10), done.')).toEqual({
      phase: 'Counting objects',
      percent: 10
    })
    expect(parseCloneProgress('Receiving objects:  50% (5/10), 1.00 MiB | 2.00 MiB/s')).toEqual({
      phase: 'Receiving objects',
      percent: 45
    })
    expect(parseCloneProgress('Resolving deltas: 100% (3/3), done.')?.percent).toBe(95)
    expect(parseCloneProgress('Updating files:  0% (0/4)')?.percent).toBe(95)
  })

  it('ignores lines that are not progress', () => {
    expect(parseCloneProgress("Cloning into 'app'...")).toBeNull()
    expect(parseCloneProgress('warning: redirecting to https://x/')).toBeNull()
  })

  it('keeps unknown phases without a percentage', () => {
    expect(parseCloneProgress('Something new: 40% (4/10)')).toEqual({
      phase: 'Something new',
      percent: null
    })
  })
})

describe('repoNameFromUrl', () => {
  it.each([
    ['https://github.com/team/app.git', 'app'],
    ['https://github.com/team/app/', 'app'],
    ['git@github.com:team/app.git', 'app'],
    ['ssh://git@host:22/team/app', 'app'],
    ['C:\\repos\\app', 'app'],
    ['', '']
  ])('%s gives "%s"', (url, name) => expect(repoNameFromUrl(url)).toBe(name))
})

describe('cloneRepository', () => {
  it('clones with every branch and reports progress', async () => {
    const progress: CloneProgress[] = []
    const path = await cloneRepository(
      1,
      { url: origin, parent: root, name: 'copy', recursive: true },
      (p) => progress.push(p)
    )
    expect(path).toBe(join(root, 'copy'))
    expect(git(path, 'rev-list', '--count', 'HEAD')).toBe('3')
    expect(git(path, 'branch', '-r')).toContain('origin/feature')
  })

  it('clones a branch with a shallow history, keeping the other branches', async () => {
    const path = await cloneRepository(
      2,
      {
        url: `file://${origin.replace(/\\/g, '/')}`,
        parent: root,
        name: 'shallow',
        branch: 'feature',
        depth: 1,
        recursive: false
      },
      () => undefined
    )
    expect(git(path, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(git(path, 'branch', '--show-current')).toBe('feature')
    expect(git(path, 'branch', '-r')).toContain('origin/main')
  })

  it('refuses a folder that is not empty, and bad arguments', async () => {
    mkdirSync(join(root, 'busy'))
    writeFileSync(join(root, 'busy', 'x'), 'x')
    const opts = { url: origin, parent: root, recursive: false }
    await expect(cloneRepository(3, { ...opts, name: 'busy' }, () => undefined)).rejects.toThrow(
      /isn't empty/
    )
    await expect(cloneRepository(3, { ...opts, name: 'a/b' }, () => undefined)).rejects.toThrow(
      /Invalid folder name/
    )
    await expect(
      cloneRepository(3, { ...opts, url: '--upload-pack=x', name: 'x' }, () => undefined)
    ).rejects.toThrow(/Invalid URL/)
    await expect(
      cloneRepository(3, { ...opts, name: 'x', depth: 0.5 }, () => undefined)
    ).rejects.toThrow(/Invalid depth/)
  })

  it('reports a failed clone and leaves nothing behind', async () => {
    await expect(
      cloneRepository(
        4,
        { url: join(root, 'missing'), parent: root, name: 'gone', recursive: false },
        () => undefined
      )
    ).rejects.toThrow()
    expect(existsSync(join(root, 'gone'))).toBe(false)
  })

  it('cancels a clone and deletes what it downloaded', async () => {
    const clone = cloneRepository(
      5,
      { url: origin, parent: root, name: 'cancelled', recursive: false },
      () => undefined
    )
    cancelClone(5)
    await expect(clone).rejects.toThrow(/Cancelled/)
    expect(existsSync(join(root, 'cancelled'))).toBe(false)
  })
})

describe('initRepository', () => {
  it('creates an empty repository on the chosen branch', async () => {
    const outcome = await initRepository({
      parent: root,
      name: 'empty',
      defaultBranch: 'trunk',
      gitignore: null,
      license: null,
      readme: false
    })
    expect(outcome).toEqual({ path: join(root, 'empty'), committed: false })
    expect(git(outcome.path, 'symbolic-ref', '--short', 'HEAD')).toBe('trunk')
  })

  it('commits the starter files', async () => {
    const env = { ...process.env }
    process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Ada'
    process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'ada@example.com'
    try {
      const outcome = await initRepository({
        parent: root,
        name: 'starter',
        defaultBranch: 'main',
        gitignore: 'node',
        license: 'mit',
        readme: true
      })
      expect(outcome.committed).toBe(true)
      expect(git(outcome.path, 'ls-files').split('\n').sort()).toEqual([
        '.gitignore',
        'LICENSE',
        'README.md'
      ])
      expect(readFileSync(join(outcome.path, '.gitignore'), 'utf8')).toContain('node_modules/')
      expect(readFileSync(join(outcome.path, 'LICENSE'), 'utf8')).toContain(
        `Copyright (c) ${new Date().getFullYear()}`
      )
      expect(readFileSync(join(outcome.path, 'README.md'), 'utf8')).toBe('# starter\n')
    } finally {
      process.env = env
    }
  })

  it('rejects unknown templates and bad branch names without creating anything', async () => {
    const base = { parent: root, license: null, readme: false }
    await expect(
      initRepository({ ...base, name: 'x', defaultBranch: 'main', gitignore: 'cobol' })
    ).rejects.toThrow(/Unknown/)
    await expect(
      initRepository({ ...base, name: 'y', defaultBranch: 'a..b', gitignore: null })
    ).rejects.toThrow(/Invalid branch/)
    expect(existsSync(join(root, 'x'))).toBe(false)
    expect(existsSync(join(root, 'y'))).toBe(false)
  })
})
