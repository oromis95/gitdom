// Getting repositories onto the machine: clone from a URL (REPO-02, REPO-11) and git init (REPO-03).
import { existsSync, readdirSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CloneOptions, CloneProgress, InitOptions, InitOutcome } from '../../shared/api'
import { gitignoreContent, licenseText } from '../../shared/templates'
import { runGit, tryGit } from './exec'

// Share of the overall progress bar given to each phase git reports, in order
const PHASES: [RegExp, number, number][] = [
  [/^(remote: )?(Enumerating|Counting|Compressing) objects/, 0, 10],
  [/^Receiving objects/, 10, 80],
  [/^Resolving deltas/, 80, 95],
  [/^(Updating files|Checking out files|Filtering content)/, 95, 100]
]

const PROGRESS_RE = /^(.*?):\s+(\d{1,3})%/

/**
 * Reads one line of `git clone --progress` output into overall progress,
 * or null for lines that aren't progress (warnings, submodule messages).
 */
export function parseCloneProgress(line: string): CloneProgress | null {
  const match = PROGRESS_RE.exec(line.trim())
  if (!match) return null
  const phase = match[1].replace(/^remote: /, '')
  const percent = Math.min(100, Number(match[2]))
  const range = PHASES.find(([re]) => re.test(match[1]))
  if (!range) return { phase, percent: null }
  const [, from, to] = range
  return { phase, percent: Math.round(from + ((to - from) * percent) / 100) }
}

function checkName(name: string): void {
  if (!name.trim() || /[<>:"/\\|?*\0]/.test(name) || /^\.+$/.test(name.trim()))
    throw new Error(`Invalid folder name: ${name}`)
}

/** A new repository goes in a folder that doesn't exist yet, or is empty. */
function checkTarget(target: string): void {
  if (existsSync(target) && readdirSync(target).length > 0)
    throw new Error(`The folder already exists and isn't empty: ${target}`)
}

/** Clones in progress, by the id the renderer gave them, to cancel them. */
const clones = new Map<number, AbortController>()

export async function cloneRepository(
  id: number,
  options: CloneOptions,
  onProgress: (progress: CloneProgress) => void
): Promise<string> {
  const url = options.url.trim()
  if (!url || url.startsWith('-') || /[\0\n]/.test(url)) throw new Error(`Invalid URL: ${url}`)
  checkName(options.name)
  const target = join(options.parent, options.name.trim())
  checkTarget(target)
  const existed = existsSync(target)

  const args = ['clone', '--progress']
  const branch = options.branch?.trim()
  if (branch) {
    if (branch.startsWith('-') || /[\0\n\s]/.test(branch))
      throw new Error(`Invalid branch: ${branch}`)
    args.push('--branch', branch)
  }
  if (options.depth) {
    if (!Number.isInteger(options.depth) || options.depth < 1)
      throw new Error(`Invalid depth: ${options.depth}`)
    args.push('--depth', String(options.depth))
    // --depth implies --single-branch: keep every branch visible in the graph
    args.push('--no-single-branch')
  }
  if (options.recursive) args.push('--recurse-submodules')
  args.push('--', url, target)

  const controller = new AbortController()
  clones.set(id, controller)
  // git rewrites progress lines in place with \r: split on both
  let partial = ''
  let last = ''
  try {
    await runGit(options.parent, args, {
      signal: controller.signal,
      onStderr(chunk) {
        const lines = (partial + chunk).split(/[\r\n]/)
        partial = lines.pop() ?? ''
        for (const line of lines) {
          const progress = parseCloneProgress(line)
          const key = progress && `${progress.phase}:${progress.percent}`
          if (progress && key !== last) {
            last = key!
            onProgress(progress)
          }
        }
      }
    })
    return target
  } catch (e) {
    // git removes the folder when a clone fails, but not when it's killed
    if (controller.signal.aborted) {
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
        () => undefined
      )
      if (existed) await mkdir(target).catch(() => undefined)
    }
    throw e
  } finally {
    clones.delete(id)
  }
}

export function cancelClone(id: number): void {
  clones.get(id)?.abort()
}

export async function initRepository(options: InitOptions): Promise<InitOutcome> {
  checkName(options.name)
  const branch = options.defaultBranch.trim()
  if (!branch || branch.startsWith('-') || /[\0\n\s]/.test(branch))
    throw new Error(`Invalid branch: ${branch}`)
  const target = join(options.parent, options.name.trim())
  checkTarget(target)
  // Validate the templates before touching the disk
  const gitignore = options.gitignore ? gitignoreContent(options.gitignore) : null
  if (!(await tryGit(options.parent, ['check-ref-format', '--branch', branch])))
    throw new Error(`Invalid branch: ${branch}`)

  await mkdir(target, { recursive: true })
  await runGit(target, ['init', '-b', branch])

  const files: string[] = []
  if (gitignore) {
    await writeFile(join(target, '.gitignore'), gitignore)
    files.push('.gitignore')
  }
  if (options.readme) {
    await writeFile(join(target, 'README.md'), `# ${options.name.trim()}\n`)
    files.push('README.md')
  }
  if (options.license) {
    const holder = (await tryGit(target, ['config', 'user.name']))?.trim() || 'the authors'
    await writeFile(
      join(target, 'LICENSE'),
      licenseText(options.license, new Date().getFullYear(), holder)
    )
    files.push('LICENSE')
  }

  if (files.length === 0) return { path: target, committed: false }
  await runGit(target, ['add', '--', ...files])
  try {
    await runGit(target, ['commit', '-m', 'Initial commit'])
    return { path: target, committed: true }
  } catch {
    // Usually no author identity yet: the files stay staged for the first commit
    return { path: target, committed: false }
  }
}
