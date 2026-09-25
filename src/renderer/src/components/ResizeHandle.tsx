// Drag handle on the edge of a panel to change its width (UI-11, SIDE-10); double-click resets it.
interface Props {
  /** Edge of the panel the handle sits on */
  edge: 'left' | 'right'
  min: number
  max: () => number
  onResize(width: number | null): void
}

export default function ResizeHandle({ edge, min, max, onResize }: Props): React.JSX.Element {
  const start = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const panel = e.currentTarget.parentElement!
    const startX = e.clientX
    const startWidth = panel.getBoundingClientRect().width
    // Mouse positions are in CSS pixels, like the widths: zoom needs no correction
    const onMove = (m: MouseEvent): void => {
      const delta = edge === 'right' ? m.clientX - startX : startX - m.clientX
      onResize(Math.round(Math.min(max(), Math.max(min, startWidth + delta))))
    }
    const onUp = (): void => {
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`resize-handle ${edge}`}
      title="Drag to resize, double-click to reset"
      onMouseDown={start}
      onDoubleClick={() => onResize(null)}
    />
  )
}
