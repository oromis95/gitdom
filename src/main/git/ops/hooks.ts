// Operations on the git hooks.
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { resolve } from 'path'
import type { HookInfo } from '../../../shared/api'
import { GitError, runGit } from '../exec'
import { type OpImpl, exists, getConfig } from './shared'

/** The hooks git knows, in the order it runs them, and when */
const KNOWN_HOOKS: Record<string, string> = {
  'pre-commit': 'Before a commit is made: can stop it, e.g. when tests or the linter fail',
  'prepare-commit-msg': 'Before the message editor opens: can fill in the message',
  'commit-msg': 'After the message is written: can check it, or stop the commit',
  'post-commit': 'After a commit: a notification, nothing it does can undo the commit',
  'pre-merge-commit': 'Before a merge commit is made: can stop it',
  'pre-rebase': 'Before a rebase starts: can stop it',
  'post-rewrite': 'After an amend or a rebase rewrote commits',
  'post-checkout': 'After a checkout or a switch of branch, and after a clone',
  'post-merge': 'After a merge or a pull, e.g. to install new dependencies',
  'pre-push': 'Before a push: can stop it, e.g. when tests fail',
  'reference-transaction': 'Whenever a branch, a tag or another reference changes',
  'pre-auto-gc': 'Before git tidies up the repository by itself: can postpone it',
  'applypatch-msg': 'git am: checks the message of a patch',
  'pre-applypatch': 'git am: after a patch is applied, before it is committed',
  'post-applypatch': 'git am: after a patch is committed',
  'sendemail-validate': 'git send-email: checks a patch before it is sent',
  'fsmonitor-watchman': 'Asks a file watcher what changed, to speed up git status',
  'push-to-checkout': 'On a server: a push to the branch checked out there',
  'pre-receive': 'On a server: before a push is accepted',
  update: 'On a server: before each branch of a push is updated',
  'proc-receive': 'On a server: handles special pushes',
  'post-receive': 'On a server: after a push',
  'post-update': 'On a server: after a push, e.g. for the dumb HTTP protocol'
}
/** Listed only when there is a script for them */
const SERVER_HOOKS = new Set([
  'push-to-checkout',
  'pre-receive',
  'update',
  'proc-receive',
  'post-receive',
  'post-update'
])
/** Skipped by a commit with --no-verify */
const SKIPPABLE_HOOKS = new Set(['pre-commit', 'commit-msg'])
/** Those git calls with no arguments and nothing on stdin */
const RUNNABLE_HOOKS = new Set([
  'pre-commit',
  'post-commit',
  'pre-merge-commit',
  'pre-auto-gc',
  'pre-applypatch',
  'post-applypatch'
])
const HOOK_NAME = /^[a-z][a-z0-9-]*$/

/** The folder of the hooks, core.hooksPath included; checks `name` when given. */
async function hooksDir(repo: string, name?: string): Promise<string> {
  if (name !== undefined && (typeof name !== 'string' || !HOOK_NAME.test(name)))
    throw new Error(`Not a hook name: ${String(name)}`)
  return resolve(repo, (await runGit(repo, ['rev-parse', '--git-path', 'hooks'])).trim())
}

/** The tool that installed the hooks, from core.hooksPath or what it leaves beside them. */
function hookManager(hooksPath: string | null, files: string[]): string | null {
  if (hooksPath && /husky/i.test(hooksPath)) return 'Husky'
  if (hooksPath && /lefthook/i.test(hooksPath)) return 'Lefthook'
  if (files.some((f) => f.endsWith('.legacy'))) return 'pre-commit'
  return null
}

export const hooksOps: Pick<
  OpImpl,
  'hooks' | 'readHook' | 'saveHook' | 'setHookEnabled' | 'deleteHook' | 'runHook'
