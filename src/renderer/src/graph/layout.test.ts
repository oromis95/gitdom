import { describe, expect, it } from 'vitest'
import { computeLayout, type LayoutInput } from './layout'

const c = (hash: string, ...parents: string[]): LayoutInput => ({ hash, parents })

describe('computeLayout', () => {
  it('keeps a linear history in a single lane', () => {
    const { rows, laneCount } = computeLayout([c('c', 'b'), c('b', 'a'), c('a')])
    expect(laneCount).toBe(1)
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    // root commit has no line leaving it
    expect(rows[2].segments.filter((s) => s.kind === 'bottom')).toEqual([])
  })

  it('opens a second lane for a merged branch and closes it at the fork point', () => {
    //   m        (merge of a2 into b1)
    //   | \
    //   b1  a2
    //   |   a1
    //   | /
    //   base
    const { rows, laneCount } = computeLayout([
      c('m', 'b1', 'a2'),
      c('b1', 'base'),
      c('a2', 'a1'),
      c('a1', 'base'),
      c('base')
    ])
    expect(laneCount).toBe(2)
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 1, 0])
    expect(rows[0].isMerge).toBe(true)
    expect(rows[0].segments).toContainEqual(
      expect.objectContaining({ kind: 'bottom', from: 0, to: 1 })
    )
    // both lanes converge into base
    const intoBase = rows[4].segments.filter((s) => s.kind === 'top')
    expect(intoBase.map((s) => [s.from, s.to])).toEqual([
      [0, 0],
      [1, 0]
    ])
  })

  it('passes unrelated lanes straight through', () => {
    const { rows } = computeLayout([c('x', 'base'), c('y', 'base'), c('base')])
    expect(rows[1].lane).toBe(1)
    expect(rows[1].segments).toContainEqual(
      expect.objectContaining({ kind: 'full', from: 0, to: 0 })
    )
  })

  it('reuses freed lanes', () => {
    const { rows, laneCount } = computeLayout([
      c('x', 'base'),
      c('y', 'base'),
      c('base', 'root'),
      c('z', 'root'),
      c('root')
    ])
    expect(rows[3].lane).toBe(1)
    expect(laneCount).toBe(2)
  })

  it('propagates the dashed flag from the WIP pseudo-commit', () => {
    const { rows } = computeLayout([{ hash: 'WIP', parents: ['h'], dashed: true }, c('h')])
    expect(rows[0].dashed).toBe(true)
    expect(rows[1].segments[0]).toMatchObject({ kind: 'top', dashed: true })
  })
})
