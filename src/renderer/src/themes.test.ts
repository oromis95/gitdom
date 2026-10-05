import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  contrast,
  contrastChecks,
  isHexColor,
  mix,
  PALETTE_VARS,
  PRESET_THEMES,
  REMOVED_THEMES,
  readableOn,
  themeVars,
  type PaletteKey,
  type ThemePalette
} from './themes'

const css = (file: string): string => readFileSync(join(__dirname, 'assets', file), 'utf8')

/** The variables declared in the first CSS block starting with `selector {`. */
function block(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(selector + ' {')
  expect(start).toBeGreaterThanOrEqual(0)
  const body = source.slice(start, source.indexOf('}', start))
  const vars: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[name] = value.trim()
  return vars
}

function paletteOf(vars: Record<string, string>): ThemePalette {
  const palette = {} as ThemePalette
  for (const key of Object.keys(PALETTE_VARS) as PaletteKey[])
    palette[key] = vars[PALETTE_VARS[key]]
  return palette
}

const darkVars = { ...block(css('main.css'), ':root'), ...block(css('theme.css'), ':root') }
const CSS_THEMES: [string, ThemePalette][] = [
  ['Dark', paletteOf(darkVars)],
  ['Light', paletteOf({ ...darkVars, ...block(css('theme.css'), ":root[data-theme='light']") })],
  ['Studio', paletteOf({ ...darkVars, ...block(css('studio.css'), ":root[data-theme='studio']") })],
  [
    'Retro 2000',
    paletteOf({ ...darkVars, ...block(css('retro.css'), ":root[data-theme='retro']") })
  ],
  ['Matrix', paletteOf({ ...darkVars, ...block(css('retro.css'), ":root[data-theme='matrix']") })],
  ...['Focus', 'Mail', 'IDE'].map(
    (name) =>
      [
        name,
        paletteOf({
          ...darkVars,
          ...block(css('layouts.css'), `:root[data-theme='${name.toLowerCase()}']`)
        })
      ] as [string, ThemePalette]
  )
]

describe('colour arithmetic', () => {
  it('computes the WCAG contrast ratio', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })

  it('mixes colours', () => {
    expect(mix('#ffffff', '#000000', 0.5)).toBe('#808080')
    expect(mix('#ff0000', '#0000ff', 1)).toBe('#ff0000')
    expect(mix('#fff', '#000', 0)).toBe('#000000')
  })

  it('picks readable text for a background', () => {
    expect(readableOn('#1f8fff')).toBe('#16181c')
    expect(readableOn('#213a5c')).toBe('#ffffff')
    expect(readableOn('#f1fa8c')).toBe('#16181c')
  })
})

describe('themes', () => {
  it.each(PRESET_THEMES.map((t) => [t.name, t] as const))('%s is complete', (_, theme) => {
    for (const key of Object.keys(PALETTE_VARS) as PaletteKey[])
      expect(isHexColor(theme.palette[key]), key).toBe(true)
    const vars = themeVars(theme)
    for (const value of Object.values(vars)) expect(isHexColor(value)).toBe(true)
  })

  it('have unique ids', () => {
    const ids = PRESET_THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('send the users of a removed theme to one that is still there', () => {
    const ids = PRESET_THEMES.map((t) => t.id)
    const css = ['dark', 'light', 'retro', 'matrix', 'studio', 'focus', 'mail', 'ide']
    for (const [removed, instead] of Object.entries(REMOVED_THEMES)) {
      expect(ids).not.toContain(removed)
      expect([...ids, ...css]).toContain(instead)
    }
  })

  it.each([...CSS_THEMES, ...PRESET_THEMES.map((t) => [t.name, t.palette] as const)])(
    '%s has readable text',
    (_, palette) => {
      const failed = contrastChecks(palette)
        .filter((c) => !c.ok)
        .map((c) => `${c.label}: ${c.ratio.toFixed(2)} < ${c.min}`)
      expect(failed).toEqual([])
    }
  )
})
