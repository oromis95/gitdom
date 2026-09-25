import { describe, expect, it } from 'vitest'
import { extensionOf, folderOf, ignorePattern } from './ignore'

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