> = {
  async hooks(repo) {
    const dir = await hooksDir(repo)
    const hooksPath = await getConfig(repo, 'core.hooksPath')
    const files = await readdir(dir).catch(() => [] as string[])
    const names = new Set(Object.keys(KNOWN_HOOKS).filter((name) => !SERVER_HOOKS.has(name)))
    // Any other script there, server hooks included: git may run it, or a tool calls it
    for (const file of files) {
      const name = file.replace(/\.(sample|disabled)$/, '')
      if (HOOK_NAME.test(name)) names.add(name)
    }
    const has = new Set(files)
    // Outside Windows git skips a script it can't execute
    const skipped = new Set<string>()
    if (process.platform !== 'win32')
      for (const name of names) {
        if (!has.has(name)) continue
        const mode = await stat(resolve(dir, name)).then(
          (s) => s.mode,
          () => 0o755
        )
        if ((mode & 0o111) === 0) skipped.add(name)
      }
    const hooks = [...names].map((name): HookInfo => ({
      name,
      state: has.has(name)
        ? 'active'
        : has.has(`${name}.disabled`)
          ? 'disabled'
          : has.has(`${name}.sample`)
            ? 'sample'
            : 'none',
      description: KNOWN_HOOKS[name] ?? 'Not a hook git knows: a script that a tool may call',
      skippable: SKIPPABLE_HOOKS.has(name),
      runnable: RUNNABLE_HOOKS.has(name),
      ...(skipped.has(name) ? { notExecutable: true } : {})
    }))
    const order = Object.keys(KNOWN_HOOKS)
    const rank = (name: string): number => {
      const i = order.indexOf(name)
      return i < 0 ? order.length : i
    }
    hooks.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    return { dir, hooksPath, manager: hookManager(hooksPath, files), hooks }
  },

  async readHook(repo, name) {
    const dir = await hooksDir(repo, name)
    for (const file of [name, `${name}.disabled`, `${name}.sample`]) {
      const content = await readFile(resolve(dir, file), 'utf8').catch(() => null)
      if (content !== null) return content
    }
    return ''
  },

  async saveHook(repo, name, content) {
    if (typeof content !== 'string') throw new Error('Invalid script')
    const dir = await hooksDir(repo, name)
    const disabled = resolve(dir, `${name}.disabled`)
    const target = (await exists(disabled)) ? disabled : resolve(dir, name)
    await mkdir(dir, { recursive: true })
    // Shell scripts break on CRLF line ends, and outside Windows need the executable bit
    await writeFile(target, content.replace(/\r\n/g, '\n'))
    await chmod(target, 0o755)
  },

  async setHookEnabled(repo, name, enabled) {
    const dir = await hooksDir(repo, name)
    const active = resolve(dir, name)
    const disabled = resolve(dir, `${name}.disabled`)
    const [from, to] = enabled ? [disabled, active] : [active, disabled]
    if (await exists(to)) {
      if (await exists(from))
        throw new Error(`${name} is there both on and off: delete one of the two first`)
    } else if (!(await exists(from)))
      throw new Error(`There is no ${name} hook to turn ${enabled ? 'on' : 'off'}`)
    else await rename(from, to)
    // Turning on also makes it executable: a script copied in may have lost the bit
    if (enabled) await chmod(active, 0o755)
  },

  async deleteHook(repo, name) {
    const dir = await hooksDir(repo, name)
    for (const file of [name, `${name}.disabled`]) await rm(resolve(dir, file), { force: true })
  },

  async runHook(repo, name) {
    await hooksDir(repo, name)
    if (!RUNNABLE_HOOKS.has(name))
      throw new Error(`${name} needs what git gives it: it can't run by itself`)
    try {
      // git hook run sends what the hook prints to stderr
      const output = await runGit(repo, ['hook', 'run', '--ignore-missing', name], {
        withStderr: true
      })
      return { ok: true, output: output.trim() }
    } catch (e) {
      if (!(e instanceof GitError)) throw e
      if (/is not a git command|unknown subcommand/.test(e.stderr))
        throw new Error('Running hooks needs git 2.36 or newer')
      return { ok: false, output: e.stderr.trim() }
    }
  }
}
