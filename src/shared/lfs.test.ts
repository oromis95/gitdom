import { describe, expect, it } from 'vitest'
import { lfsMatcher } from './lfs'

describe('lfsMatcher', () => {
  it('matches names at any depth without a slash', () => {
    const lfs = lfsMatcher(['*.psd', 'model?.bin'])
    expect(lfs('a.psd')).toBe(true)
    expect(lfs('art/deep/b.psd')).toBe(true)
    expect(lfs('a.psd.txt')).toBe(false)
    expect(lfs('data/model1.bin')).toBe(true)
    expect(lfs('data/model12.bin')).toBe(false)
  })

  it('anchors patterns with a slash to the root', () => {
    const lfs = lfsMatcher([
      'assets/*.png',
      '/big.zip',
      'media/**/*.mp4',
      'raw/**',
      '**/cache/*.db'
    ])
    expect(lfs('assets/a.png')).toBe(true)
    expect(lfs('assets/sub/a.png')).toBe(false)
    expect(lfs('x/assets/a.png')).toBe(false)
    expect(lfs('big.zip')).toBe(true)
    expect(lfs('x/big.zip')).toBe(false)
    expect(lfs('media/a.mp4')).toBe(true)
    expect(lfs('media/x/y/a.mp4')).toBe(true)
    expect(lfs('raw/any/file')).toBe(true)
    expect(lfs('cache/a.db')).toBe(true)
    expect(lfs('x/y/cache/a.db')).toBe(true)
  })

  it('handles character classes and literal dots', () => {
    const lfs = lfsMatcher(['*.[Pp][Nn][Gg]', 'file[!0-9].dat'])
    expect(lfs('A.PNG')).toBe(true)
    expect(lfs('aXpng')).toBe(false)
    expect(lfs('filea.dat')).toBe(true)
    expect(lfs('file1.dat')).toBe(false)
  })
})
