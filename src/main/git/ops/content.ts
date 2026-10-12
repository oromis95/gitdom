// Operations that read file contents and diffs.
import { readFile, stat, writeFile } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import { parseDiff } from '../../../shared/diff'
import { parseTreeFiles } from '../parsers'
import type { DiffOptions, FileContent, FileDiff, ImagePair } from '../../../shared/types'
import { runGit, tryGit } from '../exec'
import { loadStatus } from '../repository'
import { type OpImpl, assertArg, assertRev, assertHash, firstParentOf } from './shared'

async function commitDiff(
  repo: string,
  hash: string,
  paths: string[],
  extra: string[]
): Promise<string> {
  assertHash(hash)
  const firstParent = await firstParentOf(repo, hash)
  // Merges are compared with their first parent, consistently with the commit detail
  return firstParent
    ? runGit(repo, [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '-M',
        ...extra,
        firstParent,
        hash,
        '--',
        ...paths
      ])
    : runGit(repo, [
        '--literal-pathspecs',
        'diff-tree',
        '-p',
        '--root',
        ...extra,
        '--no-commit-id',
        hash,
        '--',
        ...paths
      ])
}

/** Diff arguments for the options chosen in the diff viewer (DIFF-04, DIFF-05). */
function diffOptionArgs(options: DiffOptions): string[] {
  const args: string[] = []
  if (options.ignoreWhitespace) args.push('-w')
  if (options.context !== undefined) args.push(`-U${Math.max(0, Math.floor(options.context))}`)
  return args
}

/** Images larger than this are not loaded by the image diff */
const IMAGE_LIMIT = 20 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

function imageType(path: string): string {
  return IMAGE_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'image/png'
}

/** An image stored by Git as a data URL, or null when the revision has no such file. */
async function blobImage(repo: string, spec: string, path: string): Promise<string | null> {
  const size = Number((await tryGit(repo, ['cat-file', '-s', spec]))?.trim())
  if (!size) return null
  if (size > IMAGE_LIMIT) throw new Error(`${path} is too large to preview`)
  const data = await runGit(repo, ['cat-file', 'blob', spec], { encoding: 'base64' })
  return `data:${imageType(path)};base64,${data}`
}

/** Files larger than this are not shown, only saved */
const VIEW_LIMIT = 5 * 1024 * 1024

async function blobBytes(repo: string, spec: string): Promise<Buffer> {
  return Buffer.from(
    await runGit(repo, ['cat-file', 'blob', spec], { encoding: 'base64' }),
    'base64'
  )
}

const tooLarge = (size: number): FileContent => ({
  size,
  text: null,
  image: null,
  binary: false,
  tooLarge: true
})

/** A file's bytes as GitDom shows them: an image, text, or neither when it's binary. */
function fileContent(path: string, data: Buffer): FileContent {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const image = path.includes('.') && extension in IMAGE_TYPES
  // Like git: a NUL byte near the start makes a file binary
  const binary = data.subarray(0, 8000).includes(0)
  return {
    size: data.length,
    // SVG is both: a picture and its source
    text:
      binary || (image && extension !== 'svg')
        ? null
        : data.toString('utf8').replace(/^\uFEFF/, ''),
    image: image ? `data:${imageType(path)};base64,${data.toString('base64')}` : null,
    binary: binary && !image,
    tooLarge: false
  }
}

/** An image in the working tree as a data URL, or null when it was deleted. */
async function worktreeImage(repo: string, path: string): Promise<string | null> {
  const full = resolve(repo, path)
  if (relative(repo, full).startsWith('..')) throw new Error(`Invalid path: ${path}`)
  const info = await stat(full).catch(() => null)
  if (!info) return null
  if (info.size > IMAGE_LIMIT) throw new Error(`${path} is too large to preview`)
  return `data:${imageType(path)};base64,${(await readFile(full)).toString('base64')}`
}

