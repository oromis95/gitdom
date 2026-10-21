// The everyday flows that rewrite the repository, each driven through the interface and checked
// with git. They run in order on one repository, each starting from where the last one left it.
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanUp,
  commitFile,
  contextMenu,
  drag,
  git,
  launch,
  makeRepo,
  scratch,
  type Running
} from './helpers'

/** Waits for git to show what the interface did: some operations take a few seconds */
const eventually = <T>(read: () => T): ReturnType<typeof expect.poll<T>> =>
  expect.poll(read, { timeout: 20000 })

describe('Flows', () => {
  let dir: string
  let repo: string
  let gitdom: Running
  const subjects = (n: number): string[] => git(repo, 'log', `-${n}`, '--format=%s').split('\n')
  /** The row of a commit, by its whole message */
  const row = (subject: string): string => `.graph-row:has(.cell-message:text-is("${subject}"))`

  beforeAll(async () => {
    dir = scratch('flows')
    repo = makeRepo(dir)
    gitdom = await launch([repo])
  })

  afterEach(() => expect(gitdom.errors).toEqual([]))

  afterAll(async () => {
    await gitdom?.close()
    cleanUp(dir)
  })

  it('stages one line, then the rest of the hunk, and commits', async () => {
    const { win } = gitdom
    await win.locator('.graph-row').first().click()
    await win.locator('.file-row:has-text("README.md")').click()
    await win.locator('.diff-line.add:has-text("A changed line.")').click()
    await win.locator('.btn-stage:has-text("Stage lines (1)")').click()
    await eventually(() => git(repo, 'diff', '--cached')).toContain('+A changed line.')
    // The empty line before it is still to stage
    expect(git(repo, 'diff')).toMatch(/^\+$/m)

    await win.locator('.btn-stage:has-text("Stage hunk")').click()
    await eventually(() => git(repo, 'diff')).toBe('')
    await win.locator('.commit-box input[placeholder="Commit summary"]').fill('Change the readme')
    await win.locator('.commit-box .primary').click()
    await eventually(() => subjects(1)).toEqual(['Change the readme'])
    expect(git(repo, 'status', '--porcelain')).toBe('')
    // Back to the graph from the diff
    await win.locator('.diff-view .diff-close').click()
    await win.waitForSelector('.graph-row:has-text("Change the readme")')
  })

  it('stashes the changes to one file and leaves the others', async () => {
    const { win } = gitdom
    writeFileSync(join(repo, 'app.js'), 'console.info("stashed")\n')
    writeFileSync(join(repo, 'README.md'), '# Demo, kept\n')
    await win.waitForSelector('.graph-row .wip-message')
    await win.locator('.graph-row').first().click()
    await contextMenu(win, '.file-row:has-text("app.js")', 'Stash changes to this file')
    await win.locator('.modal button[type=submit]').click()
    await win.waitForSelector('.toast:has-text("Stashed app.js")')
    expect(git(repo, 'stash', 'show', '--name-only', 'stash@{0}')).toBe('app.js')
    expect(git(repo, 'status', '--porcelain')).toBe('M README.md')
    git(repo, 'checkout', '--', 'README.md')
    git(repo, 'stash', 'drop', '-q')
  })

  it('cherry-picks a commit of another branch', async () => {
    const { win } = gitdom
    git(repo, 'checkout', '-q', '-b', 'other')
    commitFile(repo, 'other.txt', 'from the other branch\n', 'Other change')
    git(repo, 'checkout', '-q', 'main')
    await contextMenu(win, row('Other change'), 'Cherry-pick commit')
    await eventually(() => subjects(1)).toEqual(['Other change'])
    expect(git(repo, 'branch', '--show-current')).toBe('main')
  })

  it('melds a commit into the one before it with an interactive rebase', async () => {
    const { win } = gitdom
    commitFile(repo, 'third.txt', 'third\n', 'Third')
    commitFile(repo, 'fourth.txt', 'fourth\n', 'Fourth')
    await win.waitForSelector(row('Fourth'))
    await contextMenu(win, row('Change the readme'), 'Interactive rebase main from here')
    await win.locator('.rebase-row:has-text("Fourth") select').selectOption('fixup')
    await win.locator('.rebase-editor button:has-text("Start rebase")').click()
    // Halfway through, HEAD is already a "Third" with only third.txt: wait for the fixup
    await eventually(() =>
      git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()
    ).toEqual(['fourth.txt', 'third.txt'])
    expect(subjects(2)).toEqual(['Third', 'Other change'])
    // The graph follows once the rebase is over
    await win.locator(row('Fourth')).waitFor({ state: 'detached' })
    await win.locator('.wip-message').waitFor({ state: 'detached' })
  })

  it('reorders commits by dragging one in the graph', async () => {
    const { win } = gitdom
    // Onto the lower half of the Other change on main (above the one on the other branch): after
    // it, so older
    await drag(win, row('Third'), row('Other change'), 30)
    await expect(win.locator('.modal').innerText()).resolves.toContain(
      '"Third" moves below "Other change"'
    )
    await win.locator('.modal button:has-text("Reorder")').click()
    await eventually(() => subjects(2)).toEqual(['Other change', 'Third'])
  })

  it('resolves a conflict in the merge tool, and commits the merge', async () => {
    const { win } = gitdom
    git(repo, 'checkout', '-q', '-b', 'clash', 'HEAD~1')
    commitFile(repo, 'README.md', '# Demo from clash\n', 'Clash readme')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'README.md', '# Demo from main\n', 'Main readme')
    expect(() => git(repo, 'merge', 'clash')).toThrow()
    await win.waitForSelector('.graph-row .wip-message')
    await win.locator('.graph-row').first().click()
    // Once the panel knows the file is in conflict, it opens in the merge tool
    await win.waitForSelector('text=Conflicted Files (1)')
    await win.locator('.file-row:has-text("README.md")').click()
    await win.locator('.merge-toolbar button:has-text("Take all incoming")').click()
    await win.locator('.merge-toolbar button:has-text("Save and mark resolved")').click()
    await eventually(() => git(repo, 'diff', '--name-only', '--diff-filter=U')).toBe('')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('# Demo from clash\n')

    await win.locator('.commit-box input[placeholder="Commit summary"]').fill('Merge clash')
    await win.locator('.commit-box .primary').click()
    await eventually(() => subjects(1)).toEqual(['Merge clash'])
    expect(git(repo, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2)
    await win.locator('.diff-view .diff-close').click()
  })

  it('merges a branch dragged onto the current one', async () => {
    const { win } = gitdom
    git(repo, 'checkout', '-q', '-b', 'topic')
    commitFile(repo, 'topic.txt', 'topic\n', 'Topic work')
    git(repo, 'checkout', '-q', 'main')
    // The label first shows on main's commit, until the graph has the new one
    const topic = `${row('Topic work')} .ref-pill:has-text("topic")`
    await win.locator(topic).waitFor()
    await drag(win, topic, '.ref-pill:has-text("main")')
    await win.locator('.menu-item:has-text("Merge topic into main")').click()
    await win.locator('.modal button[type=submit]').click()
    await eventually(() => git(repo, 'branch', '--merged', 'main')).toContain('topic')
    expect(git(repo, 'branch', '--show-current')).toBe('main')
  })
})
