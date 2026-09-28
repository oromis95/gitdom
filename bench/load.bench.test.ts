// Load benchmark on a big repository (NFR-02): GITDOM_BENCH=<repository path> npx vitest run bench
import { describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/main/git/repository'
import { runGit } from '../src/main/git/exec'
import { LOG_FORMAT, parseLog } from '../src/main/git/parsers'
import { computeLayout } from '../src/renderer/src/graph/layout'
import { buildRows } from '../src/renderer/src/graph/rows'

const repo = process.env.GITDOM_BENCH

const time = async <T>(label: string, run: () => Promise<T> | T): Promise<T> => {
  const start = performance.now()
  const value = await run()
  console.log(`${label}: ${Math.round(performance.now() - start)} ms`)
  return value
}

describe.runIf(!!repo)('big repository', () => {
  it('loads the snapshot and lays out the graph', { timeout: 600_000 }, async () => {
    const snapshot = await time('loadSnapshot', () => loadSnapshot(repo!))
    console.log(`commits: ${snapshot.commits.length}, truncated: ${snapshot.truncated}`)
    console.log(`IPC payload: ${(JSON.stringify(snapshot).length / 1e6).toFixed(1)} MB`)
    await time('computeLayout', () => computeLayout(snapshot.commits))
    await time('buildRows', () => buildRows(snapshot.commits, snapshot.stashes, 0))

    for (const n of [100_000, 1_000_000]) {
      const log = await time(`git log -n${n}`, () =>
        runGit(repo!, ['log', '--date-order', `-n${n}`, `--format=${LOG_FORMAT}`, '--all', '--'])
      )
      const commits = await time(`parseLog ${n}`, () => parseLog(log))
      await time(`computeLayout ${n}`, () => computeLayout(commits))
      console.log(`${n} commits as JSON: ${(JSON.stringify(commits).length / 1e6).toFixed(1)} MB`)
      expect(commits.length).toBeGreaterThan(0)
    }
    console.log(`heap used: ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB`)
  })
})
