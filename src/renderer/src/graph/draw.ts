import type { GraphLayout, Segment } from './layout'
import { avatarColor, initials, laneColor } from './colors'

export const ROW_HEIGHT = 36
export const LANE_WIDTH = 22
export const GRAPH_PADDING = 16
const NODE_RADIUS = 12
const MERGE_RADIUS = 5
const LINE_WIDTH = 2

export interface NodeInfo {
  authorName: string
  authorEmail: string
}

export interface DrawParams {
  layout: GraphLayout
  nodes: (NodeInfo | null)[]
  scrollTop: number
  width: number
  height: number
  selectedRow: number
}

export function laneX(lane: number): number {
  return GRAPH_PADDING + lane * LANE_WIDTH
}

export function graphWidth(laneCount: number): number {
  return Math.min(Math.max(laneCount * LANE_WIDTH + GRAPH_PADDING * 2, 90), 420)
}

function drawSegment(ctx: CanvasRenderingContext2D, s: Segment, y0: number): void {
  const yMid = y0 + ROW_HEIGHT / 2
  const y1 = y0 + ROW_HEIGHT
  const xFrom = laneX(s.from)
  const xTo = laneX(s.to)

  ctx.strokeStyle = laneColor(s.color)
  ctx.setLineDash(s.dashed ? [4, 3] : [])
  ctx.beginPath()
  switch (s.kind) {
    case 'full':
      ctx.moveTo(xFrom, y0)
      ctx.lineTo(xFrom, y1)
      break
    case 'top':
      // Comes down its lane and bends horizontally into the node
      ctx.moveTo(xFrom, y0)
      if (xFrom === xTo) ctx.lineTo(xTo, yMid)
      else ctx.quadraticCurveTo(xFrom, yMid, xTo, yMid)
      break
    case 'bottom':
      // Leaves the node horizontally and bends down into its lane
      ctx.moveTo(xFrom, yMid)
      if (xFrom === xTo) ctx.lineTo(xTo, y1)
      else ctx.quadraticCurveTo(xTo, yMid, xTo, y1)
      break
  }
  ctx.stroke()
}

export function drawGraph(ctx: CanvasRenderingContext2D, p: DrawParams): void {
  const { layout, nodes, scrollTop, width, height } = p
  ctx.clearRect(0, 0, width, height)
  ctx.lineWidth = LINE_WIDTH
  ctx.lineCap = 'round'

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT))
  const last = Math.min(layout.rows.length - 1, Math.ceil((scrollTop + height) / ROW_HEIGHT))

  // Tinted band from each node to the right edge, highlighting the row
  for (let i = first; i <= last; i++) {
    const row = layout.rows[i]
    if (row.dashed) continue
    const y0 = i * ROW_HEIGHT - scrollTop
    ctx.globalAlpha = i === p.selectedRow ? 0.35 : 0.12
    ctx.fillStyle = laneColor(row.lane)
    ctx.fillRect(laneX(row.lane), y0 + 3, width - laneX(row.lane), ROW_HEIGHT - 6)
  }
  ctx.globalAlpha = 1

  for (let i = first; i <= last; i++) {
    const y0 = i * ROW_HEIGHT - scrollTop
    for (const s of layout.rows[i].segments) drawSegment(ctx, s, y0)
  }
  ctx.setLineDash([])

  for (let i = first; i <= last; i++) {
    const row = layout.rows[i]
    const x = laneX(row.lane)
    const y = i * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2
    const color = laneColor(row.lane)

    ctx.beginPath()
    if (row.dashed) {
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = color
      ctx.arc(x, y, NODE_RADIUS - 1, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    } else if (row.isMerge) {
      ctx.fillStyle = color
      ctx.arc(x, y, MERGE_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const node = nodes[i]
      ctx.fillStyle = color
      ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.fillStyle = node ? avatarColor(node.authorEmail) : '#444'
      ctx.arc(x, y, NODE_RADIUS - 2.5, 0, Math.PI * 2)
      ctx.fill()
      if (node) {
        ctx.fillStyle = '#fff'
        ctx.font = '600 9px "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(initials(node.authorName), x, y + 0.5)
      }
    }
  }
}
