import { describe, expect, it } from 'vitest'
import { posixShells } from './terminal'

describe('shells on macOS and Linux', () => {
  const listed = [
    '# /etc/shells',
    '/bin/sh',
    '/bin/bash',
    '/usr/bin/bash',
    '/bin/zsh',
    '/usr/bin/fish'
  ].join('\n')
  const all = (): boolean => true

  it('offers the login shell first, then the other common ones once each', () => {
    expect(posixShells('/bin/zsh', listed, all, 'darwin').map((s) => s.file)).toEqual([
      '/bin/zsh',
      '/bin/bash',
      '/usr/bin/fish'
    ])
  })

  it('starts zsh on macOS and bash on Linux without SHELL', () => {
    expect(posixShells(undefined, '', all, 'darwin')[0].file).toBe('/bin/zsh')
    expect(posixShells(undefined, '', all, 'linux')[0].file).toBe('/bin/bash')
  })

  it('leaves out shells that are not there', () => {
    const shells = posixShells('/bin/bash', listed, (f) => f !== '/usr/bin/fish', 'linux')
    expect(shells.map((s) => s.name)).toEqual(['bash', 'zsh'])
    expect(shells[0]).toMatchObject({ id: '/bin/bash', args: ['-l'] })
  })
})
