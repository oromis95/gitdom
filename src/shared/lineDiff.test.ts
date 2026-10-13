import { describe, expect, it } from 'vitest'
import { matchLines } from './lineDiff'

const codes = (text: string): number[] => [...text].map((c) => c.charCodeAt(0))

/** Checks that the match is a valid alignment and returns how many lines it keeps. */
function kept(a: number[], b: number[]): number {
  const match = matchLines(a, b)
  let last = -1
  let count = 0
  match.forEach((i, j) => {
    if (i < 0) return
    expect(a[i]).toBe(b[j])
    expect(i).toBeGreaterThan(last)
    last = i
    count++
  })
  return count
}

/** Length of the longest common subsequence, the slow way. */
function lcs(a: number[], b: number[]): number {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  return t[0][0]
}

describe('matchLines', () => {
  it('matches equal versions line by line', () => {
    expect([...matchLines(codes('abc'), codes('abc'))]).toEqual([0, 1, 2])
  })

  it('marks added lines and skips removed ones', () => {
    expect([...matchLines(codes('abcd'), codes('axcd'))]).toEqual([0, -1, 2, 3])
    expect([...matchLines(codes('abc'), codes('ac'))]).toEqual([0, 2])
    expect([...matchLines(codes(''), codes('ab'))]).toEqual([-1, -1])
    expect([...matchLines(codes('ab'), codes(''))]).toEqual([])
  })

  it('keeps as many lines as the longest common subsequence', () => {
    const cases = [
      ['abcabba', 'cbabac'],
      ['xaxbxcx', 'abc'],
      ['the quick brown fox', 'a quick brown dog jumps'],
      ['aaaa', 'aa'],
      ['abcdef', 'fedcba']
    ]
    for (const [x, y] of cases) {
      const [a, b] = [codes(x), codes(y)]
      expect(kept(a, b)).toBe(lcs(a, b))
    }
  })

  it('aligns random versions optimally', () => {
    let seed = 7
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: random(30) }, () => random(5))
      const b = a.filter(() => random(4) > 0)
      for (let i = random(6); i > 0; i--) b.splice(random(b.length + 1), 0, random(5))
      expect(kept(a, b)).toBe(lcs(a, b))
    }
  })

  it('handles big files with few changes quickly', () => {
    const a = Array.from({ length: 50000 }, (_, i) => i)
    const b = [...a]
    b.splice(25000, 10, -1, -2)
    b.splice(100, 0, -3)
    const started = Date.now()
    expect(kept(a, b)).toBe(a.length - 10)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
