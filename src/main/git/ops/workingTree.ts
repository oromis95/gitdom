// Operations on the working tree and the index: staging, conflicts, stashes.
import { readFile, writeFile } from 'fs/promises'
import { runGit } from '../exec'
import { toolSettings } from '../../settings'
import { readOperation } from '../repository'
import {
  type OpImpl,
  assertArg,
  assertRev,
  assertHash,
  repoFile,
  withConflicts,
  runWithPaths,
  hasHead,
  getConfig,
  firstParentOf
} from './shared'

const STASH_RE = /^stash@\{\d+\}$/

const CONFLICT_MARKER_RE = /^(<{7}|>{7})( |$)/m

function assertStash(selector: string): void {
  if (!STASH_RE.test(selector)) throw new Error(`Invalid stash: ${selector}`)
}

export const workingTreeOps: Pick<
  OpImpl,
  | 'stage'
  | 'unstage'
  | 'stageAll'
  | 'unstageAll'
  | 'discard'
  | 'applyPatch'
  | 'resolveConflict'
  | 'conflictMarkers'
  | 'continueOperation'
  | 'abortOperation'
  | 'skipOperation'
  | 'openDiffTool'
  | 'openMergeTool'
  | 'readConflictFile'
  | 'saveResolution'
  | 'stashPush'
  | 'stashApply'
  | 'stashPop'
  | 'stashDrop'
