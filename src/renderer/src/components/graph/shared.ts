// Shared by the parts of the graph: row keys, the optional columns, the menus of the labels.
import type { RepoSnapshot } from '../../../../shared/types'
import type { GraphItem } from '../../graph/rows'
import { WIP_HASH } from '../../store'
import type { RefLabel } from '../../graph/refLabels'
import { openMenu, openMenuAt, type MenuItem } from '../../ui'
import { DEFAULT_SETTINGS, updateSettings, type Settings } from '../../settings'
import * as actions from '../../actions'

export const rowKey = (row: GraphItem): string =>
  row.kind === 'wip' ? WIP_HASH : row.kind === 'commit' ? row.commit.hash : row.stash.hash

export type WidthKey = 'graphRefsWidth' | 'graphShaWidth' | 'graphAuthorWidth' | 'graphDateWidth'
type ShowKey = 'graphShowRefs' | 'graphShowSha' | 'graphShowAuthor' | 'graphShowDate'

/** Optional columns (GRAPH-03); the graph and the message always show. */
const COLUMNS: { title: string; width: WidthKey; show: ShowKey }[] = [
  { title: 'Branch / Tag', width: 'graphRefsWidth', show: 'graphShowRefs' },
  { title: 'SHA', width: 'graphShaWidth', show: 'graphShowSha' },
  { title: 'Author', width: 'graphAuthorWidth', show: 'graphShowAuthor' },
  { title: 'Date', width: 'graphDateWidth', show: 'graphShowDate' }
]

export function columnsMenu(e: React.MouseEvent, s: Settings): void {
  openMenu(e, [
    ...COLUMNS.map((c): MenuItem => ({
      label: `${s[c.show] ? 'Hide' : 'Show'} ${c.title} column`,
      onClick: () => updateSettings({ [c.show]: !s[c.show] })
    })),
    'separator',
    {
      label: 'Reset column widths',
      onClick: () =>
        updateSettings(Object.fromEntries(COLUMNS.map((c) => [c.width, DEFAULT_SETTINGS[c.width]])))
    }
  ])
}

/** Branch name without its refs/heads/ or refs/remotes/ prefix. */
export const branchName = (fullName: string): string =>
  fullName.replace(/^refs\/(heads|remotes)\//, '')

/** Lists the refs hidden behind "+N"; choosing one opens its own menu at the same spot. */
export function openRefsMenu(
  e: React.MouseEvent,
  snapshot: RepoSnapshot,
  labels: RefLabel[]
): void {
  const { clientX: x, clientY: y } = e
  const items = labels.flatMap((label) => {
    const ref = snapshot.refs.find((r) => r.fullName === label.key)
    return ref
      ? [{ label: label.name, onClick: () => openMenuAt(x, y, actions.refMenu(snapshot, ref)) }]
      : []
  })
  openMenu(e, items)
}
