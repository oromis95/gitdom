import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classify, classifyLinked, linkedGitDir } from './watcher'

vi.setConfig({ testTimeout: 30000 })

describe('classify', () => {
  it('tells working tree edits, index changes and git changes apart', () => {
    expect(classify('src\\a.ts')).toBe('worktree')
    expect(classify('.git\\index')).toBe('worktree')
    expect(classify('.git\\refs\\heads\\main')).toBe('git')
    expect(classify('.git\\objects\\ab\\cdef')).toBeNull()
    // Another worktree staging a file doesn't change this one
    expect(classify('.git\\worktrees\\fix\\index')).toBeNull()
    expect(classify('.git\\worktrees\\fix\\HEAD')).toBe('git')
  })
})

describe('linked worktrees', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("finds the repository's git dir, and keeps only this worktree's own files", () => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gitdom-watch-')))
    const repo = join(root, 'repo')
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    git('init', '-q', '-b', 'main', repo)
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git('-C', repo, 'add', '.')
    git('-C', repo, '-c', 'user.name=T', '-c', 'user.email=t@t.it', 'commit', '-q', '-m', 'one')
    git('-C', repo, 'worktree', 'add', '-q', '-b', 'fix', join(root, 'fix'))

    expect(linkedGitDir(repo)).toBeNull()
    const linked = linkedGitDir(join(root, 'fix'))!
    expect(realpathSync.native(linked.common)).toBe(realpathSync.native(join(repo, '.git')))
    expect(linked.own).toBe('worktrees/fix')

    expect(classifyLinked(linked.own, 'worktrees\\fix\\HEAD')).toBe('git')
    expect(classifyLinked(linked.own, 'worktrees\\fix\\index')).toBe('worktree')
    expect(classifyLinked(linked.own, 'worktrees\\other\\HEAD')).toBeNull()
    expect(classifyLinked(linked.own, 'refs\\heads\\fix')).toBe('git')
    expect(classifyLinked(linked.own, 'objects\\ab\\cdef')).toBeNull()
  })
})
