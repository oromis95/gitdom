// Optional columns of the graph (GRAPH-03) fitted to the window: when the commit message would get
// too narrow to read, the other columns make room for it, narrower than set or hidden.

export type Column = 'refs' | 'sha' | 'author' | 'date'

/** Width of each optional column, 0 for one not shown */
export type ColumnWidths = Record<Column, number>

/** Narrowest and widest a column can be set to, by dragging its edge */
export const GRAPH_COLUMN_WIDTH = { min: 60, max: 600 }

/** Narrowest the commit message gets while other columns can make room: about 25 characters */
export const MESSAGE_MIN = 200

/**
 * Who makes room for the message, in turn, and down to which width: the branch labels narrow
 * first, then the SHA, the author and the date narrow and hide, the labels narrow last.
 */
const MAKE_ROOM: { column: Column; floor: number }[] = [
  { column: 'refs', floor: 100 },
  { column: 'sha', floor: 70 },
  { column: 'author', floor: 80 },
  // Narrower, the day itself wouldn't show
  { column: 'date', floor: 100 },
  { column: 'refs', floor: GRAPH_COLUMN_WIDTH.min }
]

/**
 * The widths `set` for the columns, narrowed where `room`, the width beside the lanes, leaves
 * the message less than MESSAGE_MIN. A column that would get narrower than its floor hides,
 * except the branch labels, which show where each branch is.
 */
export function fitColumns(set: ColumnWidths, room: number): ColumnWidths {
  const fitted = { ...set }
  let missing = set.refs + set.sha + set.author + set.date + MESSAGE_MIN - room
  for (const { column, floor } of MAKE_ROOM) {
    if (missing <= 0) break
    const width = fitted[column]
    const hides = column !== 'refs'
    if (width === 0 || (!hides && width <= floor)) continue
    const narrower = width - missing >= floor ? width - missing : hides ? 0 : floor
    fitted[column] = narrower
    missing -= width - narrower
  }
  return fitted
}
