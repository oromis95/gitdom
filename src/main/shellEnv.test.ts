import { describe, expect, it } from 'vitest'
import { loginShellPath, mergePaths } from './shellEnv'

describe('shell environment', () => {
  it('puts the shell folders first, each once', () => {
    expect(mergePaths('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin')).toBe(
      '/opt/homebrew/bin:/usr/bin:/bin'
    )
    expect(mergePaths('/usr/local/bin', undefined)).toBe('/usr/local/bin')
  })

  it.runIf(process.platform !== 'win32')('reads the PATH of the login shell', async () => {
    const path = await loginShellPath('/bin/sh')
    expect(path).toContain('/bin')
  })

  it('gives up on a shell that is missing', async () => {
    await expect(loginShellPath('/no/such/shell')).resolves.toBeNull()
  })
})
