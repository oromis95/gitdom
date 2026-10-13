import { writeFileSync } from 'fs'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanUp, git, launch, makeRepo, scratch, type Running } from './helpers'

describe('Time-lapse of a file', () => {
  let dir: string
  let repo: string
  let gitdom: Running
  const position = (): Promise<string> => gitdom.win.locator('.timelapse-position').innerText()

  beforeAll(async () => {
    dir = scratch('timelapse')
    repo = makeRepo(dir)
    const versions = [
      ['Once upon a time', 'there was a repository.'],
      ['Once upon a time', 'there was a repository', 'with many commits.'],
      ['Once upon a time', 'there was a big repository', 'with many commits.'],
      ['Once upon a time', 'there was a big repository', 'with many commits.', 'The ending.']
    ]
    versions.forEach((lines, i) => {
      writeFileSync(join(repo, 'story.txt'), lines.join('\n') + '\n')
      git(repo, 'add', 'story.txt')
      git(repo, 'commit', '-q', '-m', `Story ${i + 1}`)
      if (i === 1) git(repo, 'tag', 'v1')
    })
    gitdom = await launch([repo])
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    cleanUp(dir)
  })

  it('opens from the files of a commit, at the latest version', async () => {
    const { win } = gitdom
    await win.locator('.graph-row:has-text("Story 4")').click()
    await win.locator('.file-row:has-text("story.txt")').click({ button: 'right' })
    await win.locator('.menu-item:has-text("Time-lapse")').click()
    await win.waitForSelector('.timelapse')
    await expect(position()).resolves.toBe('Commit 4 of 4')
    await expect(win.locator('.tl-line:not(.ghost)').count()).resolves.toBe(4)
    await expect(win.locator('.timelapse-status').innerText()).resolves.toContain('Story 4')
  })

  it('moves through the versions with the keys, showing the removed lines', async () => {
    const { win } = gitdom
    await win.locator('.timelapse-status').click()
    await win.keyboard.press('ArrowLeft')
    await expect(position()).resolves.toBe('Commit 3 of 4')
    // "there was a repository" became "there was a big repository"
    await expect(win.locator('.tl-line.ghost').innerText()).resolves.toContain(
      'there was a repository'
    )
    await win.keyboard.press('Home')
    await expect(position()).resolves.toBe('Commit 1 of 4')
    // The detail panel follows, once the timeline stops
    await win.waitForSelector('.detail-title:text-is("Story 1")')
    await expect(win.locator('.timelapse-tags').count()).resolves.toBe(0)
    await win.keyboard.press('ArrowRight')
    await expect(win.locator('.timelapse-tags').innerText()).resolves.toContain('v1')
  })

  it('anchors a line and finds the commits that changed a text', async () => {
    const { win } = gitdom
    await win.locator('.tl-line:has-text("Once upon a time") .blame-no').click()
    await expect(win.locator('.tl-line.anchored').count()).resolves.toBe(1)
    await win.locator('.timelapse-bar input').fill('ending')
    await win.keyboard.press('Enter')
    await expect(position()).resolves.toBe('Commit 4 of 4')
    await expect(win.locator('.graph-search-count').innerText()).resolves.toBe('1 of 1')
    await expect(win.locator('.tl-line.hit-here').innerText()).resolves.toContain('The ending.')
    // The anchored line is still there, at the top
    await expect(win.locator('.tl-line.anchored').innerText()).resolves.toContain('Once upon')
  })

  it('goes to the commit of a line from its gutter', async () => {
    const { win } = gitdom
    await win.locator('.tl-line:has-text("with many commits") .blame-gutter').click()
    await expect(position()).resolves.toBe('Commit 2 of 4')
  })
})
