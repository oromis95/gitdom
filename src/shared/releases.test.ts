import { describe, expect, it } from 'vitest'
import { compareVersions, parseChangelog, parseInline, parseMarkdown } from './releases'

describe('compareVersions', () => {
  it('compares each number, not the text', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBeGreaterThan(0)
    expect(compareVersions('0.5.0', '0.6.0')).toBeLessThan(0)
    expect(compareVersions('v1.2.0', '1.2')).toBe(0)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0)
  })
})

describe('parseChangelog', () => {
  it('splits the sections by version heading', () => {
    const entries = parseChangelog(
      [
        '# Changelog',
        '',
        'Intro text.',
        '',
        '## 0.6.0 — 2026-09-25',
        '',
        '### Added',
        '- Activity log',
        '',
        '## [0.5.0] - 2026-09-20',
        '- Graph search',
        ''
      ].join('\r\n')
    )
    expect(entries).toEqual([
      { version: '0.6.0', date: '2026-09-25', body: '### Added\n- Activity log' },
      { version: '0.5.0', date: '2026-09-20', body: '- Graph search' }
    ])
  })
})

describe('parseMarkdown', () => {
  it('reads headings, nested items, continuation lines and paragraphs', () => {
    const blocks = parseMarkdown(
      [
        '### Added',
        '- **Activity log**: every',
        '  git command',
        '  - nested `code`',
        '',
        'Done.'
      ].join('\n')
    )
    expect(blocks).toEqual([
      { kind: 'heading', text: [{ text: 'Added' }] },
      {
        kind: 'item',
        depth: 0,
        text: [{ text: 'Activity log', bold: true }, { text: ': every git command' }]
      },
      { kind: 'item', depth: 1, text: [{ text: 'nested ' }, { text: 'code', code: true }] },
      { kind: 'paragraph', text: [{ text: 'Done.' }] }
    ])
  })

  it('keeps the text of links', () => {
    expect(parseInline('see [the release](https://example.com) now')).toEqual([
      { text: 'see ' },
      { text: 'the release' },
      { text: ' now' }
    ])
  })
})