export const contentOps: Pick<
  OpImpl,
  'status' | 'diff' | 'imagePair' | 'treeFiles' | 'fileAt' | 'saveFileAt'
> = {
  status: (repo) => loadStatus(repo),

  async diff(repo, source, path, oldPath, options = {}): Promise<FileDiff> {
    assertArg(path, 'path')
    const paths = oldPath && oldPath !== path ? [oldPath, path] : [path]
    const extra = diffOptionArgs(options)
    let output: string
    let conflicted = false
    switch (source.kind) {
      case 'unstaged':
        // An unmerged file would give a combined diff: compare it with HEAD instead
        conflicted =
          (await runGit(repo, ['--literal-pathspecs', 'ls-files', '-u', '--', path])).trim() !== ''
        output = await runGit(repo, [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          ...extra,
          ...(conflicted ? ['HEAD'] : []),
          '--',
          path
        ])
        break
      case 'staged':
        output = await runGit(repo, [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          '--cached',
          '-M',
          ...extra,
          '--',
          ...paths
        ])
        break
      case 'untracked':
        // --no-index exits with 1 when the files differ, which is always the case here
        output = await runGit(
          repo,
          ['diff', '--no-ext-diff', '--no-index', ...extra, '--', '/dev/null', path],
          {
            okExitCodes: [1]
          }
        )
        break
      case 'commit':
        output = await commitDiff(repo, source.hash, paths, extra)
        break
      case 'compare':
        assertRev(source.from)
        assertRev(source.to)
        output = await runGit(repo, [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          '-M',
          ...extra,
          source.from,
          source.to,
          '--',
          ...paths
        ])
        break
    }
    const parsed = parseDiff(output, path)
    return conflicted ? { ...parsed, conflicted } : parsed
  },

  async imagePair(repo, source, path, oldPath): Promise<ImagePair> {
    assertArg(path, 'path')
    const before = oldPath ?? path
    switch (source.kind) {
      case 'unstaged':
        return {
          before: await blobImage(repo, `:${path}`, path),
          after: await worktreeImage(repo, path)
        }
      case 'staged':
        return {
          before: await blobImage(repo, `HEAD:${before}`, before),
          after: await blobImage(repo, `:${path}`, path)
        }
      case 'untracked':
        return { before: null, after: await worktreeImage(repo, path) }
      case 'commit': {
        assertHash(source.hash)
        const parent = await firstParentOf(repo, source.hash)
        return {
          before: parent ? await blobImage(repo, `${parent}:${before}`, before) : null,
          after: await blobImage(repo, `${source.hash}:${path}`, path)
        }
      }
      case 'compare':
        assertRev(source.from)
        assertRev(source.to)
        return {
          before: await blobImage(repo, `${source.from}:${before}`, before),
          after: await blobImage(repo, `${source.to}:${path}`, path)
        }
    }
  },

  async treeFiles(repo, rev) {
    assertRev(rev)
    return parseTreeFiles(await runGit(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', rev]))
  },

  async fileAt(repo, rev, path) {
    assertArg(path, 'path')
    if (!rev) {
      const full = resolve(repo, path)
      if (relative(repo, full).startsWith('..')) throw new Error(`Invalid path: ${path}`)
      const { size } = await stat(full)
      return size > VIEW_LIMIT ? tooLarge(size) : fileContent(path, await readFile(full))
    }
    assertRev(rev)
    const spec = `${rev}:${path}`
    const size = Number((await runGit(repo, ['cat-file', '-s', spec])).trim())
    if (size > VIEW_LIMIT) return tooLarge(size)
    return fileContent(path, await blobBytes(repo, spec))
  },

  async saveFileAt(repo, rev, path, dest) {
    assertRev(rev)
    assertArg(path, 'path')
    if (!isAbsolute(dest)) throw new Error(`Invalid destination: ${dest}`)
    await writeFile(dest, await blobBytes(repo, `${rev}:${path}`))
  }
}
