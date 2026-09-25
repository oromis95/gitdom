import { describe, expect, it } from 'vitest'
import {
  parseBlame,
  parseFileLog,
  parseIdentity,
  parseLfsPatterns,
  parseLog,
  parseMergeTools,
  parseNameStatus,
  parseReflog,
  parseRefs,
  parseSignature,
  parseSigning,
  parseRemotes,
  parseStatus,
  parseSubmodules
} from './parsers'

const F = '\x1f'
const R = '\x1e'

describe('parseLog', () => {
  it('parses records including root and merge commits', () => {
    const out = `aaa${F}bbb ccc${F}Ann${F}ann@x.it${F}1700000000${F}Merge x${R}\nbbb${F}${F}Bob${F}bob@x.it${F}1600000000${F}init${R}\n`
    const commits = parseLog(out)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toEqual({
      hash: 'aaa',
      parents: ['bbb', 'ccc'],
      authorName: 'Ann',
      authorEmail: 'ann@x.it',
      authorDate: 1700000000,
      subject: 'Merge x'
    })
    expect(commits[1].parents).toEqual([])
  })
})

describe('parseRefs', () => {
  it('classifies refs, peels annotated tags and skips remote HEAD', () => {
    const out = [
      `refs/heads/feature/x${F}h1${F}${F}origin/feature/x${F}ahead 2, behind 1`,
      `refs/heads/main${F}h2${F}${F}${F}`,
      `refs/remotes/origin/HEAD${F}h2${F}${F}${F}`,
      `refs/remotes/origin/main${F}h2${F}${F}${F}`,
      `refs/tags/v1${F}tagobj${F}h3${F}${F}`,
      `refs/stash${F}s1${F}${F}${F}`
    ].join('\n')
    const refs = parseRefs(out)
    expect(refs).toEqual([
      {
        fullName: 'refs/heads/feature/x',
        name: 'feature/x',
        type: 'local',
        hash: 'h1',
        upstream: 'origin/feature/x',
        ahead: 2,
        behind: 1
      },
      { fullName: 'refs/heads/main', name: 'main', type: 'local', hash: 'h2' },
      {
        fullName: 'refs/remotes/origin/main',
        name: 'origin/main',
        type: 'remote',
        hash: 'h2',
        remote: 'origin'
      },
      { fullName: 'refs/tags/v1', name: 'v1', type: 'tag', hash: 'h3' }
    ])
  })
})

describe('parseStatus', () => {
  it('splits staged and unstaged changes, handling renames and conflicts', () => {
    const out = [
      'M  staged.ts',
      ' M dirty.ts',
      'MM both.ts',
      'R  new.ts',
      'old.ts',
      '?? added.ts',
      'UU conflict.ts',
      ''
    ].join('\0')
    const { staged, unstaged } = parseStatus(out)
    expect(staged).toEqual([
      { path: 'staged.ts', status: 'M' },
      { path: 'both.ts', status: 'M' },
      { path: 'new.ts', status: 'R', oldPath: 'old.ts' }
    ])
    expect(unstaged).toEqual([
      { path: 'dirty.ts', status: 'M' },
      { path: 'both.ts', status: 'M' },
      { path: 'added.ts', status: '?' },
      { path: 'conflict.ts', status: 'U' }
    ])
  })
})

describe('parseNameStatus', () => {
  it('parses plain and rename entries', () => {
    const out = ['M', 'a.ts', 'R087', 'old.ts', 'new.ts', 'D', 'gone.ts', ''].join('\0')
    expect(parseNameStatus(out)).toEqual([
      { status: 'M', path: 'a.ts' },
      { status: 'R', oldPath: 'old.ts', path: 'new.ts' },
      { status: 'D', path: 'gone.ts' }
    ])
  })
})

describe('parseRemotes', () => {
  it('merges fetch and push urls per remote', () => {
    const out = [
      'origin\thttps://h/a.git (fetch)',
      'origin\thttps://h/a.git (push)',
      'fork\tgit@h:me/a.git (fetch)',
      'fork\tgit@h:me/push.git (push)',
      ''
    ].join('\n')
    expect(parseRemotes(out)).toEqual([
      { name: 'origin', fetchUrl: 'https://h/a.git', pushUrl: 'https://h/a.git' },
      { name: 'fork', fetchUrl: 'git@h:me/a.git', pushUrl: 'git@h:me/push.git' }
    ])
  })
})

