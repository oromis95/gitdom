// Operations on ignored and untracked files.
import { readFile, stat, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { parseCheckIgnore } from '../../../shared/ignore'
import { runGit } from '../exec'
import { type OpImpl, TRASH, assertArg, repoFile, runWithPaths, entrySize } from './shared'

/** Ignored files and folders listed with their rule */
const MOST_IGNORED = 2000
/** Untracked and ignored entries listed for a clean */
const MOST_CLEAN = 2000

/** Moves a file to the Recycle Bin: set to Electron's at startup, unset in the tests */
let trash: ((path: string) => Promise<void>) | null = null

export function setTrash(moveToTrash: (path: string) => Promise<void>): void {
  trash = moveToTrash
}

/** Untracked and ignored entries of the working tree; folders come once, with a trailing slash. */
async function untrackedEntries(repo: string): Promise<{ untracked: string[]; ignored: string[] }> {
  const fields = (
    await runGit(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignored'])
  ).split('\0')
  const untracked: string[] = []
  const ignored: string[] = []
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    if (field.startsWith('?? ')) untracked.push(field.slice(3))
    else if (field.startsWith('!! ')) ignored.push(field.slice(3))
    // A rename or copy is followed by the old path
    else if (/^[RC]|^.[RC]/.test(field)) i++
  }
  return { untracked, ignored }
}

/** Whether `path` is inside one of the folders (each ending with a slash). */
const insideFolder = (path: string, folders: string[]): boolean =>
  folders.some((folder) => path !== folder && path.startsWith(folder))

/** A folder holding a repository of its own: git clean leaves it, and so does GitDom. */
const isNestedRepo = async (repo: string, path: string): Promise<boolean> =>
  path.endsWith('/') && (await stat(resolve(repo, path, '.git')).catch(() => null)) !== null

export const cleanOps: Pick<
  OpImpl,
  'ignore' | 'ignoreRule' | 'ignoredFiles' | 'cleanPreview' | 'cleanFiles'
> = {
  async ignore(repo, pattern, untrack) {
    if (!pattern.trim() || /[\0\r\n]/.test(pattern)) throw new Error(`Invalid pattern: ${pattern}`)
    untrack.forEach((p) => repoFile(repo, p))
    const file = resolve(repo, '.gitignore')
    const current = await readFile(file, 'utf8').catch(() => '')
    if (!current.split(/\r?\n/).includes(pattern)) {
      // Follows the file's line endings, and ends its last line if it wasn't
      const eol = current.includes('\r\n') ? '\r\n' : '\n'
      const separator = current && !current.endsWith('\n') ? eol : ''
      await writeFile(file, current + separator + pattern + eol, 'utf8')
    }
    if (untrack.length) {
      await runWithPaths(repo, ['rm', '--cached', '-r', '-q', '--ignore-unmatch'], untrack)
    }
  },

  async ignoreRule(repo, path) {
    assertArg(path, 'path')
    // --no-index: the rules apply to tracked files too, which is what makes them confusing
    const [output, tracked] = await Promise.all([
      runGit(repo, ['check-ignore', '-v', '-n', '-z', '--no-index', '--stdin'], {
        input: path + '\0',
        okExitCodes: [1]
      }),
      runGit(repo, ['ls-files', '-z', '--', path])
    ])
    return { rule: parseCheckIgnore(output)[0] ?? null, tracked: tracked !== '' }
  },

  async ignoredFiles(repo) {
    // Folders ignored as a whole come once, with a trailing slash, rather than their contents
    const status = await runGit(repo, ['status', '--porcelain=v1', '-z', '--ignored'])
    const paths = status
      .split('\0')
      .filter((entry) => entry.startsWith('!! '))
      .map((entry) => entry.slice(3))
    const listed = paths.slice(0, MOST_IGNORED)
    if (!listed.length) return { rules: [], total: 0 }
    const output = await runGit(repo, ['check-ignore', '-v', '-n', '-z', '--stdin'], {
      input: listed.join('\0') + '\0',
      okExitCodes: [1]
    })
    return { rules: parseCheckIgnore(output), total: paths.length }
  },

  async cleanPreview(repo, scope) {
    if (scope !== 'untracked' && scope !== 'ignored' && scope !== 'all') {
      throw new Error(`Invalid scope: ${String(scope)}`)
    }
    const { untracked, ignored } = await untrackedEntries(repo)
    const folders = untracked.filter((path) => path.endsWith('/'))
    let listed: { path: string; ignored: boolean }[] = []
    if (scope === 'ignored') listed = ignored.map((path) => ({ path, ignored: true }))
    else if (scope === 'all') {
      // Ignored files in an untracked folder go with the folder
      listed = [
        ...untracked.map((path) => ({ path, ignored: false })),
        ...ignored
          .filter((path) => !insideFolder(path, folders))
          .map((path) => ({ path, ignored: true }))
      ]
    } else {
      for (const path of untracked) {
        if (path.endsWith('/') && ignored.some((i) => i.startsWith(path))) {
          // The folder holds ignored files too: its untracked files one by one, leaving those
          const files = await runGit(repo, [
            '--literal-pathspecs',
            'ls-files',
            '-o',
            '--exclude-standard',
            '-z',
            '--',
            path
          ])
          for (const file of files.split('\0'))
            if (file) listed.push({ path: file, ignored: false })
        } else listed.push({ path, ignored: false })
      }
    }
    const nested: string[] = []
    const kept: typeof listed = []
    for (const entry of listed) {
      if (await isNestedRepo(repo, entry.path)) nested.push(entry.path)
      else kept.push(entry)
    }
    const entries = await Promise.all(
      kept.slice(0, MOST_CLEAN).map(async (entry) => ({
        ...entry,
        ...(await entrySize(resolve(repo, entry.path)))
      }))
    )
    entries.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    return { entries, more: Math.max(0, kept.length - MOST_CLEAN), nested }
  },

  async cleanFiles(repo, paths, toTrash) {
    if (!Array.isArray(paths)) throw new Error('Invalid paths')
    if (toTrash && !trash) throw new Error(`The ${TRASH} is not available`)
    // Only what a preview can list: an entry of git status, or a file in an untracked folder
    const { untracked, ignored } = await untrackedEntries(repo)
    const known = new Set([...untracked, ...ignored])
    const folders = untracked.filter((path) => path.endsWith('/'))
    for (const path of paths) {
      repoFile(repo, path)
      if ((!known.has(path) && !insideFolder(path, folders)) || (await isNestedRepo(repo, path))) {
        throw new Error(`${path} is no longer untracked: look at the list again`)
      }
    }
    if (toTrash && trash) {
      const failed: string[] = []
      for (const path of paths) {
        await trash(repoFile(repo, path)).catch(() => failed.push(path))
      }
      if (failed.length) {
        throw new Error(
          `${failed.length} of ${paths.length} could not be moved to the ${TRASH}: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`
        )
      }
      return
    }
    // -x as the ignored ones are named explicitly; clean has no --pathspec-from-file
    for (let i = 0; i < paths.length; i += 100) {
      await runGit(repo, [
        '--literal-pathspecs',
        'clean',
        '-f',
        '-d',
        '-x',
        '-q',
        '--',
        ...paths.slice(i, i + 100)
      ])
    }
  }
}
