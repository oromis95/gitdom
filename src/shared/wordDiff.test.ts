import { describe, expect, it } from 'vitest'
import type { DiffLine } from './types'
import { hunkWordRanges, markHtml, wordDiff } from './wordDiff'

describe('wordDiff', () => {
  it('marks the words that changed', () => {
    expect(wordDiff('const a = 1', 'const b = 1')).toEqual({ old: [[6, 7]], new: [[6, 7]] })
    expect(wordDiff('foo(x)', 'foo(x, y)')).toEqual({ old: [], new: [[5, 8]] })
  })

  it('leaves unrelated lines unmarked', () => {
    expect(wordDiff('import React', 'return total * 2')).toBeNull()
  })

  it('pairs removed and added lines of a block', () => {
    const lines: DiffLine[] = [
      { type: 'context', text: 'x' },
      { type: 'del', text: 'let a = 1' },
      { type: 'del', text: 'let b = 2' },
      { type: 'add', text: 'let a = 3' },
      { type: 'context', text: 'y' }
    ]
    const ranges = hunkWordRanges(lines)
    expect([...ranges.keys()]).toEqual([1, 3])
    expect(ranges.get(3)).toEqual([[8, 9]])
  })
})

describe('markHtml', () => {
  it('skips tags and counts entities as one character', () => {
    expect(markHtml('a &lt; <span class="n">bc</span>', [[2, 6]])).toBe(
      'a <mark class="word">&lt; </mark><span class="n"><mark class="word">bc</mark></span>'
    )
  })

  it('keeps the HTML when there is nothing to mark', () => {
    expect(markHtml('<b>x</b>', [])).toBe('<b>x</b>')
  })
})
