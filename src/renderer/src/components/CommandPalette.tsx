import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { buildCommands, type Command } from '../commands'
import { fuzzyFilter } from '../fuzzy'
import { fromTerminal, useUi } from '../ui'

const MAX_RESULTS = 100

/** The text with the matched characters in bold. */
function Highlighted({
  text,
  positions
}: {
  text: string
  positions: number[]
}): React.JSX.Element {
  const marked = new Set(positions)
  return <>{text.split('').map((ch, i) => (marked.has(i) ? <b key={i}>{ch}</b> : ch))}</>
}

function Palette(): React.JSX.Element {
  const close = (): void => useUi.setState({ palette: false })
  const [commands] = useState(buildCommands)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    // Commits only when searching: there are too many to browse
    const pool = query.trim() ? commands : commands.filter((c) => c.group !== 'Commit')
    return fuzzyFilter(query, pool, (c) => c.title).slice(0, MAX_RESULTS)
  }, [commands, query])

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const runCommand = (command: Command | undefined): void => {
    if (!command) return
    close()
    command.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((active + step + results.length) % Math.max(results.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runCommand(results[active]?.item)
    }
  }

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-search">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Type a command, a branch or a commit message…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No matching commands</div>}
          {results.map(({ item, match }, i) => (
            <button
              key={`${item.group}:${item.title}:${item.hint ?? ''}`}
              className={`palette-item${i === active ? ' active' : ''}`}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => runCommand(item)}
            >
              <span className="palette-group">{item.group}</span>
              <span className="palette-title">
                <Highlighted text={item.title} positions={match.positions} />
              </span>
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function CommandPalette(): React.JSX.Element | null {
  const open = useUi((s) => s.palette)

  // Ctrl+P or Ctrl+Shift+P
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // In the terminal Ctrl+P is the shell's (previous command): only Ctrl+Shift+P opens the palette
      if (
        e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'p' &&
        (e.shiftKey || !fromTerminal(e))
      ) {
        e.preventDefault()
        useUi.setState((s) => ({ palette: !s.palette, menu: null }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Remounted at each opening: the commands reflect the state at that moment
  return open ? <Palette /> : null
}
