import { describe, expect, it } from 'vitest'
import type { OpProgress } from '../../shared/api'
import { collapseProgress } from './exec'
import {
  PUSH_PHASES,
  parseProgress,
  progressReader,
  reportProgress,
  withProgress
} from './progress'

describe('parseProgress', () => {
  it('maps each push phase onto its share of the bar', () => {
    expect(parseProgress('Counting objects: 100% (5/5), done.', PUSH_PHASES)).toEqual({
      phase: 'Counting objects',
      percent: 5
    })
    expect(parseProgress('Compressing objects:  50% (2/4)', PUSH_PHASES)?.percent).toBe(18)
    expect(parseProgress('remote: Resolving deltas: 100% (2/2), completed', PUSH_PHASES)).toEqual({
      phase: 'Resolving deltas',
      percent: 100
    })
  })

  it('reads the amount sent and the speed', () => {
    expect(
      parseProgress('Writing objects:  45% (9/20), 1.20 MiB | 500.00 KiB/s', PUSH_PHASES)
    ).toEqual({ phase: 'Writing objects', percent: 57, transfer: '1.20 MiB, 500.00 KiB/s' })
    expect(
      parseProgress('Writing objects: 100% (3/3), 300 bytes | 300.00 KiB/s, done.', PUSH_PHASES)
    ).toEqual({ phase: 'Writing objects', percent: 90, transfer: '300 bytes, 300.00 KiB/s' })
  })

  it('keeps phases it does not know, without a percentage', () => {
    expect(parseProgress('Something new: 40% (4/10)', PUSH_PHASES)).toEqual({
      phase: 'Something new',
      percent: null
    })
  })

  it('ignores lines that are not progress', () => {
    expect(parseProgress('Enumerating objects: 5, done.', PUSH_PHASES)).toBeNull()
    expect(parseProgress('To github.com:me/app.git', PUSH_PHASES)).toBeNull()
    expect(parseProgress('   abc123..def456  main -> main', PUSH_PHASES)).toBeNull()
  })
})

describe('progressReader', () => {
  it('reads lines rewritten with \\r across chunks, once per state', () => {
    const seen: OpProgress[] = []
    const read = progressReader(PUSH_PHASES, (p) => seen.push(p))
    read('Writing objects:  50% (1/2)\rWriting objects:  50')
    read('% (1/2)\rWriting objects: 100% (2/2), done.\n')
    expect(seen.map((p) => p.percent)).toEqual([60, 90])
  })
})

describe('withProgress', () => {
  it('sends what the operations report to the receiver of the scope they run in', async () => {
    const seen: string[] = []
    reportProgress({ phase: 'nobody listens', percent: 1 })
    await withProgress(
      (p) => seen.push(p.phase),
      async () => {
        await Promise.resolve()
        reportProgress({ phase: 'Writing objects', percent: 50 })
      }
    )
    expect(seen).toEqual(['Writing objects'])
  })
})

describe('collapseProgress', () => {
  it('keeps the last state of each line rewritten in place', () => {
    expect(collapseProgress('Writing objects:  50%\rWriting objects: 100%, done.\nTo x\n')).toBe(
      'Writing objects: 100%, done.\nTo x\n'
    )
    expect(collapseProgress('line\r\nnext')).toBe('line\nnext')
  })
})
