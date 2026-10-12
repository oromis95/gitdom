// Operations on the repository as a whole: health, maintenance, bisect, settings.
import { resolve } from 'path'
import { StringDecoder } from 'string_decoder'
import type { HeavyObject, RepoSummary } from '../../../shared/api'
import { GitError, runGit, tryGit } from '../exec'
import { gitDirs } from '../gitdir'
import { readOperation } from '../repository'
import { type OpImpl, assertIdle, entrySize, exists } from './shared'

/** File versions listed by size in the repository health */
const MOST_HEAVY = 30
/** Smaller files are not worth listing among the heaviest */
const LEAST_HEAVY = 1024

/** Runs git and hands over its output a line at a time, for output too big to hold. */
async function eachLine(
  repo: string,
  args: string[],
  onLine: (line: string) => void
): Promise<void> {
  const decoder = new StringDecoder('utf8')
  let rest = ''
  const take = (text: string): void => {
    const lines = (rest + text).split('\n')
    rest = lines.pop() as string
    for (const line of lines) onLine(line)
  }
  await runGit(repo, args, { onStdout: (chunk) => take(decoder.write(chunk)) })
  take(decoder.end() + '\n')
}

async function bisecting(repo: string): Promise<boolean> {
  const { gitDir } = await gitDirs(repo)
  return exists(resolve(gitDir, 'BISECT_START'))
}

async function assertCommit(repo: string, rev: string): Promise<void> {
  if (typeof rev !== 'string' || !rev || rev.startsWith('-') || rev.includes('\0'))
    throw new Error(`Not a commit: ${String(rev)}`)
  if ((await tryGit(repo, ['rev-parse', '--verify', '-q', `${rev}^{commit}`])) === null)
    throw new Error(`Not a commit: ${rev}`)
}

export const maintenanceOps: Pick<
  OpImpl,
  | 'repoHealth'
  | 'heaviestObjects'
  | 'maintain'
  | 'bisectStart'
  | 'bisectMark'
  | 'bisectRun'
  | 'bisectReset'
  | 'repoSummary'
  | 'setIdentity'
  | 'clearLocalIdentity'
  | 'setSigning'
