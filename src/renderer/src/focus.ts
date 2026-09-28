// Keyboard navigation in lists (NFR-09): arrow keys move the focus between the rows.

/** The rows of a list that can take the focus, in order. */
function rowsIn(container: Element, selector: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => el.offsetParent !== null
  )
}

/**
 * Moves the focus with ArrowUp/Down, Home and End among the rows matching `selector` inside
 * `container`. Returns whether the key was one of them.
 */
export function moveFocus(
  e: React.KeyboardEvent,
  container: Element | null,
  selector: string
): boolean {
  if (!container || e.ctrlKey || e.altKey || e.metaKey) return false
  const step =
    e.key === 'ArrowDown'
      ? 1
      : e.key === 'ArrowUp'
        ? -1
        : e.key === 'Home' || e.key === 'End'
          ? 0
          : null
  if (step === null) return false
  const rows = rowsIn(container, selector)
  if (rows.length === 0) return false
  const current = rows.findIndex(
    (r) => r === document.activeElement || r.contains(document.activeElement)
  )
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? rows.length - 1
        : current < 0
          ? 0
          : Math.min(rows.length - 1, Math.max(0, current + step))
  e.preventDefault()
  rows[next].focus()
  rows[next].scrollIntoView({ block: 'nearest' })
  return true
}

/** After the focused row goes away (a staged file), puts the focus on the one now in its place. */
export function refocusRow(container: Element | null, selector: string, index: number): void {
  const from = document.activeElement
  let tries = 30
  const check = (): void => {
    if (!container?.isConnected) return
    const focused = document.activeElement
    if (focused === from && from?.isConnected) {
      if (--tries > 0) setTimeout(check, 100)
      return
    }
    // The user went elsewhere meanwhile
    if (focused && focused !== document.body) return
    const rows = rowsIn(container, selector)
    rows[Math.min(index, rows.length - 1)]?.focus()
  }
  setTimeout(check, 100)
}

/** The position of the row holding the focus, or -1. */
export function focusedRow(container: Element | null, selector: string): number {
  if (!container) return -1
  return rowsIn(container, selector).findIndex(
    (r) => r === document.activeElement || r.contains(document.activeElement)
  )
}

export type Panel = 'sidebar' | 'graph' | 'detail'

/** Puts the focus in a panel: its selected row when it has one, otherwise its first. */
export function focusPanel(panel: Panel): boolean {
  const root = document.querySelector<HTMLElement>(
    panel === 'sidebar' ? '.sidebar' : panel === 'graph' ? '.graph-scroller' : '.detail'
  )
  if (!root) return false
  if (panel === 'graph') {
    root.focus()
    return true
  }
  const target =
    panel === 'sidebar'
      ? (root.querySelector<HTMLElement>('.sidebar-scroll button.tree-item.current') ??
        root.querySelector<HTMLElement>('.sidebar-scroll button'))
      : (root.querySelector<HTMLElement>('.file-row.active') ??
        root.querySelector<HTMLElement>('.file-row') ??
        root.querySelector<HTMLElement>('textarea, input, button'))
  ;(target ?? root).focus()
  return true
}

/** Whether a key press asks for the context menu: the menu key or Shift+F10. */
export function isMenuKey(e: React.KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.altKey)
}

/** Opens an element's context menu as a right click beside it would. */
export function openMenuOf(el: HTMLElement): void {
  const box = el.getBoundingClientRect()
  el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + Math.min(40, box.width / 2),
      clientY: box.bottom - 2
    })
  )
}

/**
 * Keys of a list whose rows are buttons: arrows move, Enter does what a double click does (a
 * checkout, an apply) after the click, and the menu key opens the row's menu.
 */
export function listKeys(
  e: React.KeyboardEvent,
  container: Element | null,
  selector: string
): void {
  if (moveFocus(e, container, selector)) return
  const row = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(selector) : null
  if (!row || row !== e.target) return
  if (isMenuKey(e)) {
    e.preventDefault()
    openMenuOf(row)
  } else if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault()
    row.click()
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  }
}
