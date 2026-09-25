// User preferences (SET-01, SET-02, SET-04): saved in localStorage and applied at startup.
// Theme, pull mode and the startup logo keep their own keys (theme.ts, actions.ts).
import { create } from 'zustand'
import type { ToolSettings } from '../../shared/api'

export interface Settings extends ToolSettings {
  /** Interface font family; empty for the default */
  uiFont: string
  /** Font of diffs, blame, the merge editor and the terminal; empty for the default */
  codeFont: string
  codeFontSize: number
  /** Zoom factor of the whole interface (UI-06) */
  zoom: number
  /** Minutes between background fetches, 0 to turn them off */
  autoFetchMinutes: number
  /** Panel widths set by dragging their edge (UI-11, SIDE-10); null for the default */
  sidebarWidth: number | null
  detailWidth: number | null
  /** Diff viewer options (DIFF-01, DIFF-04, DIFF-05) */
  diffLayout: 'unified' | 'split'
  diffWrap: boolean
  diffIgnoreWhitespace: boolean
  diffContext: number
  diffFullFile: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  uiFont: '',
  codeFont: '',
  codeFontSize: 13,
  zoom: 1,
  autoFetchMinutes: 10,
  sidebarWidth: null,
  detailWidth: null,
  diffLayout: 'unified',
  diffWrap: false,
  diffIgnoreWhitespace: false,
  diffContext: 3,
  diffFullFile: false,
  gitPath: '',
  editor: '',
  mergeTool: ''
}

export const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const CODE_FONT_SIZES = { min: 9, max: 24 }
export const DIFF_CONTEXT_MAX = 100

const SETTINGS_KEY = 'gitdom.settings'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Saved settings over the defaults, discarding values of the wrong type. */
function load(): Settings {
  let saved: Record<string, unknown> = {}
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
  } catch {
    // Unreadable: start over from the defaults
  }
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = saved[key]
    const fallback = DEFAULT_SETTINGS[key]
    const nullable = key === 'sidebarWidth' || key === 'detailWidth'
    if (typeof value === typeof fallback || (nullable && typeof value === 'number')) {
      ;(settings as Record<string, unknown>)[key] = value
    }
  }
  settings.zoom = clamp(settings.zoom, ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1])
  if (settings.diffLayout !== 'split') settings.diffLayout = 'unified'
  settings.diffContext = clamp(Math.round(settings.diffContext), 0, DIFF_CONTEXT_MAX)
  settings.codeFontSize = clamp(settings.codeFontSize, CODE_FONT_SIZES.min, CODE_FONT_SIZES.max)
  return settings
}

export const useSettings = create<Settings>(load)

/** Quotes a font family unless it's a generic one or a list the user already wrote. */
function fontStack(family: string, fallback: string): string {
  const name = family.trim()
  if (!name) return ''
  const quoted = /[,'"]/.test(name) || /^(serif|sans-serif|monospace|system-ui)$/.test(name)
  return `${quoted ? name : `'${name}'`}, ${fallback}`
}

function setVar(name: string, value: string): void {
  if (value) document.documentElement.style.setProperty(name, value)
  else document.documentElement.style.removeProperty(name)
}

function apply(s: Settings): void {
  setVar('--font-ui', fontStack(s.uiFont, 'system-ui, sans-serif'))
  setVar('--font-code', fontStack(s.codeFont, 'monospace'))
  setVar(
    '--code-size',
    s.codeFontSize === DEFAULT_SETTINGS.codeFontSize ? '' : `${s.codeFontSize}px`
  )
  setVar('--sidebar-w', s.sidebarWidth ? `${s.sidebarWidth}px` : '')
  setVar('--detail-w', s.detailWidth ? `${s.detailWidth}px` : '')
  window.api.tools.setZoom(s.zoom)
  window.api.tools.configure({ gitPath: s.gitPath, editor: s.editor, mergeTool: s.mergeTool })
}

export function updateSettings(patch: Partial<Settings>): void {
  useSettings.setState(patch)
  const next = useSettings.getState()
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  apply(next)
}

/** Steps the zoom in (+1), out (-1) or back to 100% (0). */
export function stepZoom(direction: 1 | -1 | 0): void {
  if (direction === 0) return updateSettings({ zoom: 1 })
  const current = useSettings.getState().zoom
  const next =
    direction > 0
      ? ZOOM_STEPS.find((z) => z > current + 0.001)
      : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001)
  if (next) updateSettings({ zoom: next })
}

// Space the commit graph keeps between the side panels, so its message column stays readable
const CENTER_MIN = 760

/** Widest a side panel may get next to the panel matching `other`, still leaving the graph room. */
export function roomBeside(other: string, min: number): number {
  const otherWidth = document.querySelector<HTMLElement>(other)?.offsetWidth ?? 0
  return Math.max(min, window.innerWidth - otherWidth - CENTER_MIN)
}

/** Font of code views, for components that can't read CSS variables (the terminal). */
export function codeFont(s: Settings = useSettings.getState()): { family: string; size: number } {
  return {
    family: fontStack(s.codeFont, 'monospace') || "Consolas, 'Cascadia Mono', monospace",
    size: s.codeFontSize
  }
}

apply(useSettings.getState())
