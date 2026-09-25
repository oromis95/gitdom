// Themes: dark / light (following the system when asked to), and Studio, which also changes the layout.
import { create } from 'zustand'
import type { ThemeChoice } from '../../shared/api'

export type { ThemeChoice }
/** Colours actually applied, on <html data-theme> */
export type ThemeName = 'dark' | 'light' | 'studio'

const THEME_KEY = 'gitdom.theme'
const DETAIL_KEY = 'gitdom.detailHidden'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

function saved(): ThemeChoice {
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'system' || value === 'studio' ? value : 'dark'
}

function resolve(choice: ThemeChoice): ThemeName {
  if (choice === 'system') return systemDark.matches ? 'dark' : 'light'
  return choice
}

interface ThemeState {
  theme: ThemeChoice
  applied: ThemeName
  /** Studio lays out the actions in a rail on the left, with a collapsible detail panel */
  studio: boolean
  /** Detail panel collapsed, in the Studio layout */
  detailHidden: boolean
}

export const useTheme = create<ThemeState>(() => {
  const theme = saved()
  const applied = resolve(theme)
  return {
    theme,
    applied,
    studio: applied === 'studio',
    detailHidden: localStorage.getItem(DETAIL_KEY) === '1'
  }
})

function apply(choice: ThemeChoice): void {
  const applied = resolve(choice)
  document.documentElement.dataset.theme = applied
  useTheme.setState({ theme: choice, applied, studio: applied === 'studio' })
  window.api.menu.setTheme(choice)
}

export function setTheme(theme: ThemeChoice): void {
  localStorage.setItem(THEME_KEY, theme)
  apply(theme)
}

export function toggleDetail(hidden = !useTheme.getState().detailHidden): void {
  localStorage.setItem(DETAIL_KEY, hidden ? '1' : '0')
  useTheme.setState({ detailHidden: hidden })
}

apply(saved())
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
