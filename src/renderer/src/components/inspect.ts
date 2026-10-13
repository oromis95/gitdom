// Shared by the views of the file inspector: loading, dates and commit actions.
import { useEffect, useState } from 'react'
import type { Result } from '../../../shared/api'
import { useApp } from '../store'
import { notify } from '../ui'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
export const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
export const formatDate = (seconds: number, format = dateFormat): string =>
  format.format(new Date(seconds * 1000))

interface Loaded<T> {
  key: string
  result: Result<T>
}

/** Loads with an operation whenever `key` changes, dropping the answers to outdated requests. */
export function useLoaded<T>(key: string, load: () => Promise<Result<T>>): Result<T> | null {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  useEffect(() => {
    let cancelled = false
    void load().then((result) => {
      if (!cancelled) setLoaded({ key, result })
    })
    return () => {
      cancelled = true
    }
    // key identifies what load fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return loaded?.key === key ? loaded.result : null
}

export function copyHash(hash: string): void {
  void navigator.clipboard.writeText(hash)
  notify('info', 'Copied commit hash')
}

/** Leaves the inspector and selects the commit in the graph. */
export function showInGraph(hash: string): void {
  const { inspectFile, select } = useApp.getState()
  inspectFile(null)
  select(hash, true)
}
