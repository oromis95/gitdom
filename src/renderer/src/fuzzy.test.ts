import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyMatch } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches characters in order, case-insensitively', () => {
    expect(fuzzyMatch('pll', 'Pull')?.positions).toEqual([0, 2, 3])
    expect(fuzzyMatch('PUSH', 'push')).not.toBeNull()
    expect(fuzzyMatch('lup', 'Pull')).toBeNull()
  })

  it('ignores spaces in the query and matches everything when empty', () => {
    expect(fuzzyMatch('co ma', 'Checkout main')).not.toBeNull()
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] })
  })

  it('prefers consecutive characters to scattered ones', () => {
    expect(fuzzyMatch('main', 'Merge a into main')?.positions).toEqual([13, 14, 15, 16])
  })
})

describe('fuzzyFilter', () => {
  it('ranks word starts and substrings first', () => {
    const items = ['Stash changes', 'Checkout feature/stats', 'Pop stash', 'Push']
    expect(fuzzyFilter('stash', items, (s) => s).map((r) => r.item)).toEqual([
      'Stash changes',
      'Pop stash'
    ])
    expect(fuzzyFilter('ps', items, (s) => s)[0].item).toBe('Pop stash')
  })

  it('keeps the original order for equal scores', () => {
    expect(fuzzyFilter('', ['b', 'a'], (s) => s).map((r) => r.item)).toEqual(['b', 'a'])
  })
})