describe('parseFileLog', () => {
  it('follows the path across renames and keeps it for merges', () => {
    const rec = (hash: string, parents: string, subject: string, files: string): string =>
      `${R}${hash}${F}${parents}${F}Ann${F}ann@x.it${F}1700000000${F}${subject}${F}\0\n${files}`
    const out =
      rec('m1', 'c3 x9', 'Merge', '') +
      rec('c3', 'c2', 'Edit', 'M\0new.txt\0') +
      rec('c2', 'c1', 'Rename', 'R095\0old.txt\0new.txt\0') +
      rec('c1', '', 'Create', 'A\0old.txt\0')
    const revisions = parseFileLog(out, 'new.txt')
    expect(revisions.map((r) => [r.hash, r.path, r.status, r.oldPath])).toEqual([
      ['m1', 'new.txt', undefined, undefined],
      ['c3', 'new.txt', 'M', undefined],
      ['c2', 'new.txt', 'R', 'old.txt'],
      ['c1', 'old.txt', 'A', undefined]
    ])
    expect(revisions[0].parents).toEqual(['c3', 'x9'])
  })
})

describe('parseBlame', () => {
  it('reads commit headers once and assigns every line', () => {
    const a = 'a'.repeat(40)
    const z = '0'.repeat(40)
    const out = [
      `${a} 1 1 2`,
      'author Ann',
      'author-mail <ann@x.it>',
      'author-time 1700000000',
      'summary First',
      `previous ${'b'.repeat(40)} old f.txt`,
      'filename f.txt',
      '\tline one\r',
      `${a} 2 2`,
      '\tline two',
      `${z} 3 3 1`,
      'author Not Committed Yet',
      'author-mail <not.committed.yet>',
      'author-time 1800000000',
      'summary Version of f.txt from f.txt',
      'filename f.txt',
      '\t\tindented',
      ''
    ].join('\n')
    const blame = parseBlame(out, 'f.txt')
    expect(blame.lines).toEqual([
      { hash: a, lineNo: 1, text: 'line one' },
      { hash: a, lineNo: 2, text: 'line two' },
      { hash: z, lineNo: 3, text: '\tindented' }
    ])
    expect(blame.commits[a]).toEqual({
      hash: a,
      authorName: 'Ann',
      authorEmail: 'ann@x.it',
      authorDate: 1700000000,
      summary: 'First',
      path: 'f.txt',
      previous: { hash: 'b'.repeat(40), path: 'old f.txt' },
      uncommitted: false
    })
    expect(blame.commits[z].uncommitted).toBe(true)
  })
})

describe('parseSubmodules', () => {
  const h = (c: string): string => c.repeat(40)
  it('joins status and .gitmodules, by path', () => {
    const status = [
      ` ${h('a')} libs/core (v1.2-3-gaaaaaaa)`,
      `-${h('b')} vendor/ui kit`,
      `+${h('c')} docs (heads/main)`,
      `U${h('0')} broken`
    ].join('\n')
    const config = [
      'submodule.core.path libs/core',
      'submodule.core.url https://example.com/core.git',
      'submodule.ui.kit.path vendor/ui kit',
      'submodule.ui.kit.url ../ui.git',
      'submodule.docs.path docs'
    ].join('\n')
    expect(parseSubmodules(status, config)).toEqual([
      {
        name: 'core',
        path: 'libs/core',
        url: 'https://example.com/core.git',
        hash: h('a'),
        state: 'clean'
      },
      {
        name: 'ui.kit',
        path: 'vendor/ui kit',
        url: '../ui.git',
        hash: h('b'),
        state: 'uninitialized'
      },
      { name: 'docs', path: 'docs', url: '', hash: h('c'), state: 'moved' },
      { name: 'broken', path: 'broken', url: '', hash: h('0'), state: 'conflict' }
    ])
  })
})

describe('parseLfsPatterns', () => {
  it('keeps the patterns with filter=lfs', () => {
    const attributes = [
      '# binaries',
      '*.psd filter=lfs diff=lfs merge=lfs -text',
      '*.txt text eol=lf',
      '',
      '  assets/**/*.bin   filter=lfs -text\r',
      '#*.zip filter=lfs'
    ].join('\n')
    expect(parseLfsPatterns(attributes)).toEqual(['*.psd', 'assets/**/*.bin'])
  })
})

