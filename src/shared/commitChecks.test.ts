import { describe, expect, it } from 'vitest'
import {
  MOST_PER_KIND,
  addedLines,
  capWarnings,
  checkMessage,
  scanStaged,
  sizeWarning,
  type CommitWarning
} from './commitChecks'

// Assembled at run time, so that the repository itself holds nothing that looks like a secret
const GITHUB_TOKEN = 'gh' + 'p_' + 'A1b2C3d4'.repeat(5)
const AWS_KEY = 'AK' + 'IA' + 'Q3EXAMPLE7KEY9ZZ'
const PRIVATE_KEY = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'

const diffOf = (path: string, start: number, lines: string[]): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start},0 +${start},${lines.length} @@`,
    ...lines.map((l) => '+' + l)
  ].join('\n')

const ALL = { secrets: true, debugCode: true }

describe('commit checks', () => {
  it('finds the added lines with their file and line number', () => {
    const diff = [
      diffOf('src/a.ts', 3, ['one', 'two']),
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -10,2 +10 @@',
      '-old',
      '-older',
      '+new\r',
      'diff --git "a/sp\\303\\250ce.txt" "b/sp\\303\\250ce.txt"',
      '--- /dev/null',
      '+++ "b/sp\\303\\250ce.txt"',
      '@@ -0,0 +1 @@',
      '+x'
    ].join('\n')
    expect(addedLines(diff)).toEqual([
      { path: 'src/a.ts', line: 3, text: 'one' },
      { path: 'src/a.ts', line: 4, text: 'two' },
      { path: 'b.txt', line: 10, text: 'new' },
      { path: 'spèce.txt', line: 1, text: 'x' }
    ])
  })

  it('warns about secrets and debug code on added lines, and credential files', () => {
    const diff = [
      diffOf('config.ts', 1, [
        `const token = '${GITHUB_TOKEN}'`,
        `aws_key = ${AWS_KEY}`,
        'const password = "hunter2hunter2"',
        'const password = process.env.PASSWORD',
        "const label = 'password: ********'",
        "  console.log('here', x)",
        '  debugger',
        '  // TODO: handle the empty list'
      ]),
      diffOf('notes.md', 5, ['debugger', PRIVATE_KEY])
    ].join('\n')
    const warnings = scanStaged(
      diff,
      ['config.ts', 'notes.md', '.env', '.env.example', 'id_ed25519'],
      ALL
    )
    expect(warnings.map((w) => [w.kind, w.text, w.path, w.line])).toEqual([
      ['secrets', 'Looks like an environment file', '.env', undefined],
      ['secrets', 'Looks like an SSH private key', 'id_ed25519', undefined],
      ['secrets', 'Looks like a GitHub token', 'config.ts', 1],
      ['secrets', 'Looks like an AWS access key', 'config.ts', 2],
      ['secrets', 'Looks like a password or key', 'config.ts', 3],
      ['debugCode', 'Adds console.log', 'config.ts', 6],
      ['debugCode', 'Adds debugger', 'config.ts', 7],
      ['debugCode', 'Adds a TODO', 'config.ts', 8],
      // debugger only counts in scripts
      ['secrets', 'Looks like a private key', 'notes.md', 6]
    ])
    expect(
      scanStaged(diff, ['.env'], { secrets: false, debugCode: true }).map((w) => w.kind)
    ).toEqual(['debugCode', 'debugCode', 'debugCode'])
  })

  it('warns about big files and binaries outside LFS', () => {
    const kb = 1024
    expect(sizeWarning('a.png', 600 * kb, true, false)?.text).toBe(
      'Binary file of 600 KB: consider Git LFS'
    )
    expect(sizeWarning('a.png', 600 * kb, true, true)).toBeNull()
    expect(sizeWarning('a.png', 100 * kb, true, false)).toBeNull()
    expect(sizeWarning('data.csv', 600 * kb, false, false)).toBeNull()
    expect(sizeWarning('data.csv', 6 * kb * kb, false, false)?.text).toBe('Large file, 6.0 MB')
  })

  it('checks the message, and the style of the recent commits', () => {
    const texts = (summary: string, description = '', recent: string[] = []): string[] =>
      checkMessage(summary, description, recent).map((w) => w.text)
    expect(texts('Add the export dialog')).toEqual([])
    expect(texts('wip')).toEqual(['The summary says little: what does the commit change?'])
    expect(texts('Add the export dialog.')).toEqual([
      'The summary usually has no period at the end'
    ])
    expect(texts('Wait for it...')).toEqual([])
    expect(texts('Add it', 'word '.repeat(25))).toEqual([
      '1 description line is over 100 characters'
    ])
    // A long URL can't be wrapped
    expect(texts('Add it', 'See https://example.com/' + 'x'.repeat(100))).toEqual([])
    const conventional = ['feat: a', 'fix(ui): b', 'chore: c', 'docs: d', 'feat!: e', 'Merge x']
    expect(texts('Add the export dialog', '', conventional)).toEqual([
      'Recent commits start with a type, as in "feat: …" or "fix(scope): …"'
    ])
    expect(texts('feat: add the export dialog', '', conventional)).toEqual([])
    expect(texts('fixup! feat: a', '', conventional)).toEqual([])
    expect(
      texts('Add the export dialog', '', ['feat: a', 'Add b', 'Fix c', 'Move d', 'Drop e'])
    ).toEqual([])
  })

  it('sums up the warnings past the limit of each kind', () => {
    const many: CommitWarning[] = Array.from({ length: MOST_PER_KIND + 3 }, (_, i) => ({
      kind: 'debugCode',
      text: 'Adds a TODO',
      path: 'a.ts',
      line: i + 1
    }))
    const capped = capWarnings([{ kind: 'secrets', text: 's' }, ...many])
    expect(capped).toHaveLength(MOST_PER_KIND + 2)
    expect(capped[capped.length - 1]).toEqual({ kind: 'debugCode', text: '… and 3 more' })
  })
})
