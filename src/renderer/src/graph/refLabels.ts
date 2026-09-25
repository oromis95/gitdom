import type { HeadInfo, Ref } from '../../../shared/types'

export interface RefLabel {
  key: string
  name: string
  local: boolean
  remote: boolean
  tag: boolean
  current: boolean
}

/**
 * Groups refs by commit. A local branch and its upstream pointing at the same commit
 * collapse into one label showing both the local and remote icons.
 */
export function buildRefLabels(refs: Ref[], head: HeadInfo): Map<string, RefLabel[]> {
  const byHash = new Map<string, RefLabel[]>()
  const add = (hash: string, label: RefLabel): void => {
    const list = byHash.get(hash)
    if (list) list.push(label)
    else byHash.set(hash, [label])
  }

  const remoteByName = new Map(refs.filter((r) => r.type === 'remote').map((r) => [r.name, r]))
  const mergedRemotes = new Set<string>()

  for (const ref of refs) {
    if (ref.type !== 'local') continue
    const upstream = ref.upstream ? remoteByName.get(ref.upstream) : undefined
    const merged = upstream?.hash === ref.hash
    if (merged) mergedRemotes.add(upstream.name)
    add(ref.hash, {
      key: ref.fullName,
      name: ref.name,
      local: true,
      remote: merged,
      tag: false,
      current: ref.name === head.branch
    })
  }
  for (const ref of refs) {
    if (ref.type === 'remote' && !mergedRemotes.has(ref.name)) {
      add(ref.hash, {
        key: ref.fullName,
        name: ref.name,
        local: false,
        remote: true,
        tag: false,
        current: false
      })
    } else if (ref.type === 'tag') {
      add(ref.hash, {
        key: ref.fullName,
        name: ref.name,
        local: false,
        remote: false,
        tag: true,
        current: false
      })
    }
  }

  const rank = (l: RefLabel): number => (l.current ? 0 : l.local ? 1 : l.remote ? 2 : 3)
  for (const list of byHash.values()) list.sort((a, b) => rank(a) - rank(b))
  return byHash
}
