import { describe, expect, it } from 'vitest'
import type { Commit, Stash } from '../../../shared/types'
import { computeLayout } from './layout'
import { buildRows } from './rows'
import { markMatches, matchesCommit, nextMatch, searchKey } from './search'
import { firstParentChain } from './highlight'
import { avatarUrl } from './avatars'

const commit = (hash: string, date: number, ...parents: string[]): Commit => ({
  hash,
  parents,
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  authorDate: date,
  subject: `Commit ${hash}`
})

const stash = (hash: string, base: string, date: number): Stash => ({
  hash,
  selector: `stash@{${hash}}`,
  message: `WIP on ${base}`,
  base,
  date
})

const keys = (rows: ReturnType<typeof buildRows>): string[] =>
  rows.map((r) => (r.kind === 'wip' ? 'WIP' : r.kind === 'commit' ? r.commit.hash : r.stash.hash))

describe('buildRows', () => {
  const commits = [commit('c', 30, 'b'), commit('b', 20, 'a'), commit('a', 10)]

  it('puts the WIP row on top and each stash where its date falls', () => {
    expect(keys(buildRows(commits, [stash('s', 'a', 25)], 2))).toEqual(['WIP', 'c', 's', 'b', 'a'])
    expect(keys(buildRows(commits, [stash('s', 'c', 40)], 0))).toEqual(['s', 'c', 'b', 'a'])
  })

  it('never places a stash below its base, and skips stashes on commits not loaded', () => {
    expect(keys(buildRows(commits, [stash('s', 'b', 5)], 0))).toEqual(['c', 's', 'b', 'a'])
    expect(keys(buildRows(commits, [stash('s', 'gone', 50)], 0))).toEqual(['c', 'b', 'a'])
  })

  it('keeps stashes on the same commit in stash order', () => {
    const rows = buildRows(commits, [stash('s0', 'b', 22), stash('s1', 'b', 21)], 0)
    expect(keys(rows)).toEqual(['c', 's0', 's1', 'b', 'a'])
  })
})

describe('search', () => {
  const c = { ...commit('abc1234def', 1), subject: 'Add the commit graph' }

  it('matches subject, author and hash prefix, ignoring case', () => {
    expect(matchesCommit(c, searchKey('  COMMIT '))).toBe(true)
    expect(matchesCommit(c, searchKey('lovelace'))).toBe(true)
    expect(matchesCommit(c, searchKey('ada@EXAMPLE'))).toBe(true)
    expect(matchesCommit(c, searchKey('abc1'))).toBe(true)
    // The hash only matches from its start
    expect(matchesCommit(c, searchKey('1234'))).toBe(false)
    expect(matchesCommit(c, searchKey(''))).toBe(false)
  })

  it('marks every occurrence, keeping the original case', () => {
    expect(markMatches('Fix fix FIX', 'fix')).toEqual([
      { text: 'Fix', mark: true },
      { text: ' ', mark: false },
      { text: 'fix', mark: true },
      { text: ' ', mark: false },
      { text: 'FIX', mark: true }
    ])
    expect(markMatches('nothing', '')).toEqual([{ text: 'nothing', mark: false }])
  })

  it('steps through the matches, wrapping around', () => {
    expect(nextMatch([2, 5, 9], -1, false)).toBe(2)
    expect(nextMatch([2, 5, 9], 5, false)).toBe(9)
    expect(nextMatch([2, 5, 9], 9, false)).toBe(2)
    expect(nextMatch([2, 5, 9], 5, true)).toBe(2)
    expect(nextMatch([2, 5, 9], 2, true)).toBe(9)
    expect(nextMatch([], 0, false)).toBe(-1)
  })
})

describe('firstParentChain', () => {
  it('follows first parents, through the rows of other branches', () => {
    //   m          row 0, lane 0
    //   | \
    //   |  x       row 1, lane 1
    //   b  |       row 2, lane 0
    //   | /
    //   a          row 3, lane 0
    const inputs = [
      { hash: 'm', parents: ['b', 'x'] },
      { hash: 'x', parents: ['a'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] }
    ]
    const layout = computeLayout(inputs)
    const index = new Map(inputs.map((c, i) => [c.hash, i]))
    const firstParents = inputs.map((c) => c.parents[0])

    const fromMerge = firstParentChain(layout, firstParents, index, 0)
    expect([...fromMerge.rows]).toEqual([0, 2, 3])
    expect([...fromMerge.segments.get(1)!]).toEqual(['full:0:0'])

    const fromSide = firstParentChain(layout, firstParents, index, 1)
    expect([...fromSide.rows]).toEqual([1, 3])
    expect(fromSide.segments.get(2)!.has('full:1:1')).toBe(true)
    expect(fromSide.segments.get(3)!.has('top:1:0')).toBe(true)
  })
})

describe('avatarUrl', () => {
  it('uses the GitHub picture for noreply addresses and Gravatar otherwise', async () => {
    expect(await avatarUrl('12345+octo@users.noreply.github.com')).toBe(
      'https://avatars.githubusercontent.com/u/12345?s=48'
    )
    expect(await avatarUrl(' Someone@Example.com ')).toBe(
      'https://www.gravatar.com/avatar/72497f475e4f76d0b28f57c73a084ece576d170874eba3ee2609d9afe4b71aab?s=48&d=404'
    )
  })
})
