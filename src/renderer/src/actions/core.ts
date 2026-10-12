// The core of the user-facing actions: run operations, report failures and outcomes.
import type { OpArgs, OpName, OpOutcome, OpResult, Result } from '../../../shared/api'
import type { RepoSnapshot } from '../../../shared/types'
import { useApp } from '../store'
import { notify } from '../ui'
import { tipAfter } from '../tips'

export function call<K extends OpName>(
  repo: string,
  name: K,
  ...args: OpArgs<K>
): Promise<Result<OpResult<K>>> {
  return window.api.op(repo, name, ...args).then((result) => {
    if (result.ok) tipAfter(name)
    return result
  })
}

export function fail(result: { error: string; details?: string }): void {
  notify('error', result.error, result.details)
}

/**
 * Runs an operation, reports failures and refreshes the repository afterwards.
 * Resolves with the value, or undefined when the operation failed: only for operations returning
 * a value, since void operations resolve undefined either way.
 */
export async function runValue<K extends OpName>(
  repo: string,
  name: K,
  ...args: OpArgs<K>
): Promise<OpResult<K> | undefined> {
  const result = await call(repo, name, ...args)
  void useApp.getState().refreshPath(repo)
  if (!result.ok) {
    fail(result)
    return undefined
  }
  return result.value
}

/** Like runValue, resolving whether the operation succeeded. */
export async function run<K extends OpName>(
  repo: string,
  name: K,
  ...args: OpArgs<K>
): Promise<boolean> {
  const result = await call(repo, name, ...args)
  void useApp.getState().refreshPath(repo)
  if (!result.ok) fail(result)
  return result.ok
}

/** Like run, with a busy indicator for slow network operations. */
export async function runBusy<K extends OpName>(
  repo: string,
  label: string,
  name: K,
  ...args: OpArgs<K>
): Promise<Result<OpResult<K>>> {
  const { setBusy, refreshPath } = useApp.getState()
  setBusy(repo, label)
  try {
    return await call(repo, name, ...args)
  } finally {
    setBusy(repo, undefined)
    void refreshPath(repo)
  }
}

/** The loaded snapshot of an open repository. */
export const snapshotOf = (repo: string): RepoSnapshot | undefined =>
  useApp.getState().tabs.find((t) => t.path === repo)?.snapshot

export const copy = (text: string): void => {
  void navigator.clipboard.writeText(text)
  notify('info', `Copied "${text.length > 40 ? text.slice(0, 40) + '…' : text}"`)
}

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** Reports an operation that may have stopped on conflicts. */
export function reportOutcome(outcome: OpOutcome, what: string, done: string): void {
  if (!outcome.conflicts) notify('success', done, outcome.output)
  else if (/autostash resulted in conflicts/i.test(outcome.output)) {
    notify(
      'warning',
      `${what} done, but your local changes conflict with it: resolve the conflicted files (your changes are also kept in a stash)`,
      outcome.output
    )
  } else {
    notify(
      'warning',
      `${what} stopped on conflicts: resolve the conflicted files, then continue`,
      outcome.output
    )
  }
}

/** Runs an operation that may stop on conflicts, reporting its outcome. */
export async function runOutcome<K extends OpName>(
  repo: string,
  what: string,
  done: string,
  name: K,
  ...args: OpArgs<K>
): Promise<OpOutcome | undefined> {
  const result = await runBusy(repo, `${what}…`, name, ...args)
  if (!result.ok) {
    fail(result)
    return undefined
  }
  const outcome = result.value as OpOutcome
  reportOutcome(outcome, what, done)
  return outcome
}