> = {
  async stage(repo, paths) {
    await runWithPaths(repo, ['add', '-A'], paths)
  },

  async unstage(repo, paths) {
    // Without a first commit there is nothing to reset to: remove the entries from the index instead
    if (await hasHead(repo)) await runWithPaths(repo, ['reset', '-q'], paths)
    else await runWithPaths(repo, ['rm', '--cached', '-r', '-q'], paths)
  },

  async stageAll(repo) {
    await runGit(repo, ['add', '-A'])
  },

  async unstageAll(repo) {
    if (await hasHead(repo)) await runGit(repo, ['reset', '-q'])
    else await runGit(repo, ['rm', '--cached', '-r', '-q', '.'])
  },

  async discard(repo, files) {
    const untracked = files.filter((f) => f.status === '?').map((f) => f.path)
    const tracked = files.filter((f) => f.status !== '?').map((f) => f.path)
    if (tracked.length > 0) await runWithPaths(repo, ['restore', '--worktree'], tracked)
    // clean has no --pathspec-from-file: chunk to stay under the command line limit
    for (let i = 0; i < untracked.length; i += 100) {
      await runGit(repo, [
        '--literal-pathspecs',
        'clean',
        '-f',
        '-q',
        '--',
        ...untracked.slice(i, i + 100)
      ])
    }
  },

  async applyPatch(repo, patch, cached, reverse) {
    const args = ['apply', '--recount', '--whitespace=nowarn']
    if (cached) args.push('--cached')
    if (reverse) args.push('--reverse')
    await runGit(repo, [...args, '-'], { input: patch })
  },

  async resolveConflict(repo, paths, side) {
    if (side !== 'ours' && side !== 'theirs') throw new Error(`Invalid side: ${String(side)}`)
    await runWithPaths(repo, ['checkout', `--${side}`], paths)
    await runWithPaths(repo, ['add', '-A'], paths)
  },

  async conflictMarkers(repo, paths) {
    const withMarkers: string[] = []
    for (const path of paths) {
      const content = await readFile(repoFile(repo, path), 'utf8').catch(() => '')
      if (CONFLICT_MARKER_RE.test(content)) withMarkers.push(path)
    }
    return withMarkers
  },

  async continueOperation(repo) {
    const operation = await readOperation(repo)
    if (!operation) throw new Error('No merge, rebase, cherry-pick or revert in progress')
    const conflicted = await runGit(repo, ['diff', '--name-only', '--diff-filter=U'])
    if (conflicted.trim()) {
      throw new Error('Some files still have conflicts: resolve them and stage them first')
    }
    // Keeps the prepared commit message; a rebase may stop again on a later commit
    return withConflicts(repo, [operation, '--continue'])
  },

  async abortOperation(repo) {
    const operation = await readOperation(repo)
    if (!operation) throw new Error('No merge, rebase, cherry-pick or revert in progress')
    await runGit(repo, [operation, '--abort'])
  },

  async skipOperation(repo) {
    const operation = await readOperation(repo)
    if (!operation) throw new Error('No rebase, cherry-pick or revert in progress')
    if (operation === 'merge') throw new Error('A merge cannot be skipped: abort it instead')
    return withConflicts(repo, [operation, '--skip'])
  },

  async openDiffTool(repo, source, path, oldPath) {
    const paths = oldPath && oldPath !== path ? [oldPath, path] : [path]
    paths.forEach((p) => assertArg(p, 'path'))
    const tool = toolSettings().diffTool
    if (tool && !/^[\w.-]+$/.test(tool)) throw new Error(`Invalid diff tool: ${tool}`)
    if (!tool && !(await getConfig(repo, 'diff.tool')) && !(await getConfig(repo, 'merge.tool'))) {
      throw new Error(
        'No external diff tool configured: choose one in Preferences, or set diff.tool in your git config'
      )
    }
    let revs: string[]
    switch (source.kind) {
      case 'unstaged':
        revs = []
        break
      case 'staged':
        revs = ['--cached']
        break
      case 'untracked':
        throw new Error('A new file has nothing to compare with yet: stage it first')
      case 'commit':
        assertHash(source.hash)
        revs = [
          (await firstParentOf(repo, source.hash)) ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
          source.hash
        ] // root: the empty tree
        break
      case 'compare':
        assertRev(source.from)
        assertRev(source.to)
        revs = [source.from, source.to]
        break
    }
    await runGit(repo, [
      'difftool',
      '--no-prompt',
      ...(tool ? [`--tool=${tool}`] : []),
      '-M',
      ...revs,
      '--',
      ...paths
    ])
  },

  async openMergeTool(repo, path) {
    repoFile(repo, path)
    // Without a configured tool git would try terminal editors, which can't run here
    const tool = toolSettings().mergeTool
    if (tool && !/^[\w.-]+$/.test(tool)) throw new Error(`Invalid merge tool: ${tool}`)
    if (!tool && !(await getConfig(repo, 'merge.tool'))) {
      throw new Error(
        'No external merge tool configured: choose one in Preferences, or set merge.tool in your git config'
      )
    }
    await runGit(repo, [
      '-c',
      'mergetool.keepBackup=false',
      'mergetool',
      '--no-prompt',
      ...(tool ? [`--tool=${tool}`] : []),
      '--',
      path
    ])
  },

  readConflictFile: (repo, path) => readFile(repoFile(repo, path), 'utf8'),

  async saveResolution(repo, path, content) {
    await writeFile(repoFile(repo, path), content, 'utf8')
    await runWithPaths(repo, ['add', '-A'], [path])
  },

  async stashPush(repo, message, includeUntracked, options = {}) {
    const args = ['stash', 'push']
    const paths = options.paths ?? []
    if (options.staged) {
      if (paths.length) throw new Error('Staged changes are stashed all together, not by file')
      args.push('--staged')
    } else if (includeUntracked) args.push('--include-untracked')
    if (message.trim()) args.push('-m', message.trim())
    if (!paths.length) {
      await runGit(repo, args)
      return
    }
    paths.forEach((p) => repoFile(repo, p))
    await runWithPaths(repo, args, paths)
  },

  async stashApply(repo, selector) {
    assertStash(selector)
    await runGit(repo, ['stash', 'apply', selector])
  },

  async stashPop(repo, selector) {
    assertStash(selector)
    await runGit(repo, ['stash', 'pop', selector])
  },

  async stashDrop(repo, selector) {
    assertStash(selector)
    await runGit(repo, ['stash', 'drop', selector])
  }
}
