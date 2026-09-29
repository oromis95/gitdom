import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NumstatParser,
  StatsCollector,
  languageOf,
  languagesOf,
  parseTree,
  repoStatistics,
  zoneOffset
} from './statistics'

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const DAY = 86400
// Tuesday 2026-09-29 10:30 UTC
const NOW = Date.UTC(2026, 8, 29, 10, 30) / 1000

const header = (
  name: string,
  time: number,
  date = '2026-09-29 10:30:00 +0000',
  parents = 'p'
): string => `\x1e${name}\x1f${name.toLowerCase()}@x.it\x1f${time}\x1f${date}\x1f${parents}\0`

describe('reading git log --numstat', () => {
  it('sums up commits, authors, days, hours and months in the author time zone', () => {
    const collector = new StatsCollector()
    const parser = new NumstatParser(collector)
    const output =
      header('Ann', NOW, '2026-09-29 12:30:00 +0200') +
      '\n3\t1\tsrc/a.ts\0-\t-\tlogo.png\0' +
      header('Bob', NOW - DAY, '2026-09-28 05:30:00 -0500', 'p q') +
      header('Ann', NOW - 40 * DAY) +
      '\n10\t0\tsrc/a.ts\0'
    // In uneven chunks, splitting tokens and characters
    for (let i = 0; i < output.length; i += 7) parser.push(output.slice(i, i + 7))
    parser.end()
    const stats = collector.result(new Map([['src/a.ts', 100]]))

    expect(stats).toMatchObject({ commits: 3, merges: 1, added: 13, deleted: 1, authorCount: 2 })
    expect([stats.first, stats.last]).toEqual([NOW - 40 * DAY, NOW])
    expect(stats.authors.map((a) => [a.name, a.commits, a.added, a.deleted])).toEqual([
      ['Ann', 2, 13, 1],
      ['Bob', 1, 0, 0]
    ])
    // Ann committed at 12:30 her time, Bob on Monday at 05:30 his
    expect(stats.punchcard[2][12]).toBe(1)
    expect(stats.punchcard[1][5]).toBe(1)
    expect(stats.days['2026-09-29']).toBe(1)
    expect(stats.days['2026-09-28']).toBe(1)
    expect(stats.months.map((m) => [m.month, m.commits, m.added])).toEqual([
      ['2026-08', 1, 10],
      ['2026-09', 2, 3]
    ])
  })

  it('follows renames, and keeps only the files of the current version', () => {
    const collector = new StatsCollector()
    const parser = new NumstatParser(collector)
    parser.push(
      header('Ann', NOW) +
        '\n1\t1\t\0old/name.ts\0new/name.ts\0' +
        header('Bob', NOW - 200 * DAY) +
        '\n5\t0\told/name.ts\0' +
        header('Bob', NOW - 300 * DAY) +
        '\n2\t0\told/name.ts\0' +
        '1\t0\tgone.ts\0'
    )
    parser.end()
    const stats = collector.result(new Map([['new/name.ts', 10]]))
    expect(stats.hotspots).toHaveLength(1)
    expect(stats.hotspots[0]).toMatchObject({
      path: 'new/name.ts',
      changes: 3,
      authors: 2,
      last: NOW,
      owner: 'Bob'
    })
    expect(stats.hotspots[0].ownerShare).toBeCloseTo(2 / 3)
    // A new change counts 1, one 90 days older half
    expect(stats.hotspots[0].heat).toBeCloseTo(1 + 0.5 ** (200 / 90) + 0.5 ** (300 / 90), 1)
    expect([stats.trackedFiles, stats.changedFiles]).toEqual([1, 1])
    expect(stats.soloFiles).toEqual([])
  })

  it('ranks hot files, lists files known to one author and finds the bus factor', () => {
    const collector = new StatsCollector()
    const parser = new NumstatParser(collector)
    let output = ''
    // Ann owns a, b and c; Bob owns d; e was changed long ago
    for (const [name, age, files] of [
      ['Ann', 0, ['a', 'b', 'package-lock.json']],
      ['Ann', 1, ['a', 'c']],
      ['Bob', 2, ['d', 'a']],
      ['Bob', 3, ['d']],
      ['Cy', 900, ['e', 'e2']],
      ['Cy', 901, ['e']]
    ] as const) {
      output += header(name, NOW - age * DAY) + files.map((f) => `\n1\t0\t${f}\0`).join('')
    }
    parser.push(output)
    parser.end()
    const tracked = new Map(['a', 'b', 'c', 'd', 'e', 'package-lock.json'].map((f) => [f, 1]))
    const stats = collector.result(tracked)
    expect(stats.hotspots.map((f) => f.path)).toEqual(['a', 'd', 'b', 'c', 'e'])
    expect(stats.soloFiles.map((f) => [f.path, f.owner])).toEqual([
      ['d', 'Bob'],
      ['e', 'Cy'],
      ['b', 'Ann'],
      ['c', 'Ann']
    ])
    // Ann alone is the main author of 3 files out of 5; the lockfile counts only as changed
    expect(stats.busFactor).toBe(1)
    expect(stats.changedFiles).toBe(6)
  })

  it('fills the quiet months, and reads time zones', () => {
    const collector = new StatsCollector()
    collector.addCommit('Ann', 'a@x.it', Date.UTC(2025, 10, 5) / 1000, 0, 1)
    collector.addCommit('Ann', 'a@x.it', Date.UTC(2026, 1, 5) / 1000, 0, 1)
    expect(collector.result(new Map()).months.map((m) => [m.month, m.commits])).toEqual([
      ['2025-11', 1],
      ['2025-12', 0],
      ['2026-01', 0],
      ['2026-02', 1]
    ])
    expect(zoneOffset('2026-09-29 10:00:00 +0530')).toBe(330)
    expect(zoneOffset('2026-09-29 10:00:00 -0800')).toBe(-480)
    expect(zoneOffset('')).toBe(0)
  })
})

