import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checksumFor,
  cleanUpAfterUpdate,
  downloadPathOf,
  oldPathOf,
  swapExecutable
} from './updateFiles'

const HASH = 'ab'.repeat(32)

describe('checksumFor', () => {
  it('reads the hash of a file from a sha256sum listing', () => {
    const listing = `${'cd'.repeat(32)}  Other.exe\r\n${HASH.toUpperCase()} *GitDom-1.1.0-portable.exe\n`
    expect(checksumFor(listing, 'GitDom-1.1.0-portable.exe')).toBe(HASH)
    expect(checksumFor(listing, 'Missing.exe')).toBeNull()
  })

  it('accepts a lone hash, and refuses anything else', () => {
    expect(checksumFor(`${HASH}\n`, 'GitDom.exe')).toBe(HASH)
    expect(checksumFor('not a hash', 'GitDom.exe')).toBeNull()
    expect(checksumFor(`${HASH.slice(2)}  GitDom.exe`, 'GitDom.exe')).toBeNull()
  })
})

describe('swapping the exe', () => {
  let dir: string
  let exe: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitdom-update-'))
    exe = join(dir, 'GitDom-1.0.0-portable.exe')
    writeFileSync(exe, 'old')
    writeFileSync(downloadPathOf(exe), 'new')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('puts the download in place and keeps the old exe aside until the next start', async () => {
    writeFileSync(oldPathOf(exe), 'from an earlier update')
    swapExecutable(exe, downloadPathOf(exe))
    expect(readFileSync(exe, 'utf8')).toBe('new')
    expect(readFileSync(oldPathOf(exe), 'utf8')).toBe('old')
    expect(existsSync(downloadPathOf(exe))).toBe(false)

    await cleanUpAfterUpdate(exe, 1, 0)
    expect(existsSync(oldPathOf(exe))).toBe(false)
    expect(readFileSync(exe, 'utf8')).toBe('new')
  })

  it('leaves the old exe in place when the download is missing', () => {
    rmSync(downloadPathOf(exe))
    expect(() => swapExecutable(exe, downloadPathOf(exe))).toThrow()
    expect(readFileSync(exe, 'utf8')).toBe('old')
    expect(existsSync(oldPathOf(exe))).toBe(false)
  })

  it('removes an interrupted download at startup', async () => {
    await cleanUpAfterUpdate(exe, 1, 0)
    expect(existsSync(downloadPathOf(exe))).toBe(false)
    expect(readFileSync(exe, 'utf8')).toBe('old')
  })
})