> = {
  async repoHealth(repo) {
    const counts = new Map(
      (await runGit(repo, ['count-objects', '-v']))
        .split('\n')
        .map((line) => line.split(': '))
        .map(([key, value]) => [key, Number(value)] as const)
    )
    // In KiB
    const figure = (key: string): number => counts.get(key) ?? 0
    const lfsDir = resolve(
      repo,
      (await runGit(repo, ['rev-parse', '--git-path', 'lfs/objects'])).trim()
    )
    const lfs = await entrySize(lfsDir)
    const commits = await tryGit(repo, ['rev-list', '--count', '--all'])
    return {
      loose: { count: figure('count'), size: figure('size') * 1024 },
      packs: { count: figure('packs'), size: figure('size-pack') * 1024 },
      prunable: figure('prune-packable'),
      garbage: { count: figure('garbage'), size: figure('size-garbage') * 1024 },
      lfs: lfs.files ? lfs : null,
      commits: Number(commits ?? 0)
    }
  },

  async heaviestObjects(repo) {
    // Every object with its size, without walking the history: the biggest blobs are the candidates
    const candidates: { hash: string; size: number; diskSize: number }[] = []
    await eachLine(
      repo,
      [
        'cat-file',
        '--batch-all-objects',
        '--unordered',
        '--batch-check=%(objecttype) %(objectname) %(objectsize) %(objectsize:disk)'
      ],
      (line) => {
        const [type, hash, size, disk] = line.split(' ')
        if (type !== 'blob' || Number(size) < LEAST_HEAVY) return
        candidates.push({ hash, size: Number(size), diskSize: Number(disk) })
        // Kept short as it goes: millions of objects would not fit
        if (candidates.length > MOST_HEAVY * 40) {
          candidates.sort((a, b) => b.size - a.size).splice(MOST_HEAVY * 10)
        }
      }
    )
    candidates.sort((a, b) => b.size - a.size).splice(MOST_HEAVY * 10)
    if (!candidates.length) return []
    // Their paths, from the history of every ref: those not found are unreachable, and gc drops them
    const paths = new Map(candidates.map((c) => [c.hash, '']))
    const walk = (filter: string[]): Promise<void> =>
      eachLine(repo, ['rev-list', '--objects', '--all', ...filter], (line) => {
        const space = line.indexOf(' ')
        if (space < 0) return
        const hash = line.slice(0, space)
        if (paths.get(hash) === '') paths.set(hash, line.slice(space + 1))
      })
    // Only blobs, with git 2.32 or later
    await walk(['--filter=object:type=blob']).catch(() => walk([]))
    const head = new Map<string, string>()
    const tree = (await tryGit(repo, ['ls-tree', '-r', '-z', 'HEAD'])) ?? ''
    for (const entry of tree.split('\0')) {
      const tab = entry.indexOf('\t')
      if (tab > 0) head.set(entry.slice(tab + 1), entry.slice(0, tab).split(' ')[2])
    }
    return candidates
      .filter((c) => paths.get(c.hash))
      .slice(0, MOST_HEAVY)
      .map((c): HeavyObject => {
        const path = paths.get(c.hash) as string
        const now = head.get(path)
        return { ...c, path, state: now === c.hash ? 'current' : now ? 'older' : 'deleted' }
      })
  },

  async maintain(repo, task) {
    if (task === 'gc') {
      await runGit(repo, ['gc', '--quiet'])
      return []
    }
    if (task === 'prune') {
      // Unreachable objects older than two weeks, as gc does: newer ones may still be wanted back
      await runGit(repo, ['prune'])
      await runGit(repo, ['worktree', 'prune'])
      return []
    }
    if (task !== 'fsck') throw new Error(`Unknown maintenance: ${task}`)
    // Problems make fsck exit with a non-zero code: they are the result, not a failure
    const output = await runGit(repo, ['fsck', '--no-dangling', '--no-progress'], {
      withStderr: true,
      okExitCodes: Array.from({ length: 255 }, (_, i) => i + 1)
    })
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('notice:') && !line.startsWith('Checking'))
  },

  async bisectStart(repo, bad, good) {
    await assertIdle(repo)
    if (await bisecting(repo)) throw new Error('A bisect is already in progress: stop it first')
    // Bisect checks out other commits: the changes would follow, or stop it halfway
    if ((await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).trim())
      throw new Error('Commit or stash your changes first: bisect checks out other commits')
    const revs = [bad, ...(good ? [good] : [])]
    for (const rev of revs) await assertCommit(repo, rev)
    await runGit(repo, ['bisect', 'start', ...revs, '--'])
  },

  async bisectMark(repo, mark, hash) {
    if (!['good', 'bad', 'skip'].includes(mark)) throw new Error(`Unknown mark: ${String(mark)}`)
    if (!(await bisecting(repo))) throw new Error('No bisect in progress')
    if (hash !== null) await assertCommit(repo, hash)
    try {
      await runGit(repo, ['bisect', mark, ...(hash ? [hash] : [])])
    } catch (e) {
      // Not a failure: the bisect is over, the first bad commit is one of the skipped ones
      if (e instanceof GitError && /only 'skip'ped commits left/.test(e.stderr)) return
      throw e
    }
  },

  async bisectRun(repo, command) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('No command to run')
    if (!(await bisecting(repo))) throw new Error('No bisect in progress')
    // git quotes each argument for the shell: eval reads the command as typed
    const output = await runGit(repo, ['bisect', 'run', 'eval', command.trim()], {
      withStderr: true
    })
    return output.trim().split('\n').slice(-200).join('\n')
  },

  async bisectReset(repo) {
    await runGit(repo, ['bisect', 'reset'])
  },

  async repoSummary(repo) {
    if (!(await exists(repo))) throw new Error('The folder is gone')
    const [status, last, stashes, operation] = await Promise.all([
      runGit(repo, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal']),
      tryGit(repo, ['log', '-1', '--format=%ct%x1f%s']),
      tryGit(repo, ['rev-list', '--walk-reflogs', '--count', 'refs/stash']),
      readOperation(repo)
    ])
    const summary: RepoSummary = {
      branch: null,
      head: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicts: 0,
      stashes: Number(stashes?.trim()) || 0,
      lastCommit: null,
      operation
    }
    for (const line of status.split('\n')) {
      if (line.startsWith('# branch.head '))
        summary.branch = line.slice(14) === '(detached)' ? null : line.slice(14)
      else if (line.startsWith('# branch.oid ')) {
        const oid = line.slice(13)
        summary.head = oid === '(initial)' ? null : oid.slice(0, 7)
      } else if (line.startsWith('# branch.upstream ')) summary.upstream = line.slice(18)
      else if (line.startsWith('# branch.ab ')) {
        const [ahead, behind] = line.slice(12).split(' ')
        summary.ahead = Math.abs(Number(ahead))
        summary.behind = Math.abs(Number(behind))
      } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        if (line[2] !== '.') summary.staged++
        if (line[3] !== '.') summary.unstaged++
      } else if (line.startsWith('u ')) summary.conflicts++
      else if (line.startsWith('? ')) summary.untracked++
    }
    if (last?.trim()) {
      const [date, ...subject] = last.trim().split('\x1f')
      summary.lastCommit = { date: Number(date), subject: subject.join('\x1f') }
    }
    return summary
  },

  async setIdentity(repo, name, email, scope) {
    for (const [value, what] of [
      [name, 'name'],
      [email, 'email']
    ]) {
      if (!value.trim() || /[\0\n]/.test(value)) throw new Error(`Invalid ${what}: ${value}`)
    }
    await runGit(repo, ['config', `--${scope}`, 'user.name', name.trim()])
    await runGit(repo, ['config', `--${scope}`, 'user.email', email.trim()])
  },

  async clearLocalIdentity(repo) {
    // Exit code 5: the key was not set
    for (const key of ['user.name', 'user.email']) {
      await runGit(repo, ['config', '--local', '--unset-all', key], { okExitCodes: [5] })
    }
  },

  async setSigning(repo, signing, scope) {
    if (!['openpgp', 'ssh', 'x509'].includes(signing.format)) {
      throw new Error(`Invalid signature format: ${String(signing.format)}`)
    }
    const key = signing.key?.trim() ?? ''
    if (key.startsWith('-') || /[\0\n]/.test(key)) throw new Error(`Invalid signing key: ${key}`)
    const set = (name: string, value: string): Promise<string> =>
      runGit(repo, ['config', `--${scope}`, name, value])
    await set('gpg.format', signing.format)
    if (key) await set('user.signingkey', key)
    else {
      await runGit(repo, ['config', `--${scope}`, '--unset-all', 'user.signingkey'], {
        okExitCodes: [5]
      })
    }
    await set('commit.gpgsign', String(signing.commits))
    await set('tag.gpgsign', String(signing.tags))
  }
}
