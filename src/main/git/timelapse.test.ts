import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Timelapse } from '../../shared/types'
import { runOp } from './operations'
import { buildFrames } from './timelapse'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

/** Each version's lines as "text@version that added it", and the removed lines as "-text@index". */
function describeFrames(t: Pick<Timelapse, 'text' | 'born' | 'frames' | 'ghosts'>): string[][] {
  return t.frames.map((frame, f) => {
    const rows = [...frame].map((id) => `${t.text[id]}@${t.born[id]}`)
    // Removed lines go in at their place, the last first so the indexes stay right
    for (const g of [...t.ghosts[f]].reverse())
      rows.splice(g.at, 0, ...g.lines.map((id) => `-${t.text[id]}`))
    return rows
  })
}

describe('buildFrames', () => {
  it('keeps each line from version to version until it changes', () => {
    const t = buildFrames([
      { parents: [], lines: ['a', 'b', 'c'] },
      { parents: [0], lines: ['a', 'B', 'c', 'd'] },
      { parents: [1], lines: ['B', 'c', 'd'] }
    ])
    expect(describeFrames(t)).toEqual([
      ['a@0', 'b@0', 'c@0'],
      ['a@0', '-b', 'B@1', 'c@0', 'd@1'],
      ['-a', 'B@1', 'c@0', 'd@1']
    ])
    // The same text added again is a new line
    expect(t.text).toEqual(['a', 'b', 'c', 'B', 'd'])
  })

  it('takes the lines of a merge from both parents', () => {
    const t = buildFrames([
      { parents: [], lines: ['a', 'b'] },
      { parents: [0], lines: ['main', 'a', 'b'] },
      { parents: [0], lines: ['a', 'b', 'branch'] },
      { parents: [1, 2], lines: ['main', 'a', 'b', 'branch', 'fix'] }
    ])
    expect(describeFrames(t)[3]).toEqual(['main@1', 'a@0', 'b@0', 'branch@2', 'fix@3'])
  })

  it('removes every line when a version deletes the file, and adds them back as new', () => {
    const t = buildFrames([
      { parents: [], lines: ['a'] },
      { parents: [0], lines: null },
      { parents: [1], lines: ['a'] }
    ])
    expect(describeFrames(t)).toEqual([['a@0'], ['-a'], ['a@2']])
  })
})

describe('timelapse operation', () => {
  let repo: string
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', input: '' }).trim()
  const commit = (content: string, message: string, file = 'f.txt'): void => {
    writeFileSync(join(repo, file), content)
    git('add', file)
    git('commit', '-q', '-m', message)
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitdom-timelapse-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@t.it')
    git('config', 'user.name', 'T')
    git('config', 'core.autocrlf', 'false')
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('reads every version of a file on the branch, with merges and uncommitted changes', async () => {
    commit('one\ntwo\n', 'create')
    commit('x\n', 'other file', 'g.txt')
    git('checkout', '-q', '-b', 'side')
    commit('one\ntwo\nside\n', 'on side')
    git('checkout', '-q', 'main')
    commit('zero\none\ntwo\n', 'on main')
    git('merge', '-q', '--no-edit', 'side')
    writeFileSync(join(repo, 'f.txt'), 'zero\none\nTWO\nside\n')

    const t = await runOp(repo, 'timelapse', ['f.txt'])
    expect(t.revisions.map((r) => r.subject)).toEqual([
      'create',
      'on side',
      'on main',
      "Merge branch 'side'",
      'Uncommitted changes'
    ])
    expect(t.revisions[4].hash).toBe('')
    expect(describeFrames(t)[4]).toEqual(['zero@2', 'one@0', '-two', 'TWO@4', 'side@1'])
    expect(t.truncated).toBe(false)

    git('tag', 'v1', 'HEAD~1')
    expect((await runOp(repo, 'timelapse', ['f.txt'])).tags).toEqual([
      { name: 'v1', hash: t.revisions[2].hash }
    ])
  })

  it('refuses binary files', async () => {
    commit('a\0b', 'binary')
    await expect(runOp(repo, 'timelapse', ['f.txt'])).rejects.toThrow(/binary/)
  })
})
