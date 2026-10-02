// Themes (UI-05): dark / light (following the system when asked to), the layout themes (Studio,
// Focus, Mail, IDE), which also arrange the panels their own way, the built-in palettes and the
// user's own. The first ones are written in CSS; the palettes set the same CSS variables on <html>,
// over the dark or light rules.
import { create } from 'zustand'
import type { ThemeChoice, ThemeOption } from '../../shared/api'
import { setLanePalette } from './graph/colors'
import {
  isHexColor,
  laneColors,
  PALETTE_VARS,
  PRESET_THEMES,
  themeVars,
  type PaletteKey,
  type ThemeDef,
  type ThemePalette
} from './themes'

export type { ThemeChoice }
/** Colours the CSS rules follow, on <html data-theme> */
export type ThemeName = 'dark' | 'light' | 'retro' | 'matrix' | Exclude<Layout, 'classic'>
/** How the panels are arranged: each layout theme has its own, every other theme the classic one */
export type Layout = 'classic' | 'studio' | 'focus' | 'mail' | 'ide'

const LAYOUTS: ThemeName[] = ['studio', 'focus', 'mail', 'ide']
/** The themes on a light background */
export const LIGHT_THEMES: ThemeName[] = ['light', 'mail', 'retro']
/** The CSS themes in the classic layout, other than dark: their own colours and controls */
const STYLED: ThemeName[] = ['light', 'retro', 'matrix']

const THEME_KEY = 'gitdom.theme'
const CUSTOM_KEY = 'gitdom.customThemes'
const DETAIL_KEY = 'gitdom.detailHidden'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

/** The themes written in CSS, and the system one */
export const CSS_THEMES: ThemeOption[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'retro', label: 'Retro 2000 (grey bevels, like Windows 2000)' },
  { id: 'matrix', label: 'Matrix (green on black)' },
  { id: 'studio', label: 'Studio (layout: actions in a rail)' },
  { id: 'focus', label: 'Focus (layout: just the graph)' },
  { id: 'mail', label: 'Mail (layout: three columns)' },
  { id: 'ide', label: 'IDE (layout: panel at the bottom)' },
  { id: 'system', label: 'Follow the system' }
]

function validTheme(value: unknown): value is ThemeDef {
  if (!value || typeof value !== 'object') return false
  const t = value as ThemeDef
  return (
    typeof t.id === 'string' &&
    t.id.startsWith('custom-') &&
    typeof t.name === 'string' &&
    (t.base === 'dark' || t.base === 'light') &&
    !!t.palette &&
    (Object.keys(PALETTE_VARS) as PaletteKey[]).every(
      (key) => typeof t.palette[key] === 'string' && isHexColor(t.palette[key])
    )
  )
}

function savedCustom(): ThemeDef[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter(validTheme) : []
  } catch {
    return []
  }
}

function findTheme(id: ThemeChoice, custom: ThemeDef[]): ThemeDef | undefined {
  return PRESET_THEMES.find((t) => t.id === id) ?? custom.find((t) => t.id === id)
}

function saved(custom: ThemeDef[]): ThemeChoice {
  const value = localStorage.getItem(THEME_KEY) ?? 'dark'
  return CSS_THEMES.some((t) => t.id === value) || findTheme(value, custom) ? value : 'dark'
}

interface Resolved {
  /** The theme shown: 'system' becomes dark or light */
  applied: string
  base: ThemeName
  def?: ThemeDef
}

function resolve(choice: ThemeChoice, custom: ThemeDef[]): Resolved {
  if (choice === 'system') {
    const applied = systemDark.matches ? 'dark' : 'light'
    return { applied, base: applied }
  }
  if (STYLED.includes(choice as ThemeName) || LAYOUTS.includes(choice as ThemeName))
    return { applied: choice, base: choice as ThemeName }
  const def = findTheme(choice, custom)
  return def ? { applied: def.id, base: def.base, def } : { applied: 'dark', base: 'dark' }
}

interface ThemeState {
  theme: ThemeChoice
  applied: string
  base: ThemeName
  /** The user's themes */
  custom: ThemeDef[]
  /** Bumped at every change of colours, for what is drawn on canvases */
  revision: number
  layout: Layout
  /** Detail panel collapsed, in the Studio layout */
  detailHidden: boolean
  /** Focus: the sidebar drawer is open */
  sidebarOpen: boolean
  /** Focus: the detail drawer was closed while this commit was selected; another one opens it */
  detailClosedFor: string | null
}

const layoutOf = (base: ThemeName): Layout =>
  LAYOUTS.includes(base) ? (base as Exclude<Layout, 'classic'>) : 'classic'

