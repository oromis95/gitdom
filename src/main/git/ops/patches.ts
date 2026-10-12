// Operations that make and apply patches.
import { readFile, stat, writeFile } from 'fs/promises'
import { isAbsolute } from 'path'
import type { PatchInfo, PatchSource } from '../../../shared/api'
import { GitError, runGit, tryGit } from '../exec'
import { readOperation } from '../repository'
import { type OpImpl, assertHash, assertIdle, withConflicts, hasHead } from './shared'

/** Patches bigger than this are not read: they are surely not one */
const MAX_PATCH = 50 * 1024 * 1024

async function readPatch(path: string): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`Invalid patch file: ${path}`)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new Error(`No such file: ${path}`)
  if (info.size > MAX_PATCH) throw new Error('This file is too big to be a patch')
  return readFile(path, 'utf8')
}

async function patchText(repo: string, source: PatchSource): Promise<string> {
  if ('changes' in source) {
    // Binary files too, so that the patch applies whole
    const against =
      source.changes === 'staged' ? ['--cached'] : (await hasHead(repo)) ? ['HEAD'] : ['--cached']
    return runGit(repo, ['diff', '--binary', ...against])
  }
  if (!Array.isArray(source.commits) || !source.commits.length) throw new Error('No commits')
  source.commits.forEach(assertHash)
  // The oldest first, so that they apply in order: by how many commits come before each
  const depth = new Map<string, number>()
  for (const hash of source.commits)
    depth.set(hash, Number((await runGit(repo, ['rev-list', '--count', hash])).trim()))
  const ordered = [...depth.keys()].sort((a, b) => depth.get(a)! - depth.get(b)!)
  const patches: string[] = []
  for (const [i, hash] of ordered.entries()) {
    const prefix = ordered.length > 1 ? [`--subject-prefix=PATCH ${i + 1}/${ordered.length}`] : []
    patches.push(
      await runGit(repo, ['format-patch', '-1', '--stdout', '--binary', ...prefix, hash])
    )
  }
  return patches.join('')
}

export const patchesOps: Pick<
  OpImpl,
  'patchText' | 'savePatch' | 'inspectPatch' | 'amPatch' | 'applyPatchFile'
> = {
  async patchText(repo, source) {
    return patchText(repo, source)
  },

  async savePatch(repo, dest, source) {
    if (typeof dest !== 'string' || !isAbsolute(dest))
      throw new Error(`Invalid destination: ${dest}`)
    const text = await patchText(repo, source)
    if (!text) throw new Error('Nothing to save: there are no changes')
    await writeFile(dest, text)
  },

  async inspectPatch(repo, path) {
    const text = await readPatch(path)
    const commits: PatchInfo['commits'] = []
    // One mail per commit: "From <hash> <date>", then its headers
    for (const mail of text.split(/^From [0-9a-f]{40} /m).slice(1)) {
      const head = mail.slice(0, mail.search(/\n\n/) + 1 || undefined)
      const header = (name: string): string =>
        (head.match(new RegExp(`^${name}: (.*(?:\n[ \t].*)*)`, 'm'))?.[1] ?? '')
          .replace(/\n[ \t]+/g, ' ')
          .trim()
      commits.push({
        subject: header('Subject').replace(/^\[PATCH[^\]]*\]\s*/, ''),
        author: header('From')
          .replace(/\s*<.*>$/, '')
          .replace(/^"(.*)"$/, '$1')
      })
    }
    const files = (await runGit(repo, ['apply', '--numstat', '-'], { input: text }).catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [added, removed, ...path] = line.split('\t')
        return {
          path: path.join('\t'),
          added: added === '-' ? null : Number(added),
          removed: removed === '-' ? null : Number(removed)
        }
      })
    if (!files.length && !commits.length) throw new Error('This file is not a patch')
    let problem: string | null = null
    try {
      await runGit(repo, ['apply', '--check', '-'], { input: text })
    } catch (e) {
      problem = e instanceof GitError ? e.stderr.trim() || e.message : String(e)
    }
    return { commits, files, applies: problem === null, problem }
  },

  async amPatch(repo, path) {
    await assertIdle(repo)
    await readPatch(path)
    try {
      const output = await runGit(repo, ['am', '--3way', '--', path], { withStderr: true })
      return { conflicts: false, output }
    } catch (e) {
      if (!(e instanceof GitError)) throw e
      if ((await tryGit(repo, ['ls-files', '-u']))?.trim())
        return { conflicts: true, output: e.stderr.trim() }
      // Not applied and nothing to resolve: leave the repository as it was
      if ((await readOperation(repo)) === 'am') await tryGit(repo, ['am', '--abort'])
      throw new Error(
        `The patch does not apply: ${
          e.stderr
            .split('\n')
            .find((l) => /^error:/.test(l))
            ?.slice(7) ?? e.message
        }`
      )
    }
  },

  async applyPatchFile(repo, path, stage) {
    await assertIdle(repo)
    await readPatch(path)
    // With the index, a three-way merge leaves conflicts to resolve rather than failing
    return withConflicts(repo, ['apply', ...(stage ? ['--3way', '--index'] : []), '--', path])
  }
}
