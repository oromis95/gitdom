// Repository statistics: one pass over `git log --numstat`, read as it arrives and summed up in a
// worker thread (statsCollector.ts), so even a history of a million commits never sits in memory
// whole nor holds up the main process; the renderer only receives the totals. Languages come from
// the sizes of the files in the current version.
import type { RepoStatistics, StatisticsOptions } from '../../shared/types'
import { startTask } from '../workers/run'
import { runGit, tryGit } from './exec'

// Header of each commit: author (after .mailmap), email, time, ISO date for the time zone, parents
const FORMAT = '--format=%x1e%aN%x1f%aE%x1f%at%x1f%ai%x1f%P'

/** Statistics being computed, by repository: a new request, or closing the view, stops them. */
const running = new Map<string, AbortController>()

export async function repoStatistics(
  repo: string,
  options: StatisticsOptions,
  onProgress: (commits: number) => void
): Promise<RepoStatistics> {
  const { sinceDays, allBranches } = options
  if (sinceDays !== null && !(Number.isInteger(sinceDays) && sinceDays > 0))
    throw new Error(`Invalid period: ${sinceDays}`)

  running.get(repo)?.abort()
  const controller = new AbortController()
  running.set(repo, controller)
  // Stops the sums too, even once git is done
  const task = startTask<RepoStatistics>(
    { task: 'statistics' },
    { signal: controller.signal, onProgress }
  )
  try {
    const hasHead = (await tryGit(repo, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null
    if (hasHead || allBranches)
      await runGit(
        repo,
        [
          'log',
          '--numstat',
          '-z',
          '-M',
          FORMAT,
          ...(sinceDays ? [`--since=${sinceDays}.days`] : []),
          ...(allBranches ? ['--branches', '--remotes', '--tags'] : ['HEAD']),
          '--'
        ],
        {
          signal: controller.signal,
          onStdout: (chunk) => task.send({ kind: 'chunk', chunk })
        }
      )
    const tree = hasHead ? await runGit(repo, ['ls-tree', '-r', '-l', '-z', 'HEAD']) : ''
    task.send({ kind: 'end', tree })
    return await task.result
  } catch (e) {
    controller.abort()
    throw e
  } finally {
    if (running.get(repo) === controller) running.delete(repo)
  }
}

export function cancelStatistics(repo: string): void {
  running.get(repo)?.abort()
}
