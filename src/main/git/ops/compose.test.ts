import { describe, expect, it } from 'vitest'
import type { OpName } from '../../../shared/api'
import { runOp } from '../operations'
import { branchesOps } from './branches'
import { cleanOps } from './clean'
import { commitOps } from './commit'
import { contentOps } from './content'
import { hooksOps } from './hooks'
import { logOps } from './log'
import { maintenanceOps } from './maintenance'
import { mergeOps } from './merge'
import { patchesOps } from './patches'
import { remoteOps } from './remote'
import { workingTreeOps } from './workingTree'

const modules = {
  branchesOps,
  cleanOps,
  commitOps,
  contentOps,
  hooksOps,
  logOps,
  maintenanceOps,
  mergeOps,
  patchesOps,
  remoteOps,
  workingTreeOps
}

describe('operation modules', () => {
  it('define each operation once', () => {
    const owners = new Map<string, string[]>()
    for (const [module, ops] of Object.entries(modules)) {
      for (const name of Object.keys(ops)) owners.set(name, [...(owners.get(name) ?? []), module])
    }
    expect([...owners].filter(([, mods]) => mods.length > 1)).toEqual([])
    for (const ops of Object.values(modules)) {
      for (const impl of Object.values(ops)) expect(typeof impl).toBe('function')
    }
  })

  it('reject unknown and inherited operation names', async () => {
    for (const name of ['nope', 'toString', '__proto__']) {
      await expect(runOp('.', name as OpName, [] as never)).rejects.toThrow(
        `Unknown operation: ${name}`
      )
    }
  })
})