describe('languages', () => {
  it('tells languages by extension or file name, skipping generated files', () => {
    expect(languageOf('src/App.tsx')).toBe('TypeScript')
    expect(languageOf('build/Dockerfile')).toBe('Dockerfile')
    expect(languageOf('CMakeLists.txt')).toBe('CMake')
    expect(languageOf('README')).toBeNull()
    expect(languageOf('.gitignore')).toBeNull()
    const tree = parseTree(
      [
        '100644 blob aaaa     120\tsrc/a.ts',
        '100644 blob bbbb      30\tsrc/b.js',
        '100644 blob cccc     500\tdist/bundle.js',
        '100644 blob dddd    9000\tpackage-lock.json',
        '160000 commit eeee       -\tsub',
        '100644 blob ffff      50\tweird name.ts'
      ].join('\0') + '\0'
    )
    expect([...tree.keys()]).toEqual([
      'src/a.ts',
      'src/b.js',
      'dist/bundle.js',
      'package-lock.json',
      'weird name.ts'
    ])
    expect(languagesOf(tree)).toEqual([
      { name: 'TypeScript', bytes: 170, files: 2 },
      { name: 'JavaScript', bytes: 30, files: 1 }
    ])
  })
})

describe('repoStatistics', () => {
  let repo: string
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', input: '' }).trim()

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitdom-stats-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@t.it')
    git('config', 'user.name', 'T')
    git('config', 'core.autocrlf', 'false')
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('reads a real history, of the current branch or of all of them', async () => {
    const empty = await repoStatistics(repo, { sinceDays: null, allBranches: false }, () => {})
    expect([empty.commits, empty.trackedFiles, empty.months]).toEqual([0, 0, []])

    writeFileSync(join(repo, 'main.ts'), 'a\nb\n')
    git('add', '.')
    git('commit', '-q', '-m', 'one')
    git('mv', 'main.ts', 'app.ts')
    git('commit', '-q', '-m', 'rename')
    git('switch', '-q', '-c', 'side')
    writeFileSync(join(repo, 'side.py'), 'x\n')
    git('add', '.')
    git('commit', '-q', '-m', 'side')
    git('switch', '-q', 'main')

    const progress: number[] = []
    const stats = await repoStatistics(repo, { sinceDays: null, allBranches: false }, (n) =>
      progress.push(n)
    )
    expect(stats).toMatchObject({ commits: 2, added: 2, trackedFiles: 1, changedFiles: 1 })
    expect(stats.hotspots.map((f) => [f.path, f.changes])).toEqual([['app.ts', 2]])
    expect(stats.languages.map((l) => l.name)).toEqual(['TypeScript'])
    expect(progress.length).toBeGreaterThan(0)

    const all = await repoStatistics(repo, { sinceDays: 30, allBranches: true }, () => {})
    expect(all.commits).toBe(3)
    await expect(
      repoStatistics(repo, { sinceDays: -1, allBranches: false }, () => {})
    ).rejects.toThrow('Invalid period')
  })
})
