import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPatch, parseDiff } from './diff'

let repo: string
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', input: '' })
const apply = (patch: string, ...flags: string[]): string =>
  execFileSync('git', ['apply', '--recount', ...flags, '-'], {
    cwd: repo,
    input: patch,
    encoding: 'utf8'
  })

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gitdom-diff-'))
  git('init', '-q')
  git('config', 'user.email', 't@t.it')
  git('config', 'user.name', 'T')
  git('config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'f.txt'), 'a\nb\nc\nd\ne\n')
  git('add', '.')
  git('commit', '-qm', 'init')
})

afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('parseDiff', () => {
  it('parses hunks with line numbers', () => {
    writeFileSync(join(repo, 'f.txt'), 'a\nB\nc\nd\ne\nf\n')
    const diff = parseDiff(git('diff', '--', 'f.txt'), 'f.txt')
    expect(diff.binary).toBe(false)
    expect(diff.hunks).toHaveLength(1)
    const types = diff.hunks[0].lines.map((l) => l.type[0]).join('')
    expect(types).toBe('cdaccca')
    expect(diff.hunks[0].lines[2]).toMatchObject({ type: 'add', text: 'B', newNo: 2 })
  })

  it('records the missing newline marker', () => {
    writeFileSync(join(repo, 'f.txt'), 'a\nb\nc\nd\ne')
    const diff = parseDiff(git('diff', '--', 'f.txt'), 'f.txt')
    const lines = diff.hunks[0].lines
    expect(lines[lines.length - 1]).toMatchObject({ type: 'add', text: 'e', noNewline: true })
  })
})

describe('buildPatch', () => {
  it('stages only the selected lines', () => {
    // b→B and a new line f: stage only the b→B change
    writeFileSync(join(repo, 'f.txt'), 'a\nB\nc\nd\ne\nf\n')
    const diff = parseDiff(git('diff', '--', 'f.txt'), 'f.txt')
    const hunk = diff.hunks[0]
    const selected = new Set(
      hunk.lines.flatMap((l, i) => (l.text.toLowerCase() === 'b' ? [i] : []))
    )

    apply(buildPatch(diff, [{ hunk, lines: selected }], false)!, '--cached')

    expect(git('show', ':f.txt')).toBe('a\nB\nc\nd\ne\n')
  })

  it('unstages only the selected lines with a reverse patch', () => {
    writeFileSync(join(repo, 'f.txt'), 'a\nB\nc\nd\ne\nf\n')
    git('add', 'f.txt')
    const diff = parseDiff(git('diff', '--cached', '--', 'f.txt'), 'f.txt')
    const hunk = diff.hunks[0]
    const addedF = new Set(hunk.lines.flatMap((l, i) => (l.text === 'f' ? [i] : [])))

    apply(buildPatch(diff, [{ hunk, lines: addedF }], true)!, '--cached', '--reverse')

    expect(git('show', ':f.txt')).toBe('a\nB\nc\nd\ne\n')
  })

  it('discards selected lines from the working tree', () => {
    writeFileSync(join(repo, 'f.txt'), 'a\nB\nc\nd\ne\nf\n')
    const diff = parseDiff(git('diff', '--', 'f.txt'), 'f.txt')
    const hunk = diff.hunks[0]
    const addedF = new Set(hunk.lines.flatMap((l, i) => (l.text === 'f' ? [i] : [])))

    apply(buildPatch(diff, [{ hunk, lines: addedF }], true)!, '--reverse')

    expect(git('diff', '--', 'f.txt')).toContain('+B')
    expect(git('diff', '--', 'f.txt')).not.toContain('+f')
  })

  it('returns null when no changed line is selected', () => {
    writeFileSync(join(repo, 'f.txt'), 'a\nB\nc\nd\ne\n')
    const diff = parseDiff(git('diff', '--', 'f.txt'), 'f.txt')
    expect(buildPatch(diff, [{ hunk: diff.hunks[0], lines: new Set([0]) }], false)).toBeNull()
  })
})