describe('parseIdentity', () => {
  it('takes the most specific value of each key', () => {
    const output = [
      'global\tuser.name Global Name',
      'global\tuser.email global@x.it',
      'local\tuser.email local@x.it\r'
    ].join('\n')
    expect(parseIdentity(output)).toEqual({
      name: 'Global Name',
      email: 'local@x.it',
      scope: 'local'
    })
  })

  it('reports no identity', () => {
    expect(parseIdentity('')).toEqual({ name: null, email: null, scope: null })
  })
})

describe('parseMergeTools', () => {
  const output = [
    "'git mergetool --tool=<tool>' may be set to one of the following:",
    '\t\tvimdiff          Use Vim with a custom layout',
    '\t\tvscode           Use Visual Studio Code (requires a graphical session)',
    '',
    'The following tools are valid, but not currently available:',
    '\t\tbc4              Use Beyond Compare (requires a graphical session)',
    "\t\temerge           Use Emacs' Emerge",
    '\t\tgvimdiff2        Use gVim (requires a graphical session) with a 3 panes layout',
    "\t\tmeld             Use Meld (requires a graphical session) with optional `auto merge` (see `git help mergetool`'s `CONFIGURATION` section)",
    '',
    'Some of the tools listed above only work in a windowed',
    'environment. If run in a terminal-only session, they will fail.'
  ].join('\r\n')

  it('lists graphical tools, available ones first, with readable names', () => {
    expect(parseMergeTools(output)).toEqual([
      { name: 'vscode', label: 'Visual Studio Code', available: true },
      { name: 'bc4', label: 'Beyond Compare', available: false },
      { name: 'meld', label: 'Meld', available: false }
    ])
  })

  it('returns nothing for unexpected output', () => {
    expect(parseMergeTools('fatal: not a git repository')).toEqual([])
  })
})

describe('parseReflog', () => {
  it('splits the action from the message and reads the date', () => {
    const output = [
      ['a'.repeat(40), 'HEAD@{1758800000}', 'reset: moving to HEAD~1', 'one'].join(F),
      ['b'.repeat(40), 'HEAD@{1758790000}', 'commit (initial): one', 'one'].join(F),
      ['c'.repeat(40), 'main@{0}', 'branch: Created from HEAD', 'two'].join(F)
    ].join('\n')
    expect(parseReflog(output)).toEqual([
      {
        hash: 'a'.repeat(40),
        date: 1758800000,
        action: 'reset',
        message: 'moving to HEAD~1',
        subject: 'one'
      },
      {
        hash: 'b'.repeat(40),
        date: 1758790000,
        action: 'commit (initial)',
        message: 'one',
        subject: 'one'
      },
      {
        hash: 'c'.repeat(40),
        date: 0,
        action: 'branch',
        message: 'Created from HEAD',
        subject: 'two'
      }
    ])
  })
})

describe('parseSigning', () => {
  it('takes the last value of each key, with git booleans', () => {
    const output = [
      'gpg.format openpgp',
      'user.signingkey ',
      'commit.gpgsign false',
      'gpg.format ssh',
      'user.signingkey ~/.ssh/id_ed25519.pub',
      'commit.gpgsign Yes\r',
      'tag.gpgsign'
    ].join('\n')
    expect(parseSigning(output)).toEqual({
      format: 'ssh',
      key: '~/.ssh/id_ed25519.pub',
      commits: true,
      tags: true
    })
  })

  it('defaults to GPG without signing', () => {
    expect(parseSigning('')).toEqual({ format: 'openpgp', key: null, commits: false, tags: false })
    expect(parseSigning('gpg.format weird').format).toBe('openpgp')
  })
})

describe('parseSignature', () => {
  it('maps the verification letter', () => {
    expect(parseSignature('G', 'Ann <ann@x.it>', 'ABC')).toEqual({
      status: 'good',
      signer: 'Ann <ann@x.it>',
      key: 'ABC'
    })
    expect(parseSignature('U', '', 'SHA256:x')?.status).toBe('untrusted')
    expect(parseSignature('Y', '', '')?.status).toBe('expired')
    expect(parseSignature('E', '', '')?.status).toBe('unknown')
    expect(parseSignature('N', '', '')).toBeNull()
  })
})
