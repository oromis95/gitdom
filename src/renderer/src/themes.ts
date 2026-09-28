// Theme palettes (UI-05): the built-in collection and the user's own. A palette holds the colours
// people pick; the rest (soft backgrounds, borders, badges) is mixed from them. Dark, Light and
// Studio keep their colours in the CSS files; these ones are applied as CSS variables on <html>.

export type ThemeBase = 'dark' | 'light'

export interface ThemePalette {
  /** Graph and editors */
  bg: string
  /** Sidebar and detail panel */
  panel: string
  /** Menus, dialogs, cards */
  elevated: string
  hover: string
  selected: string
  border: string
  /** Behind the panels, e.g. the tab bar */
  deep: string
  text: string
  muted: string
  /** Hints and placeholders */
  dim: string
  /** Code in diffs and the terminal */
  code: string
  accent: string
  green: string
  red: string
  orange: string
  purple: string
  // Syntax highlighting
  comment: string
  keyword: string
  tag: string
  literal: string
  string: string
  number: string
  title: string
  type: string
}

export interface ThemeDef {
  id: string
  name: string
  /** Dark or light: the rules written for the light theme apply to light palettes too */
  base: ThemeBase
  palette: ThemePalette
}

export type PaletteKey = keyof ThemePalette

/** The palette colours, grouped as the theme editor shows them. */
export const PALETTE_GROUPS: { title: string; keys: { key: PaletteKey; label: string }[] }[] = [
  {
    title: 'Backgrounds',
    keys: [
      { key: 'bg', label: 'Graph and editors' },
      { key: 'panel', label: 'Side panels' },
      { key: 'elevated', label: 'Menus and dialogs' },
      { key: 'deep', label: 'Tab bar' },
      { key: 'hover', label: 'Hover' },
      { key: 'selected', label: 'Selection' },
      { key: 'border', label: 'Borders' }
    ]
  },
  {
    title: 'Text',
    keys: [
      { key: 'text', label: 'Text' },
      { key: 'muted', label: 'Secondary text' },
      { key: 'dim', label: 'Hints' },
      { key: 'code', label: 'Code' }
    ]
  },
  {
    title: 'Accents',
    keys: [
      { key: 'accent', label: 'Accent' },
      { key: 'green', label: 'Added, success' },
      { key: 'red', label: 'Removed, danger' },
      { key: 'orange', label: 'Modified, warning' },
      { key: 'purple', label: 'Purple' }
    ]
  },
  {
    title: 'Syntax',
    keys: [
      { key: 'comment', label: 'Comments' },
      { key: 'keyword', label: 'Keywords' },
      { key: 'string', label: 'Strings' },
      { key: 'number', label: 'Numbers, attributes' },
      { key: 'literal', label: 'Literals' },
      { key: 'title', label: 'Functions, links' },
      { key: 'type', label: 'Types, built-ins' },
      { key: 'tag', label: 'Tags, sections' }
    ]
  }
]

/** The CSS variable of each palette colour. */
export const PALETTE_VARS: Record<PaletteKey, string> = {
  bg: '--bg',
  panel: '--bg-panel',
  elevated: '--bg-elevated',
  hover: '--bg-hover',
  selected: '--bg-selected',
  border: '--border',
  deep: '--bg-deep',
  text: '--text',
  muted: '--text-muted',
  dim: '--text-dim',
  code: '--code-text',
  accent: '--accent',
  green: '--green',
  red: '--red',
  orange: '--orange',
  purple: '--purple',
  comment: '--syn-comment',
  keyword: '--syn-keyword',
  tag: '--syn-tag',
  literal: '--syn-literal',
  string: '--syn-string',
  number: '--syn-number',
  title: '--syn-title',
  type: '--syn-type'
}

// --- Colour arithmetic ----------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (channels: number[]): string =>
  '#' + channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')

export function isHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
}

