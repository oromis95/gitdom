// What the scenes of the tips are drawn with: the pointer, rows of commits, lanes, labels, menus.
import { ROW, top } from './layout'

/**
 * The pointer. With a path it follows the shared timeline (assets/tips/timeline.css): it shows
 * up at the first point, clicks the second and the third, and with `three` the fourth.
 */
export function Cursor({
  path,
  three = false
}: {
  path?: [number, number][]
  three?: boolean
}): React.JSX.Element {
  const style = Object.fromEntries(
    (path ?? []).flatMap(([x, y], i) => [
      [`--x${i}`, `${x}px`],
      [`--y${i}`, `${y}px`]
    ])
  ) as React.CSSProperties
  const timeline = path ? (three ? 'ta-cur3' : 'ta-cur2') : ''
  return (
    <svg
      className={`ta-cursor ${timeline}`}
      style={style}
      width="14"
      height="19"
      viewBox="0 0 14 19"
      aria-hidden
    >
      <path d="M1 1 L1 15 L4.5 11.5 L7.5 18 L10 17 L7 10.5 L12 10.5 Z" />
    </svg>
  )
}

export function Row({
  i,
  subject,
  className = ''
}: {
  i: number
  subject: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={`ta-row ${className}`} style={{ top: top(i) }}>
      <span className="ta-dot" />
      <span className="ta-subject">{subject}</span>
    </div>
  )
}

export function Lane({ from, to }: { from: number; to: number }): React.JSX.Element {
  return <div className="ta-lane" style={{ top: top(from) + 11, height: (to - from) * ROW }} />
}

export function Label({
  i,
  name,
  className = ''
}: {
  i: number
  name: string
  className?: string
}): React.JSX.Element {
  return (
    <span className={`ta-label ${className}`} style={{ top: top(i) + 3 }}>
      {name}
    </span>
  )
}

export function Menu({
  items,
  className
}: {
  items: string[]
  className: string
}): React.JSX.Element {
  return (
    <div className={`ta-menu ${className}`}>
      {items.map((item, i) => (
        <div key={i} className={i === 0 ? 'ta-hit' : ''}>
          {item}
        </div>
      ))}
    </div>
  )
}

export function Toast({ text }: { text: string }): React.JSX.Element {
  return <div className="ta-toast">{text}</div>
}

/** Two texts in the same place, the second replacing the first for a while */
export function Swap({ a, b }: { a: string; b: string }): React.JSX.Element {
  return (
    <span className="ta-swap">
      <span className="ta-swap-a">{a}</span>
      <span className="ta-swap-b">{b}</span>
    </span>
  )
}
