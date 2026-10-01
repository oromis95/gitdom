// Drag handle on the edge of a panel to change its size (UI-11, SIDE-10); double-click resets it.
// On the left or right edge it sets the width, on the top edge the height.
interface Props {
  /** Edge of the panel the handle sits on */
  edge: 'left' | 'right' | 'top'
  min: number
  max: () => number
  onResize(size: number | null): void
}

export default function ResizeHandle({ edge, min, max, onResize }: Props): React.JSX.Element {
  const start = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const panel = e.currentTarget.parentElement!
    const vertical = edge === 'top'
    const startAt = vertical ? e.clientY : e.clientX
    const box = panel.getBoundingClientRect()
    const startSize = vertical ? box.height : box.width
    // Mouse positions are in CSS pixels, like the sizes: zoom needs no correction
    const onMove = (m: MouseEvent): void => {
      const delta =
        edge === 'right' ? m.clientX - startAt : startAt - (vertical ? m.clientY : m.clientX)
      onResize(Math.round(Math.min(max(), Math.max(min, startSize + delta))))
    }
    const onUp = (): void => {
      document.body.classList.remove('resizing', 'resizing-rows')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    document.body.classList.add('resizing')
    if (vertical) document.body.classList.add('resizing-rows')
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