/** `amount` of `color` over `base`: 0 gives base, 1 gives color. */
export function mix(color: string, base: string, amount: number): string {
  const a = rgb(color)
  const b = rgb(base)
  return toHex(a.map((c, i) => c * amount + b[i] * (1 - amount)))
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** White or near-black, whichever reads better on `background`. */
export function readableOn(background: string): string {
  return contrast('#ffffff', background) >= contrast('#16181c', background) ? '#ffffff' : '#16181c'
}

// --- From palette to CSS variables ------------------------------------------------------------

/** Every CSS variable of a theme: the palette, and the colours mixed from it. */
export function themeVars(theme: ThemeDef): Record<string, string> {
  const p = theme.palette
  const dark = theme.base === 'dark'
  const over = (color: string, darkAmount: number, lightAmount: number): string =>
    mix(color, p.bg, dark ? darkAmount : lightAmount)
  const vars: Record<string, string> = {}
  for (const key of Object.keys(PALETTE_VARS) as PaletteKey[]) vars[PALETTE_VARS[key]] = p[key]
  return {
    ...vars,
    '--accent-soft': over(p.accent, 0.35, 0.22),
    '--accent-text': readableOn(p.accent),
    '--scrollbar': over(p.text, 0.2, 0.25),
    '--success-bg': over(p.green, 0.3, 0.18),
    '--success-border': over(p.green, 0.55, 0.5),
    '--warning-bg': over(p.orange, 0.25, 0.16),
    '--warning-border': over(p.orange, 0.5, 0.55),
    '--warning-text': dark ? p.orange : mix(p.orange, p.text, 0.75),
    '--unstage-bg': over(p.orange, 0.3, 0.2),
    '--unstage-border': over(p.orange, 0.55, 0.55),
    '--danger-bg': over(p.red, 0.35, 0.16),
    '--danger-text': mix(p.red, p.text, dark ? 0.6 : 0.85),
    '--error-bg': over(p.red, 0.2, 0.1),
    '--error-text': mix(p.red, p.text, dark ? 0.4 : 0.7),
    '--error-border': over(p.red, 0.5, 0.5),
    '--hunk-bg': over(p.accent, 0.15, 0.1),
    '--hunk-text': mix(p.accent, p.text, 0.5)
  }
}

/** Lanes of the commit graph: the palette's accents, then its syntax colours. */
export function laneColors(p: ThemePalette): string[] {
  const all = [p.accent, p.green, p.orange, p.purple, p.red, p.title, p.type, p.literal, p.keyword]
  return [...new Set(all.map((c) => c.toLowerCase()))]
}

/** Contrast checks shown in the theme editor, and required of the built-in themes (NFR-09). */
export function contrastChecks(
  p: ThemePalette
): { label: string; ratio: number; min: number; ok: boolean }[] {
  const checks: [string, string, string, number][] = [
    ['Text on the graph', p.text, p.bg, 7],
    ['Text on the side panels', p.text, p.panel, 7],
    ['Text on the selection', p.text, p.selected, 4.5],
    ['Secondary text', p.muted, p.bg, 4.5],
    ['Secondary text on the side panels', p.muted, p.panel, 4.5],
    ['Code', p.code, p.bg, 4.5],
    ['Accent', p.accent, p.bg, 3],
    ['Added', p.green, p.panel, 3],
    ['Removed', p.red, p.panel, 3],
    ['Modified', p.orange, p.panel, 3]
  ]
  return checks.map(([label, fg, bg, min]) => {
    const ratio = contrast(fg, bg)
    return { label, ratio, min, ok: ratio >= min }
  })
}

// --- The collection ---------------------------------------------------------------------------

export const PRESET_THEMES: ThemeDef[] = [
  {
    id: 'nord',
    name: 'Nord',
    base: 'dark',
    palette: {
      bg: '#2e3440',
      panel: '#2a303b',
      elevated: '#3b4252',
      hover: '#3b4252',
      selected: '#3e4f68',
      border: '#434c5e',
      deep: '#242933',
      text: '#eceff4',
      muted: '#aeb6c5',
      dim: '#6f7a8e',
      code: '#d8dee9',
      accent: '#88c0d0',
      green: '#a3be8c',
      red: '#d57780',
      orange: '#d08770',
      purple: '#b48ead',
      comment: '#7b8699',
      keyword: '#81a1c1',
      tag: '#bf616a',
      literal: '#8fbcbb',
      string: '#a3be8c',
      number: '#b48ead',
      title: '#88c0d0',
      type: '#ebcb8b'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    base: 'dark',
    palette: {
      bg: '#282a36',
      panel: '#21222c',
      elevated: '#343746',
      hover: '#343746',
      selected: '#44475a',
      border: '#3b3e4f',
      deep: '#1b1c24',
      text: '#f8f8f2',
      muted: '#b6b9cc',
      dim: '#6c7093',
      code: '#f8f8f2',
      accent: '#bd93f9',
      green: '#50fa7b',
      red: '#ff5555',
      orange: '#ffb86c',
      purple: '#ff79c6',
      comment: '#7984b8',
      keyword: '#ff79c6',
      tag: '#ff79c6',
      literal: '#bd93f9',
      string: '#f1fa8c',
      number: '#bd93f9',
      title: '#50fa7b',
      type: '#8be9fd'
    }
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    base: 'dark',
    palette: {
      bg: '#1a1b26',
      panel: '#16161e',
      elevated: '#24283b',
      hover: '#232433',
      selected: '#2e3c64',
      border: '#292e42',
      deep: '#121218',
      text: '#c8d1f5',
      muted: '#9aa3cc',
      dim: '#565f89',
      code: '#c0caf5',
      accent: '#7aa2f7',
      green: '#9ece6a',
      red: '#f7768e',
      orange: '#ff9e64',
      purple: '#bb9af7',
      comment: '#6a73a0',
      keyword: '#bb9af7',
      tag: '#f7768e',
      literal: '#ff9e64',
      string: '#9ece6a',
      number: '#ff9e64',
      title: '#7aa2f7',
      type: '#2ac3de'
    }
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    base: 'dark',
    palette: {
      bg: '#1e1e2e',
      panel: '#181825',
      elevated: '#313244',
      hover: '#2a2b3c',
      selected: '#3b3f5c',
      border: '#313244',
      deep: '#11111b',
      text: '#cdd6f4',
      muted: '#a6adc8',
      dim: '#6c7086',
      code: '#cdd6f4',
      accent: '#89b4fa',
      green: '#a6e3a1',
      red: '#f38ba8',
      orange: '#fab387',
      purple: '#cba6f7',
      comment: '#7f849c',
      keyword: '#cba6f7',
      tag: '#f38ba8',
      literal: '#fab387',
      string: '#a6e3a1',
      number: '#fab387',
      title: '#89b4fa',
      type: '#f9e2af'
    }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    base: 'dark',
    palette: {
      bg: '#282828',
      panel: '#32302f',
      elevated: '#3c3836',
      hover: '#3c3836',
      selected: '#504945',
      border: '#45403d',
      deep: '#1d2021',
      text: '#ebdbb2',
      muted: '#bdae93',
      dim: '#7c6f64',
      code: '#ebdbb2',
      accent: '#83a598',
      green: '#b8bb26',
      red: '#fb4934',
      orange: '#fe8019',
      purple: '#d3869b',
      comment: '#928374',
      keyword: '#fb4934',
      tag: '#fb4934',
      literal: '#d3869b',
      string: '#b8bb26',
      number: '#d3869b',
      title: '#8ec07c',
      type: '#fabd2f'
    }
  },
  {
    id: 'monokai',
    name: 'Monokai',
    base: 'dark',
    palette: {
      bg: '#272822',
      panel: '#2d2e27',
      elevated: '#3e3d32',
      hover: '#3e3d32',
      selected: '#49483e',
      border: '#3b3a32',
      deep: '#1e1f1c',
      text: '#f8f8f2',
      muted: '#bcbaad',
      dim: '#75715e',
      code: '#f8f8f2',
      accent: '#66d9ef',
      green: '#a6e22e',
      red: '#f92672',
      orange: '#fd971f',
      purple: '#ae81ff',
      comment: '#88846f',
      keyword: '#f92672',
      tag: '#f92672',
      literal: '#ae81ff',
      string: '#e6db74',
      number: '#ae81ff',
      title: '#a6e22e',
      type: '#66d9ef'
    }
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    base: 'dark',
    palette: {
      bg: '#002b36',
      panel: '#073642',
      elevated: '#0a3f4c',
      hover: '#0d4351',
      selected: '#114b63',
      border: '#0e4655',
      deep: '#00212b',
      text: '#e4e0d0',
      muted: '#a0acab',
      dim: '#5f777e',
      code: '#a6b2b2',
      accent: '#268bd2',
      green: '#859900',
      red: '#e2524f',
      orange: '#d9602e',
      purple: '#8a8ed8',
      comment: '#6a8189',
      keyword: '#859900',
      tag: '#268bd2',
      literal: '#2aa198',
      string: '#2aa198',
      number: '#d33682',
      title: '#268bd2',
      type: '#b58900'
    }
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    base: 'light',
    palette: {
      bg: '#fdf6e3',
      panel: '#f3ecd8',
      elevated: '#fdf6e3',
      hover: '#e9e2cc',
      selected: '#d7e3e6',
      border: '#ddd6c1',
      deep: '#eae3cd',
      text: '#073642',
      muted: '#4d6067',
      dim: '#93a1a1',
      code: '#2c434b',
      accent: '#1f7ab8',
      green: '#617000',
      red: '#c62a27',
      orange: '#b04112',
      purple: '#5b60b3',
      comment: '#869496',
      keyword: '#6c7c00',
      tag: '#268bd2',
      literal: '#1f8a82',
      string: '#1f8a82',
      number: '#c02f75',
      title: '#1f7ab8',
      type: '#9a7500'
    }
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    base: 'light',
    palette: {
      bg: '#eff1f5',
      panel: '#e6e9ef',
      elevated: '#f6f7fa',
      hover: '#dce0e8',
      selected: '#cddcf8',
      border: '#ccd0da',
      deep: '#dce0e8',
      text: '#373a52',
      muted: '#555870',
      dim: '#8c8fa1',
      code: '#4c4f69',
      accent: '#1e66f5',
      green: '#357f23',
      red: '#d20f39',
      orange: '#c24d07',
      purple: '#8839ef',
      comment: '#7c7f93',
      keyword: '#8839ef',
      tag: '#d20f39',
      literal: '#c24d07',
      string: '#357f23',
      number: '#c24d07',
      title: '#1e66f5',
      type: '#a86a10'
    }
  },
  {
    id: 'high-contrast-dark',
    name: 'High Contrast Dark',
    base: 'dark',
    palette: {
      bg: '#000000',
      panel: '#0a0a0a',
      elevated: '#141414',
      hover: '#1f1f1f',
      selected: '#003a70',
      border: '#6b6b6b',
      deep: '#000000',
      text: '#ffffff',
      muted: '#d0d0d0',
      dim: '#9a9a9a',
      code: '#ffffff',
      accent: '#3ea6ff',
      green: '#4ee37b',
      red: '#ff6b6b',
      orange: '#ffb347',
      purple: '#d59bff',
      comment: '#a8a8a8',
      keyword: '#ff9df5',
      tag: '#ff8080',
      literal: '#7fdcff',
      string: '#9dff9d',
      number: '#ffd27f',
      title: '#7fbfff',
      type: '#ffe066'
    }
  },
  {
    id: 'high-contrast-light',
    name: 'High Contrast Light',
    base: 'light',
    palette: {
      bg: '#ffffff',
      panel: '#f5f5f5',
      elevated: '#ffffff',
      hover: '#e6e6e6',
      selected: '#cce4ff',
      border: '#5c5c5c',
      deep: '#ebebeb',
      text: '#000000',
      muted: '#333333',
      dim: '#666666',
      code: '#000000',
      accent: '#0050b3',
      green: '#0a6b2a',
      red: '#b3001b',
      orange: '#8a4b00',
      purple: '#6a1bb3',
      comment: '#5c5c5c',
      keyword: '#8a00a8',
      tag: '#b3001b',
      literal: '#005f8a',
      string: '#0a6b2a',
      number: '#7a4a00',
      title: '#0040a0',
      type: '#7a5a00'
    }
  }
]
