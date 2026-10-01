import { describe, expect, it } from 'vitest'
import { formatNotes, groupCommits, type ReleaseCommit } from './releaseNotes'

const commit = (subject: string, body = '', author = 'Ada'): ReleaseCommit => ({
  hash: subject.length.toString(16).padStart(8, '0') + 'f'.repeat(32),
  subject,
  body,
  author
})

describe('release notes', () => {
  it('groups commits by their conventional type, breaking changes first', () => {
    const groups = groupCommits([
      commit('feat(graph): drag commits to reorder them'),
      commit('fix: crash on empty repositories'),
      commit('docs: explain the tips'),
      commit('feat!: drop the old settings file'),
      commit('refactor: split operations'),
      commit('fixup! fix: crash on empty repositories'),
      commit('chore(deps): bump electron'),
      commit('perf: faster status', 'BREAKING CHANGE: needs git 2.38')
    ])
    expect(groups.map((g) => [g.title, g.items.map((i) => [i.scope, i.text])])).toEqual([
      [
        'Breaking changes',
        [
          [undefined, 'Drop the old settings file'],
          [undefined, 'Faster status']
        ]
      ],
      ['Features', [['graph', 'Drag commits to reorder them']]],
      ['Fixes', [[undefined, 'Crash on empty repositories']]],
      ['Refactoring', [[undefined, 'Split operations']]],
      ['Documentation', [[undefined, 'Explain the tips']]],
      ['Chores', [['deps', 'Bump electron']]]
    ])
  })

  it('guesses the group from the first word when there is no type', () => {
    const groups = groupCommits([
      commit('Add a dark theme'),
      commit('Fixed the window size on restore'),
      commit('Rename the store'),
      commit('Revert "Add a dark theme"'),
      commit('Window title shows the branch'),
      commit('Update: the logo')
    ])
    expect(groups.map((g) => [g.title, g.items.map((i) => i.text)])).toEqual([
      ['Features', ['Add a dark theme']],
      ['Fixes', ['Fixed the window size on restore']],
      ['Refactoring', ['Rename the store']],
      ['Reverts', ['Revert "Add a dark theme"']],
      ['Other changes', ['Window title shows the branch', 'Update: the logo']]
    ])
  })

  it('writes Markdown, with hashes and authors when asked', () => {
    const groups = groupCommits([
      commit('feat(ui): tips', '', 'Ada'),
      commit('fix: typo', '', 'Bob')
    ])
    expect(formatNotes('v1.2.0 — 2026-10-01', groups, { hashes: false, authors: false })).toBe(
      '## v1.2.0 — 2026-10-01\n\n### Features\n\n- **ui:** Tips\n\n### Fixes\n\n- Typo\n'
    )
    const full = formatNotes('v1.2.0', groups, { hashes: true, authors: true })
    expect(full).toContain(`- **ui:** Tips (${groups[0].items[0].hash.slice(0, 7)}, Ada)`)
    expect(formatNotes('v1.2.0', [], { hashes: true, authors: true })).toBe(
      '## v1.2.0\n\nNo changes.\n'
    )
  })
})
