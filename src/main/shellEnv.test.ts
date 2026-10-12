import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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

  // Like dash, Debian's /bin/sh, when an option isn't for it
  it.runIf(process.platform !== 'win32')('falls back for shells that refuse -i', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitdom-shell-'))
    try {
      const shell = join(dir, 'picky-sh')
      writeFileSync(
        shell,
        '#!/bin/sh\ncase "$1" in -i*) echo "Illegal option $1" >&2; exit 2;; esac\nexec /bin/sh "$@"\n'
      )
      chmodSync(shell, 0o755)
      expect(await loginShellPath(shell)).toContain('/bin')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('gives up on a shell that is missing', async () => {
    await expect(loginShellPath('/no/such/shell')).resolves.toBeNull()
  })
})
