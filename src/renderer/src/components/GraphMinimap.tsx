// Scrollbar of the commit graph with markers for the selection, HEAD and search matches (GRAPH-16).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTheme } from '../theme'

export interface MinimapMarker {
  row: number
  /** CSS variable holding the colour, e.g. --accent */
  color: string
}

interface Props {
  rows: number
  rowHeight: number
  scrollTop: number
  viewportHeight: number
  markers: MinimapMarker[]
  onScroll(top: number): void
}

export default function GraphMinimap({
  rows,
  rowHeight,
  scrollTop,
  viewportHeight,
  markers,
  onScroll
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const theme = useTheme((s) => s.applied)
  const [height, setHeight] = useState(0)

  const total = Math.max(rows * rowHeight, viewportHeight, 1)
  const scale = height / total

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => setHeight(canvas.clientHeight))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || height === 0) return
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const style = getComputedStyle(canvas)
    ctx.fillStyle = style.getPropertyValue('--text-muted')
    ctx.globalAlpha = 0.18
    ctx.fillRect(2, scrollTop * scale, width - 4, Math.max(viewportHeight * scale, 12))
    ctx.globalAlpha = 1

    // Later markers win: the caller lists the most important last
    for (const marker of markers) {
      ctx.fillStyle = style.getPropertyValue(marker.color)
      const y = (marker.row * rowHeight + rowHeight / 2) * scale
      ctx.fillRect(3, Math.min(height - 3, Math.max(0, y - 1.5)), width - 6, 3)
    }
    // Colours follow the theme
  }, [markers, scrollTop, viewportHeight, scale, height, rowHeight, theme])

  // Clicking centres the view on that spot; dragging keeps scrolling
  const start = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0 || scale === 0) return
    e.preventDefault()
    const top = e.currentTarget.getBoundingClientRect().top
    const scrollTo = (clientY: number): void =>
      onScroll((clientY - top) / scale - viewportHeight / 2)
    scrollTo(e.clientY)
    const onMove = (m: MouseEvent): void => scrollTo(m.clientY)
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return <canvas ref={canvasRef} className="graph-minimap" onMouseDown={start} />
}
