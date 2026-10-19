import { describe, expect, it } from 'vitest'
import type { RepoStatistics } from '../../shared/types'
import type { TimelapseFrames } from '../git/timelapse'
import { inWorker, startTask } from './run'

const blob = (oid: string, text: string): string =>
  `${oid} blob ${Buffer.byteLength(text)}\n${text}\n`

describe('tasks', () => {
  it('run in this process in the unit tests', () => {
    expect(inWorker()).toBe(false)
  })

  it('compute a time-lapse from the versions git read', async () => {
    const batch = Buffer.from(blob('b2', 'one\ntwo\n') + blob('b1', 'one\n'))
    const frames = await startTask<TimelapseFrames>({
      task: 'timelapse',
      input: {
        path: 'f.txt',
        commits: [
          { hash: 'c2', parents: ['c1'] },
          { hash: 'c1', parents: [] }
        ],
        batch,
        onDisk: Buffer.from('one\ntwo\nthree\n')
      }
    }).result
    expect(frames.kept).toBe(2)
    expect(frames.blobs).toEqual(['b1', 'b2'])
    expect(frames.deleted).toEqual([false, false])
    expect(frames.uncommitted).toBe(true)
    expect(frames.text).toEqual(['one', 'two', 'three'])
    expect(frames.frames.map((f) => [...f])).toEqual([[0], [0, 1], [0, 1, 2]])
  })

  it('fail with the reason the computation gives', async () => {
    const task = startTask({
      task: 'timelapse',
      input: { path: 'f.txt', commits: [], batch: Buffer.alloc(0), onDisk: null }
    })
    await expect(task.result).rejects.toThrow('f.txt has no history on this branch')
  })

  it('sum up statistics sent in chunks, with progress', async () => {
    const progress: number[] = []
    const task = startTask<RepoStatistics>(
      { task: 'statistics' },
      { onProgress: (commits) => progress.push(commits) }
    )
    const log =
      '\x1eAda\x1fada@example.com\x1f1790000000\x1f2026-09-21 10:00:00 +0200\x1f\n\n3\t1\tapp.js\0'
    for (let i = 0; i < log.length; i += 5)
      task.send({ kind: 'chunk', chunk: Buffer.from(log.slice(i, i + 5)) })
    task.send({ kind: 'end', tree: '100644 blob abc 120\tapp.js\0' })
    const stats = await task.result
    expect(stats.commits).toBe(1)
    expect(stats.authors[0]).toMatchObject({ name: 'Ada', commits: 1 })
    expect(progress.length).toBeGreaterThan(0)
  })

  it('stop when cancelled', async () => {
    const controller = new AbortController()
    const task = startTask({ task: 'statistics' }, { signal: controller.signal })
    controller.abort()
    await expect(task.result).rejects.toThrow('Cancelled')
  })
})
