// Assigns every commit to a lane (column) and computes the line segments to draw in each row.
//
// Commits arrive newest first. We keep `lanes`: for each column, the commit that the line
// currently running through it is heading to. When that commit is reached, every lane heading
// to it converges into the commit's node; then its parents take over the lanes below.

export interface LayoutInput {
  hash: string
  parents: string[]
  /** Draw this node and the lines leaving it dashed (used for the WIP pseudo-commit). */
  dashed?: boolean
}

export interface Segment {
  from: number
  to: number
  /**
   * top: from the row's top edge (lane `from`) to the node (lane `to`)
   * bottom: from the node (lane `from`) to the row's bottom edge (lane `to`)
   * full: straight pass-through from top to bottom in lane `from`
   */
  kind: 'top' | 'bottom' | 'full'
  /** Lane index that determines the color */
  color: number
  dashed: boolean
}

export interface GraphRow {
  lane: number
  isMerge: boolean
  dashed: boolean
  segments: Segment[]
}

export interface GraphLayout {
  rows: GraphRow[]
  laneCount: number
}

interface LaneTarget {
  hash: string
  dashed: boolean
}

function firstFree(lanes: (LaneTarget | null)[]): number {
  const i = lanes.indexOf(null)
  return i < 0 ? lanes.length : i
}

export function computeLayout(commits: LayoutInput[]): GraphLayout {
  const lanes: (LaneTarget | null)[] = []
  const rows: GraphRow[] = []
  let laneCount = 0

  for (const commit of commits) {
    const before = lanes.slice()
    let lane = before.findIndex((l) => l?.hash === commit.hash)
    if (lane < 0) lane = firstFree(before)

    const segments: Segment[] = []
    before.forEach((target, j) => {
      if (!target) return
      if (target.hash === commit.hash) {
        segments.push({ from: j, to: lane, kind: 'top', color: j, dashed: target.dashed })
        lanes[j] = null
      } else {
        segments.push({ from: j, to: j, kind: 'full', color: j, dashed: target.dashed })
      }
    })

    const dashed = commit.dashed ?? false
    const [first, ...others] = commit.parents
    if (first) {
      lanes[lane] = { hash: first, dashed }
      segments.push({ from: lane, to: lane, kind: 'bottom', color: lane, dashed })
    } else {
      lanes[lane] = null
    }

    for (const parent of others) {
      let k = lanes.findIndex((l) => l?.hash === parent)
      if (k < 0) {
        k = firstFree(lanes)
        lanes[k] = { hash: parent, dashed }
      }
      segments.push({ from: lane, to: k, kind: 'bottom', color: k, dashed })
    }

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    laneCount = Math.max(laneCount, lanes.length, lane + 1)

    rows.push({ lane, isMerge: commit.parents.length > 1, dashed, segments })
  }

  return { rows, laneCount }
}
