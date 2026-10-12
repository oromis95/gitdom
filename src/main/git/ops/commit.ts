// Operations that make or rewrite commits.
import { readFile, rm } from 'fs/promises'
import { resolve } from 'path'
import type { RebaseStep } from '../../../shared/api'
import {
  LARGE_BINARY,
  capWarnings,
  scanStaged,
  sizeWarning,
  type CommitWarning
} from '../../../shared/commitChecks'
import { runGit, tryGit } from '../exec'
import { signingProgramArgs } from '../repository'
import { type OpImpl, assertHash, assertIdle, currentBranch, firstParentOf, short } from './shared'
import { mergeOps } from './merge'
import { branchesOps } from './branches'

export const commitOps: Pick<
  OpImpl,
  | 'commit'
  | 'lastCommitMessage'
  | 'commitTemplate'
  | 'commitChecks'
  | 'reword'
  | 'fixup'
  | 'splitCommit'
  | 'reorderCommits'
> = {
  async commit(repo, message, amend, options = {}) {
    if (!message.trim()) throw new Error('The commit message is empty')
    const args = ['commit', '-F', '-']
    if (amend) args.push('--amend')
    if (options.noVerify) args.push('--no-verify')
    if (options.sign !== undefined) args.push(options.sign ? '-S' : '--no-gpg-sign')
    const author = options.author?.trim()
    if (author) {
      if (!/^[^<>\0\n]+ <[^<>\0\n]+>$/.test(author)) {
        throw new Error(`The author must be written as Name <email>: ${author}`)
      }
      args.push(`--author=${author}`)
    }
    return runGit(repo, [...(await signingProgramArgs(repo)), ...args], {
      input: message,
      withStderr: true
    })
  },

  async lastCommitMessage(repo) {
    return (await runGit(repo, ['log', '-1', '--format=%B'])).trim()
  },

  async commitTemplate(repo) {
    const path = (await tryGit(repo, ['config', '--path', '--get', 'commit.template']))?.trim()
    if (!path) return null
    // A template that can't be read is ignored, as git itself would fail the commit
    return readFile(resolve(repo, path), 'utf8').catch(() => null)
  },

  async commitChecks(repo, kinds) {
    const warnings: CommitWarning[] = []
    const cached = ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-renames']
    const listed = (await runGit(repo, [...cached, '--name-only', '-z'])).split('\0')
    const paths = listed.filter(Boolean)
    if (!paths.length) return warnings
    if (kinds.secrets || kinds.debugCode) {
      const diff = await runGit(repo, [...cached, '-U0', '--no-color', '--no-ext-diff'])
      warnings.push(...scanStaged(diff, paths, kinds))
    }
    if (kinds.largeFiles) {
      // Sizes of the staged blobs; binaries are those numstat can't count lines of
      const raw = (await runGit(repo, [...cached, '--raw', '--no-abbrev', '-z'])).split('\0')
      const blobs: { path: string; hash: string }[] = []
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const [, , , hash, status] = raw[i].split(' ')
        if (status !== 'D' && /^[0-9a-f]{40,64}$/.test(hash)) blobs.push({ path: raw[i + 1], hash })
      }
      const sizes = (
        await runGit(repo, ['cat-file', '--batch-check=%(objectsize)'], {
          input: blobs.map((b) => b.hash).join('\n') + '\n'
        })
      ).split('\n')
      const big = blobs
        .map((b, i) => ({ ...b, size: Number(sizes[i]) || 0 }))
        .filter((b) => b.size > LARGE_BINARY)
      if (big.length) {
        const numstat = (await runGit(repo, [...cached, '--numstat', '-z'])).split('\0')
        const binary = new Set(numstat.filter((l) => l.startsWith('-\t-\t')).map((l) => l.slice(4)))
        const attrs = (
          await runGit(repo, ['check-attr', '--cached', '-z', '--stdin', 'filter'], {
            input: big.map((b) => b.path).join('\0') + '\0'
          })
        ).split('\0')
        const lfs = new Set<string>()
        for (let i = 0; i + 2 < attrs.length; i += 3) if (attrs[i + 2] === 'lfs') lfs.add(attrs[i])
        for (const b of big) {
          const warning = sizeWarning(b.path, b.size, binary.has(b.path), lfs.has(b.path))
          if (warning) warnings.push(warning)
        }
      }
    }
    return capWarnings(warnings)
  },

  async reword(repo, hash, message) {
    assertHash(hash)
    if (!message.trim()) throw new Error('The commit message is empty')
    await assertIdle(repo)
    await currentBranch(repo)
    const [head, commit] = await Promise.all(
      ['HEAD', `${hash}^{commit}`].map(async (rev) =>
        (await runGit(repo, ['rev-parse', '--verify', rev])).trim()
      )
    )
    if (commit === head) {
      // --only without paths commits HEAD's tree again: staged changes stay staged.
      // The content is unchanged, so hooks checking it would only get in the way
      const output = await runGit(
        repo,
        [
          ...(await signingProgramArgs(repo)),
          'commit',
          '--amend',
          '--only',
          '--no-verify',
          '--allow-empty',
          '-F',
          '-'
        ],
        { input: message.trim() + '\n', withStderr: true }
      )
      return { conflicts: false, output }
    }
    if (!(await branchesOps.isAncestor(repo, commit, head))) {
      throw new Error('The commit is not on the current branch: check out its branch first')
    }
    const base = (await firstParentOf(repo, commit)) ?? null
    const { commits, merges } = await mergeOps.rebaseCommits(repo, base)
    if (merges > 0) {
      throw new Error(
        'This commit is, or is followed by, a merge commit: rewording it would flatten the merges'
      )
    }
    return mergeOps.rebaseInteractive(
      repo,
      base,
      commits.map((c) =>
        c.hash === commit
          ? { action: 'reword', hash: c.hash, message }
          : { action: 'pick', hash: c.hash }
      )
    )
  },

  async fixup(repo, hash) {
    assertHash(hash)
    await assertIdle(repo)
    await currentBranch(repo)
    if ((await tryGit(repo, ['diff', '--cached', '--quiet'])) !== null)
      throw new Error('Stage the changes to add to the commit first')
    const [head, commit] = await Promise.all(
      ['HEAD', `${hash}^{commit}`].map(async (rev) =>
        (await runGit(repo, ['rev-parse', '--verify', rev])).trim()
      )
    )
    const sign = await signingProgramArgs(repo)
    if (commit === head) {
      const output = await runGit(repo, [...sign, 'commit', '--amend', '--no-edit'], {
        withStderr: true
      })
      return { conflicts: false, output }
    }
    if (!(await branchesOps.isAncestor(repo, commit, head))) {
      throw new Error('The commit is not on the current branch: check out its branch first')
    }
    // Checked before committing, so that a refusal leaves the staged changes as they are
    const base = (await firstParentOf(repo, commit)) ?? null
    const { commits, merges } = await mergeOps.rebaseCommits(repo, base)
    if (merges > 0) {
      throw new Error(
        'This commit is, or is followed by, a merge commit: fixing it up would flatten the merges'
      )
    }
    await runGit(repo, [...sign, 'commit', '-q', `--fixup=${commit}`])
    const fix = (await runGit(repo, ['rev-parse', 'HEAD'])).trim()
    return mergeOps.rebaseInteractive(
      repo,
      base,
      commits.flatMap((c): RebaseStep[] =>
        c.hash === commit
          ? [
              { action: 'pick', hash: c.hash },
              { action: 'fixup', hash: fix }
            ]
          : [{ action: 'pick', hash: c.hash }]
      )
    )
  },

  async splitCommit(repo, hash, paths, firstMessage, secondMessage) {
    assertHash(hash)
    if (!firstMessage.trim() || !secondMessage.trim()) {
      throw new Error('Both commits need a message')
    }
    await assertIdle(repo)
    const branch = await currentBranch(repo)
    const head = (await runGit(repo, ['rev-parse', '--verify', 'HEAD'])).trim()
    const [commit, ...parents] = (await runGit(repo, ['rev-list', '--parents', '-n1', hash]))
      .trim()
      .split(' ')
    if (parents.length > 1) throw new Error('A merge commit cannot be split')
    if (commit !== head && !(await branchesOps.isAncestor(repo, commit, head))) {
      throw new Error('The commit is not on the current branch: check out its branch first')
    }
    const parent = parents[0] as string | undefined

    // What the commit changed, file by file, with the mode and blob each has after it
    const raw = await runGit(repo, [
      'diff-tree',
      '-r',
      '-z',
      '--raw',
      '--no-renames',
      '--no-commit-id',
      ...(parent ? [parent, commit] : ['--root', commit])
    ])
    const fields = raw.split('\0')
    const changes = new Map<string, string>()
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const [, newMode, , newBlob] = fields[i].slice(1).split(' ')
      changes.set(fields[i + 1], `${newMode} ${newBlob}`)
    }
    const chosen = new Set(paths)
    const unknown = [...chosen].find((path) => !changes.has(path))
    if (unknown !== undefined) throw new Error(`The commit didn't change ${unknown}`)
    if (!chosen.size || chosen.size === changes.size) {
      throw new Error('Pick some of the files for the first commit, not all of them')
    }

    // The first tree: the parent's, with the chosen files as the commit left them. Built in an
    // index of its own, so the real one and the working tree are never touched
    const index = resolve(
      repo,
      (await runGit(repo, ['rev-parse', '--git-path', 'gitdom-split-index'])).trim()
    )
    const env = { GIT_INDEX_FILE: index }
    let firstTree: string
    try {
      await runGit(repo, ['read-tree', ...(parent ? [parent] : ['--empty'])], { env })
      // Removals first: a file may give way to a folder of the same name
      const entries = [...chosen]
        .map((path) => `${changes.get(path)}\t${path}\0`)
        .sort((a, b) => Number(!a.startsWith('000000 ')) - Number(!b.startsWith('000000 ')))
      await runGit(repo, ['update-index', '-z', '--index-info'], { env, input: entries.join('') })
      firstTree = (await runGit(repo, ['write-tree'], { env })).trim()
    } finally {
      await rm(index, { force: true })
    }

    // Recreated commits keep their author, message and tree; only their parents change
    const sign = await signingProgramArgs(repo)
    // Unlike commit, commit-tree signs only when asked
    const gpgSign =
      (await tryGit(repo, ['config', '--type=bool', '--get', 'commit.gpgsign']))?.trim() === 'true'
    const format = '--format=%x01%H%x00%P%x00%T%x00%an%x00%ae%x00%ad%x00%B'
    const parse = (
      output: string
    ): {
      hash: string
      parents: string[]
      tree: string
      env: Record<string, string>
      message: string
    }[] =>
      output
        .split('\x01')
        .slice(1)
        .map((record) => {
          const [hash, parents, tree, name, email, date, ...message] = record.split('\0')
          return {
            hash,
            parents: parents ? parents.split(' ') : [],
            tree,
            env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date },
            message: message.join('\0').replace(/\n+$/, '') + '\n'
          }
        })
    const log = ['log', '--no-show-signature', '--no-color', '--date=raw', format]
    const [original] = parse(await runGit(repo, [...log, '-1', commit]))
    const create = async (
      tree: string,
      parentList: string[],
      author: Record<string, string>,
      message: string
    ): Promise<string> =>
      (
        await runGit(
          repo,
          [
            ...sign,
            'commit-tree',
            ...(gpgSign ? ['-S'] : []),
            ...parentList.flatMap((p) => ['-p', p]),
            tree
          ],
          { env: author, input: message }
        )
      ).trim()
    const first = await create(
      firstTree,
      parent ? [parent] : [],
      original.env,
      firstMessage.trim() + '\n'
    )
    const second = await create(original.tree, [first], original.env, secondMessage.trim() + '\n')

    const rewritten = new Map([[commit, second]])
    if (commit !== head) {
      const after = parse(
        await runGit(repo, [
          ...log,
          '--topo-order',
          '--reverse',
          '--ancestry-path',
          `${commit}..${head}`
        ])
      )
      for (const c of after) {
        rewritten.set(
          c.hash,
          await create(
            c.tree,
            c.parents.map((p) => rewritten.get(p) ?? p),
            c.env,
            c.message
          )
        )
      }
    }
    // Only if the branch is still where it was read
    await runGit(repo, [
      'update-ref',
      '-m',
      `split ${short(commit)}`,
      `refs/heads/${branch}`,
      rewritten.get(head)!,
      head
    ])
    return { first, second }
  },

  async reorderCommits(repo, base, order) {
    if (base) assertHash(base)
    order.forEach((hash) => assertHash(hash))
    const { commits, merges } = await mergeOps.rebaseCommits(repo, base)
    if (merges > 0) {
      throw new Error('Commits can be moved only after the last merge: it would be flattened')
    }
    const current = commits.map((c) => c.hash)
    const same = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((hash, i) => hash === b[i])
    // Every commit exactly once: a missing one would be dropped by the rebase
    if (!same([...order].sort(), [...current].sort())) {
      throw new Error('The branch has changed since: try again')
    }
    if (same(order, current)) throw new Error('The commits are already in this order')
    return mergeOps.rebaseInteractive(
      repo,
      base,
      order.map((hash) => ({ action: 'pick', hash }))
    )
  }
}
