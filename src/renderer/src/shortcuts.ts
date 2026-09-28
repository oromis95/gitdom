// Keyboard shortcuts (UI-03): every one in a single list, with the user's changes on top of the
// defaults. One listener on the window dispatches them to whichever component handles them now.
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { MenuShortcuts } from '../../shared/api'
import {
  comboOf,
  displayCombo,
  shellKey,
  SHORTCUTS,
  type ShortcutDef,
  type ShortcutId
} from './keys'

export { SHORTCUTS, type ShortcutDef, type ShortcutId }

const DEFS = new Map(SHORTCUTS.map((s) => [s.id, s]))
const KEY = 'gitdom.shortcuts'

export { comboOf, displayCombo }

// --- The user's bindings ----------------------------------------------------------------------

type Overrides = Partial<Record<ShortcutId, string[]>>

function savedOverrides(): Overrides {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!value || typeof value !== 'object') return {}
    const result: Overrides = {}
    for (const [id, keys] of Object.entries(value)) {
      if (DEFS.has(id as ShortcutId) && Array.isArray(keys))
        result[id as ShortcutId] = keys.filter((k): k is string => typeof k === 'string')
    }
    return result
  } catch {
    return {}
  }
}

interface ShortcutState {
  overrides: Overrides
}

export const useShortcuts = create<ShortcutState>(() => ({ overrides: savedOverrides() }))

export function keysOf(id: ShortcutId, overrides = useShortcuts.getState().overrides): string[] {
  return overrides[id] ?? DEFS.get(id)?.keys ?? []
}

/** The first key of a shortcut, as shown in hints; '' when it has none. */
export function shortcutLabel(id: ShortcutId): string {
  const [first] = keysOf(id)
  return first ? displayCombo(first) : ''
}

/** Like shortcutLabel, updated when the user changes the shortcut. */
export function useShortcutLabel(id: ShortcutId): string {
  const keys = useShortcuts((s) => s.overrides[id])
  const first = (keys ?? DEFS.get(id)?.keys ?? [])[0]
  return first ? displayCombo(first) : ''
}

/** " (Ctrl+Z)" for a tooltip, or nothing when the shortcut has no key. */
export function withShortcut(text: string, id: ShortcutId): string {
  const label = shortcutLabel(id)
  return label ? `${text} (${label})` : text
}

function save(overrides: Overrides): void {
  localStorage.setItem(KEY, JSON.stringify(overrides))
  useShortcuts.setState({ overrides })
  sendToMenu()
}

export function setShortcutKeys(id: ShortcutId, keys: string[]): void {
  const { overrides } = useShortcuts.getState()
  const defaults = DEFS.get(id)?.keys ?? []
  const next = { ...overrides }
  if (keys.length === defaults.length && keys.every((k, i) => k === defaults[i])) delete next[id]
  else next[id] = keys
  save(next)
}

/** Gives a key to a shortcut, taking it from any other that had it. */
export function assignKey(id: ShortcutId, combo: string): void {
  const { overrides } = useShortcuts.getState()
  for (const other of SHORTCUTS) {
    if (other.id !== id && keysOf(other.id, overrides).includes(combo))
      setShortcutKeys(
        other.id,
        keysOf(other.id).filter((k) => k !== combo)
      )
  }
  const keys = keysOf(id)
  if (!keys.includes(combo)) setShortcutKeys(id, [...keys, combo])
}

export function resetShortcut(id: ShortcutId): void {
  const next = { ...useShortcuts.getState().overrides }
  delete next[id]
  save(next)
}

export function resetAllShortcuts(): void {
  save({})
}

/** Whether a key press is one of a shortcut's keys: for keys handled by one field, like commit. */
export function matches(e: KeyboardEvent | React.KeyboardEvent, id: ShortcutId): boolean {
  const combo = comboOf('nativeEvent' in e ? e.nativeEvent : e)
  return !!combo && keysOf(id).includes(combo)
}

/** The shortcut a key belongs to, if any. */
export function shortcutFor(combo: string): ShortcutDef | undefined {
  const { overrides } = useShortcuts.getState()
  return SHORTCUTS.find((s) => keysOf(s.id, overrides).includes(combo))
}

// --- Dispatch ---------------------------------------------------------------------------------

/** Returns false when it has nothing to do now: the key then goes on as usual. */
type Handler = (e: KeyboardEvent) => boolean | void

const handlers = new Map<ShortcutId, Handler[]>()
/** Set while Preferences records a key: shortcuts wait */
let recording = false

export function setRecording(on: boolean): void {
  recording = on
}

/** Handles a shortcut while the component is shown; the last one mounted goes first. */
export function useShortcut(id: ShortcutId, handler: Handler, enabled = true): void {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    const call: Handler = (e) => ref.current(e)
    handlers.set(id, [call, ...(handlers.get(id) ?? [])])
    return () => {
      handlers.set(
        id,
        (handlers.get(id) ?? []).filter((h) => h !== call)
      )
    }
  }, [id, enabled])
}

const inTerminal = (e: KeyboardEvent): boolean =>
  e.target instanceof Element && e.target.closest('.terminal-dock') !== null

/** For the terminal: whether a key press is one of the app's, to keep it from the shell. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  const combo = comboOf(e)
  if (!combo || shellKey(combo)) return false
  return !!shortcutFor(combo)?.terminal
}

function dispatch(e: KeyboardEvent): void {
  if (recording || e.defaultPrevented) return
  const combo = comboOf(e)
  if (!combo) return
  const { overrides } = useShortcuts.getState()
  for (const def of SHORTCUTS) {
    if (!keysOf(def.id, overrides).includes(combo)) continue
    if (inTerminal(e) && (!def.terminal || shellKey(combo))) continue
    for (const handler of handlers.get(def.id) ?? []) {
      if (handler(e) !== false) {
        e.preventDefault()
        return
      }
    }
  }
}

window.addEventListener('keydown', dispatch)

// --- The native menu ----------------------------------------------------------------------------

/** Electron's name for a key combination, when it has one. */
function accelerator(combo: string | undefined): string | null {
  if (!combo) return null
  const key = combo.split('+').pop() ?? ''
  const valid =
    /^([A-Z0-9]|F\d{1,2}|Plus|Space|Tab|Backspace|Delete|Insert|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Esc|[`\-=[\];',./\\])$/
  return valid.test(key) ? combo : null
}

/** The menu shows the shortcuts but leaves them to the renderer, which knows about the user's. */
function sendToMenu(): void {
  const first = (id: ShortcutId): string | null => accelerator(keysOf(id)[0])
  const shortcuts: MenuShortcuts = {
    open: first('openRepo'),
    preferences: first('preferences'),
    zoomIn: first('zoomIn'),
    zoomOut: first('zoomOut'),
    zoomReset: first('zoomReset'),
    activity: first('activity')
  }
  window.api.menu.setShortcuts(shortcuts)
}

sendToMenu()
