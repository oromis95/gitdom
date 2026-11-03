// Shared by the parts of the graph: row keys, the optional columns, the menus of the labels.
import type { RepoSnapshot } from '../../../../shared/types'
import type { GraphItem } from '../../graph/rows'
import { WIP_HASH } from '../../store'
import type { RefLabel } from '../../graph/refLabels'
import { fitColumns, type Column, type ColumnWidths } from '../../graph/columns'
import { openMenu, openMenuAt, type MenuItem } from '../../ui'
import { DEFAULT_SETTINGS, updateSettings, type Settings } from '../../settings'
import * as actions from '../../actions'

export const rowKey = (row: GraphItem): string =>
  row.kind === 'wip' ? WIP_HASH : row.kind === 'commit' ? row.commit.hash : row.stash.hash

export type WidthKey = 'graphRefsWidth' | 'graphShaWidth' | 'graphAuthorWidth' | 'graphDateWidth'
type ShowKey = 'graphShowRefs' | 'graphShowSha' | 'graphShowAuthor' | 'graphShowDate'

/** Optional columns (GRAPH-03); the graph and the message always show. */
const COLUMNS: { key: Column; title: string; width: WidthKey; show: ShowKey }[] = [
  { key: 'refs', title: 'Branch / Tag', width: 'graphRefsWidth', show: 'graphShowRefs' },
  { key: 'sha', title: 'SHA', width: 'graphShaWidth', show: 'graphShowSha' },
  { key: 'author', title: 'Author', width: 'graphAuthorWidth', show: 'graphShowAuthor' },
  { key: 'date', title: 'Date', width: 'graphDateWidth', show: 'graphShowDate' }
]

/** The columns the layout has: the list of the Mail layout, the branch labels only. */
const columnsOf = (listOnly: boolean): typeof COLUMNS =>
  listOnly ? COLUMNS.filter((c) => c.key === 'refs') : COLUMNS

/**
 * The columns shown and their widths in the window, where `room` beside the lanes is known: the
 * message keeps a readable width.
 */
export function shownColumns(s: Settings, listOnly: boolean, room?: number): ColumnWidths {
  const set: ColumnWidths = { refs: 0, sha: 0, author: 0, date: 0 }
  for (const c of columnsOf(listOnly)) if (s[c.show]) set[c.key] = s[c.width]
  return room === undefined ? set : fitColumns(set, room)
}

export function columnsMenu(
  e: React.MouseEvent,
  s: Settings,
  shown: ColumnWidths,
  listOnly: boolean
): void {
  openMenu(e, [
    ...columnsOf(listOnly).map((c): MenuItem => {
      const noRoom = s[c.show] && !shown[c.key] ? ' (no room in the window)' : ''
      return {
        label: `${s[c.show] ? 'Hide' : 'Show'} ${c.title} column${noRoom}`,
        onClick: () => updateSettings({ [c.show]: !s[c.show] })
      }
    }),
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