export const useTheme = create<ThemeState>(() => {
  const custom = savedCustom()
  const theme = saved(custom)
  const { applied, base } = resolve(theme, custom)
  return {
    theme,
    applied,
    base,
    custom,
    revision: 0,
    layout: layoutOf(base),
    detailHidden: localStorage.getItem(DETAIL_KEY) === '1',
    sidebarOpen: false,
    detailClosedFor: null
  }
})

/** Every theme, as listed in the menu, the palette and Preferences. */
export function themeOptions(custom = useTheme.getState().custom): ThemeOption[] {
  return [
    ...CSS_THEMES,
    ...PRESET_THEMES.map((t) => ({ id: t.id, label: t.name })),
    ...custom.map((t) => ({ id: t.id, label: t.name }))
  ]
}

/** Variables set on <html> by the last palette theme, removed when switching away. */
let inline: string[] = []

function apply(choice: ThemeChoice): void {
  const { custom, revision } = useTheme.getState()
  const { applied, base, def } = resolve(choice, custom)
  const root = document.documentElement
  for (const name of inline) root.style.removeProperty(name)
  inline = []
  if (def) {
    for (const [name, value] of Object.entries(themeVars(def))) {
      root.style.setProperty(name, value)
      inline.push(name)
    }
  }
  setLanePalette(def ? laneColors(def.palette) : null)
  root.dataset.theme = base
  useTheme.setState({
    theme: choice,
    applied,
    base,
    layout: layoutOf(base),
    sidebarOpen: false,
    revision: revision + 1
  })
  window.api.menu.setTheme(choice, themeOptions(custom))
}

export function setTheme(theme: ThemeChoice): void {
  localStorage.setItem(THEME_KEY, theme)
  apply(theme)
}

/** The colours on screen now, as a palette: the starting point of a new theme. */
export function currentPalette(): ThemePalette {
  const def = resolve(useTheme.getState().theme, useTheme.getState().custom).def
  if (def) return { ...def.palette }
  const style = getComputedStyle(document.documentElement)
  const palette = {} as ThemePalette
  const fallback = PRESET_THEMES[0].palette
  for (const key of Object.keys(PALETTE_VARS) as PaletteKey[]) {
    const value = style.getPropertyValue(PALETTE_VARS[key]).trim()
    palette[key] = isHexColor(value) ? value : fallback[key]
  }
  return palette
}

export function newThemeId(): string {
  return `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Adds or updates one of the user's themes; shown at once if it is the current one. */
export function saveCustomTheme(theme: ThemeDef): void {
  const { custom } = useTheme.getState()
  const next = custom.some((t) => t.id === theme.id)
    ? custom.map((t) => (t.id === theme.id ? theme : t))
    : [...custom, theme]
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
  useTheme.setState({ custom: next })
  apply(useTheme.getState().theme)
}

export function deleteCustomTheme(id: string): void {
  const next = useTheme.getState().custom.filter((t) => t.id !== id)
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
  useTheme.setState({ custom: next })
  if (useTheme.getState().theme === id) setTheme('dark')
  else apply(useTheme.getState().theme)
}

/** Reads a theme exported as JSON; null if it isn't one. Gets a new id, to never overwrite. */
export function parseTheme(text: string): ThemeDef | null {
  try {
    const value = JSON.parse(text) as Partial<ThemeDef>
    const theme = {
      id: newThemeId(),
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Imported',
      base: value.base,
      palette: value.palette
    }
    return validTheme(theme) ? theme : null
  } catch {
    return null
  }
}

export function exportTheme(theme: ThemeDef): string {
  return JSON.stringify({ name: theme.name, base: theme.base, palette: theme.palette }, null, 2)
}

export function toggleDetail(hidden = !useTheme.getState().detailHidden): void {
  localStorage.setItem(DETAIL_KEY, hidden ? '1' : '0')
  useTheme.setState({ detailHidden: hidden })
}

/** Focus: opens or closes the drawer with the branches. */
export function toggleSidebarDrawer(open = !useTheme.getState().sidebarOpen): void {
  useTheme.setState({ sidebarOpen: open })
}

/** Focus: closes the detail drawer of `selected`, or opens it again. */
export function toggleDetailDrawer(selected: string | null): void {
  const { detailClosedFor } = useTheme.getState()
  useTheme.setState({ detailClosedFor: detailClosedFor === selected ? null : selected })
}

apply(useTheme.getState().theme)
systemDark.addEventListener('change', () => apply(useTheme.getState().theme))
window.api.menu.onTheme(setTheme)

const SPLASH_KEY = 'gitdom.splash'

/** Startup logo: on unless turned off, or when the system asks for reduced motion */
export function splashEnabled(): boolean {
  return (
    localStorage.getItem(SPLASH_KEY) !== 'off' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function setSplashEnabled(enabled: boolean): void {
  localStorage.setItem(SPLASH_KEY, enabled ? 'on' : 'off')
}
