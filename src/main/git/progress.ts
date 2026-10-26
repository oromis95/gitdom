// Progress git reports on stderr with --progress (clone, push), read into an overall percentage.
import { AsyncLocalStorage } from 'async_hooks'
import type { OpProgress } from '../../shared/api'

/** Share of the overall progress bar given to each phase git reports, in order */
export type Phases = [RegExp, number, number][]

export const CLONE_PHASES: Phases = [
  [/^(remote: )?(Enumerating|Counting|Compressing) objects/, 0, 10],
  [/^Receiving objects/, 10, 80],
  [/^Resolving deltas/, 80, 95],
  [/^(Updating files|Checking out files|Filtering content)/, 95, 100]
]

// Writing objects is the upload; compressing big files can take as long. The remote then resolves
// the deltas it received
export const PUSH_PHASES: Phases = [
  [/^Counting objects/, 0, 5],
  [/^Compressing objects/, 5, 30],
  [/^Writing objects/, 30, 90],
  [/^remote: Resolving deltas/, 90, 100]
]

const PROGRESS_RE = /^(.*?):\s+(\d{1,3})%(?:\s+\([^)]*\))?(?:,\s*([^,]*?\|[^,]*?))?(?:,|$)/

/**
 * Reads one line of git's progress output into overall progress,
 * or null for lines that aren't progress (warnings, hints, ref updates).
 */
export function parseProgress(line: string, phases: Phases): OpProgress | null {
  const match = PROGRESS_RE.exec(line.trim())
  if (!match) return null
  const phase = match[1].replace(/^remote: /, '')
  const percent = Math.min(100, Number(match[2]))
  const transfer = match[3]?.trim().replace(/\s*\|\s*/, ', ')
  const range = phases.find(([re]) => re.test(match[1]))
  const overall = range ? Math.round(range[1] + ((range[2] - range[1]) * percent) / 100) : null
  return transfer ? { phase, percent: overall, transfer } : { phase, percent: overall }
}

/**
 * An onStderr handler that calls `report` for each new progress state: git rewrites progress lines
 * in place with \r, so chunks are split on both line ends and repeated states are dropped.
 */
export function progressReader(
  phases: Phases,
  report: (progress: OpProgress) => void
): (chunk: string) => void {
  let partial = ''
  let last = ''
  return (chunk) => {
    const lines = (partial + chunk).split(/[\r\n]/)
    partial = lines.pop() ?? ''
    for (const line of lines) {
      const progress = parseProgress(line, phases)
      if (!progress) continue
      const key = `${progress.phase}:${progress.percent}:${progress.transfer ?? ''}`
      if (key === last) continue
      last = key
      report(progress)
    }
  }
}

const scope = new AsyncLocalStorage<(progress: OpProgress) => void>()

/** Runs `work` with a receiver for the progress the operations it runs report. */
export function withProgress<T>(
  report: (progress: OpProgress) => void,
  work: () => Promise<T>
): Promise<T> {
  return scope.run(report, work)
}

/** Reports progress to whoever runs the current operation; nobody may be listening. */
export function reportProgress(progress: OpProgress): void {
  scope.getStore()?.(progress)
}
