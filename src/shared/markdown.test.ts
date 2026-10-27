import { describe, expect, it } from 'vitest'
import { parseBlocks, parseSpans } from './markdown'

describe('parseSpans', () => {
  it('reads code, links, emphasis and bare addresses', () => {
    expect(
      parseSpans(
        'Fix `a|b` in [the docs](https://x.dev/a "t"), **really** _now_ ~~old~~ see https://x.dev/b.'
      )
    ).toEqual([
      { text: 'Fix ' },
      { text: 'a|b', code: true },
      { text: ' in ' },
      { text: 'the docs', href: 'https://x.dev/a' },
      { text: ', ' },
      { text: 'really', bold: true },
      { text: ' ' },
      { text: 'now', italic: true },
      { text: ' ' },
      { text: 'old', strike: true },
      { text: ' see ' },
      { text: 'https://x.dev/b', href: 'https://x.dev/b' },
      { text: '.' }
    ])
  })

  it('never links anything but web addresses, and drops HTML', () => {
    expect(parseSpans('[run](javascript:alert(1)) <b onclick="x">bold</b> a&amp;b')).toEqual([
      { text: 'run', href: undefined },
      { text: ') bold a&b' }
    ])
    expect(parseSpans('![screenshot](https://x.dev/s.png)')).toEqual([
      { text: 'screenshot', href: 'https://x.dev/s.png', image: true }
    ])
    // Underscores inside words are not emphasis
    expect(parseSpans('snake_case_name')).toEqual([{ text: 'snake_case_name' }])
  })
})

describe('parseBlocks', () => {
  it('reads the usual shape of a pull request description', () => {
    const blocks = parseBlocks(
      [
        '<!-- template: remove this -->',
        '## Summary',
        'Adds widgets',
        'to the shop.',
        '',
        '- [x] Tests',
        '- [ ] Docs',
        '  - nested',
        '1. first',
        '',
        '```ts',
        'const a = 1 // <b>',
        '```',
        '> **Note**',
        '> quoted',
        '',
        '| Package | Change |',
        '|---|:---:|',
        '| a | `1` → `2` |',
        '',
        '---',
        '<details><summary>More</summary>',
        '</details>'
      ].join('\n')
    )
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'item',
      'item',
      'item',
      'item',
      'code',
      'quote',
      'table',
      'rule',
      'paragraph'
    ])
    expect(blocks[1]).toEqual({ kind: 'paragraph', text: [{ text: 'Adds widgets to the shop.' }] })
    expect(blocks[2]).toMatchObject({ checked: true, depth: 0, ordered: null })
    expect(blocks[3]).toMatchObject({ checked: false })
    expect(blocks[4]).toMatchObject({ depth: 1, checked: null })
    expect(blocks[5]).toMatchObject({ ordered: 1 })
    expect(blocks[6]).toEqual({ kind: 'code', lang: 'ts', text: 'const a = 1 // <b>' })
    expect(blocks[7]).toMatchObject({ kind: 'quote', blocks: [{ kind: 'paragraph' }] })
    expect(blocks[8]).toMatchObject({
      kind: 'table',
      header: [[{ text: 'Package' }], [{ text: 'Change' }]],
      rows: [
        [[{ text: 'a' }], [{ text: '1', code: true }, { text: ' → ' }, { text: '2', code: true }]]
      ]
    })
    expect(blocks[10]).toEqual({ kind: 'paragraph', text: [{ text: 'More' }] })
  })

  it('keeps an unclosed code block to the end', () => {
    expect(parseBlocks('```\na\nb')).toEqual([{ kind: 'code', lang: '', text: 'a\nb' }])
  })
})
