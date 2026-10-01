import { describe, expect, it } from 'vitest'
import { extensionOf, folderOf, ignorePattern, isNegation, parseCheckIgnore } from './ignore'

describe('ignorePattern', () => {
  it('anchors a file to the root', () => {
    expect(ignorePattern('build/out.log', 'file')).toBe('/build/out.log')
    expect(ignorePattern('#notes.txt', 'file')).toBe('/#notes.txt')
  })

  it('escapes wildcards and a trailing space', () => {
    expect(ignorePattern('a[1]*?.txt', 'file')).toBe('/a\\[1]\\*\\?.txt')
    expect(ignorePattern('back\\slash', 'file')).toBe('/back\\\\slash')
    expect(ignorePattern('dir/name ', 'file')).toBe('/dir/name\\ ')
  })

  it('matches every file with the extension, anywhere', () => {
    expect(ignorePattern('src/app.min.js', 'extension')).toBe('*.js')
    expect(() => ignorePattern('Makefile', 'extension')).toThrow('no extension')
  })

  it('matches the folder of the file', () => {
    expect(ignorePattern('logs/2026/a.log', 'folder')).toBe('/logs/2026/')
    expect(() => ignorePattern('a.log', 'folder')).toThrow('not in a folder')
  })
})

describe('extensionOf and folderOf', () => {
  it('skip dotfiles and root files', () => {
    expect(extensionOf('config/.env')).toBeNull()
    expect(extensionOf('a/b.tar.gz')).toBe('gz')
    expect(extensionOf('trailing.')).toBeNull()
    expect(folderOf('a.txt')).toBeNull()
    expect(folderOf('a/b/c.txt')).toBe('a/b')
  })
})

describe('parseCheckIgnore', () => {
  it('reads the rule of each path, leaving out the paths no rule matches', () => {
    const output = [
      ['.gitignore', '3', '*.log', 'build/out.log'],
      ['', '', '', 'src/app.ts'],
      ['sub/.gitignore', '1', '!keep.log', 'sub/keep.log']
    ]
      .map((f) => f.join('\0') + '\0')
      .join('')
    const rules = parseCheckIgnore(output)
    expect(rules).toEqual([
      { path: 'build/out.log', source: '.gitignore', line: 3, pattern: '*.log' },
      { path: 'sub/keep.log', source: 'sub/.gitignore', line: 1, pattern: '!keep.log' }
    ])
    expect(rules.map(isNegation)).toEqual([false, true])
  })
})
