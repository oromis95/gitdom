import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { lfsOnDisk, openSnapshot, resolveRepoRoot } from './repository'

describe('git-lfs on disk', () => {
  const windows = process.platform === 'win32'
  const files =
    (...paths: string[]) =>
    (file: string) =>
      paths.includes(file)

  it.runIf(windows)('finds it next to Git for Windows or on the PATH', () => {
    const root = 'C:\\Programs\\Git'
    const path = `C:\\Windows;${root}\\cmd`
    const git = `${root}\\cmd\\git.exe`
    const lfs = `${root}\\mingw64\\bin\\git-lfs.exe`
    // git found on the PATH
    expect(lfsOnDisk('git', path, files(git, lfs))).toBe(true)
    // git set in the settings, not on the PATH
    expect(lfsOnDisk(git, 'C:\\Windows', files(lfs))).toBe(true)
    // git-lfs on the PATH by itself
    expect(lfsOnDisk('git', 'C:\\Tools', files('C:\\Tools\\git-lfs.exe'))).toBe(true)
    // Not found: git is asked
    expect(lfsOnDisk('git', path, files(git))).toBeNull()
  })
})

describe('opening a repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitdom-open-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('gives the same snapshot from the top folder and from a folder inside', async () => {
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', input: '' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'me@example.com')
    git('config', 'user.name', 'Me')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'a.txt'), 'a')
    git('add', '-A')
    git('commit', '-qm', 'First')

    const root = await resolveRepoRoot(dir)
    const top = await openSnapshot(dir)
    const inside = await openSnapshot(join(dir, 'src'))
    expect(top.path).toBe(root)
    expect(inside.path).toBe(root)
    expect(top.commits.map((c) => c.subject)).toEqual(['First'])
    expect(inside.commits).toEqual(top.commits)
    await expect(openSnapshot(join(dir, 'missing'))).rejects.toThrow()
  })
})
