// The timeline under the time-lapse: a tick for each version, a knob to drag, and marks for the
// anchored line (above), the search matches (below), the tags and the bookmark.
import { useEffect, useRef } from 'react'

const HEIGHT = 46
const PAD = 14
const TRACK_Y = 22

interface Props {
  count: number
  current: number
  onChange(step: number): void
  /** Steps whose version has the anchored line */
  anchor: boolean[] | null
  /** Steps the search matches */
  matches: number[]
  /** Tag names by step */
  tags: Map<number, string[]> | null
  bookmark: number | null
  /** The tooltip of a step */
  titleOf(step: number): string
}

export default function TimelapseTrack(props: Props): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)

  const xOf = (step: number, width: number): number =>
    props.count < 2 ? width / 2 : PAD + (step * (width - 2 * PAD)) / (props.count - 1)
  const stepAt = (clientX: number): number => {
    const box = canvas.current!.getBoundingClientRect()
    if (props.count < 2) return 0
    const step = Math.round(
      ((clientX - box.left - PAD) / (box.width - 2 * PAD)) * (props.count - 1)
    )
    return Math.max(0, Math.min(props.count - 1, step))
  }

  useEffect(() => {
    const el = canvas.current!
    const draw = (): void => {
      const { count, current, anchor, matches, tags, bookmark } = props
      const width = el.clientWidth
      const ratio = window.devicePixelRatio || 1
      el.width = width * ratio
      el.height = HEIGHT * ratio
      const c = el.getContext('2d')!
      c.setTransform(ratio, 0, 0, ratio, 0, 0)
      c.clearRect(0, 0, width, HEIGHT)
      const css = getComputedStyle(el)
      const color = (name: string): string => css.getPropertyValue(name).trim()
      const x = (step: number): number => xOf(step, width)
      const stepWidth = count < 2 ? 4 : Math.max(2, (width - 2 * PAD) / (count - 1))

      // The anchored line: a bar above the steps that have it
      if (anchor) {
        c.fillStyle = color('--purple')
        anchor.forEach((has, step) => {
          if (has) c.fillRect(x(step) - stepWidth / 2, 3, stepWidth, 4)
        })
      }
      c.strokeStyle = color('--border')
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(PAD, TRACK_Y)
      c.lineTo(width - PAD, TRACK_Y)
      c.stroke()
      // A tick for each version, when they fit
      if (stepWidth >= 3) {
        c.strokeStyle = color('--text-dim')
        c.lineWidth = 1
        c.beginPath()
        for (let step = 0; step < count; step++) {
          const at = Math.round(x(step)) + 0.5
          c.moveTo(at, TRACK_Y - 5)
          c.lineTo(at, TRACK_Y + 5)
        }
        c.stroke()
      }
      c.fillStyle = color('--warning-border')
      for (const step of matches) c.fillRect(x(step) - stepWidth / 2, 31, stepWidth, 4)
      const diamond = (step: number, y: number, fill: string): void => {
        c.fillStyle = fill
        c.beginPath()
        c.moveTo(x(step), y - 4)
        c.lineTo(x(step) + 4, y)
        c.lineTo(x(step), y + 4)
        c.lineTo(x(step) - 4, y)
        c.closePath()
        c.fill()
      }
      tags?.forEach((_, step) => diamond(step, 41, color('--orange')))
      if (bookmark !== null) diamond(bookmark, 11, color('--accent'))
      // The knob
      c.fillStyle = color('--accent')
      c.strokeStyle = color('--bg')
      c.lineWidth = 2
      c.beginPath()
      c.arc(x(current), TRACK_Y, 6, 0, Math.PI * 2)
      c.fill()
      c.stroke()
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(el)
    return () => observer.disconnect()
  })

  return (
    <canvas
      ref={canvas}
      className="timelapse-track"
      style={{ height: HEIGHT }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        props.onChange(stepAt(e.clientX))
      }}
      onPointerMove={(e) => {
        const step = stepAt(e.clientX)
        e.currentTarget.title = props.titleOf(step)
        if (dragging.current && step !== props.current) props.onChange(step)
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    />
  )
}
