// Lane palettes of the commit graph: one for the classic themes, others for Studio, Retro 2000
// and Matrix; the palette themes bring their own.
const LANE_COLORS = [
  '#15a0bf',
  '#0669f7',
  '#8e00c2',
  '#c517b6',
  '#d90171',
  '#cd0101',
  '#f25d2e',
  '#f2ca33',
  '#7bd938',
  '#2ece9d'
]

// Studio: warmer and softer, to go with its violet and amber
const STUDIO_COLORS = [
  '#b48cff',
  '#f5b454',
  '#ff7eb6',
  '#5ee6c4',
  '#7aa2ff',
  '#ff9e64',
  '#c3e88d',
  '#89ddff',
  '#e98bf5',
  '#f7768e'
]

// Retro 2000: the sixteen colours of the old screens, the darker ones that read on white
const RETRO_COLORS = [
  '#000080',
  '#008080',
  '#800000',
  '#808000',
  '#800080',
  '#008000',
  '#0000ff',
  '#ff0000',
  '#c08000',
  '#ff00ff'
]

// Matrix: every lane green, from mint to deep
const MATRIX_COLORS = [
  '#00ff41',
  '#00c832',
  '#7dff9e',
  '#00ff9c',
  '#3dbb5a',
  '#b6ff00',
  '#00e676',
  '#5cff7a',
  '#1fa045',
  '#9dffb0'
]

const CSS_LANES: Record<string, string[]> = {
  studio: STUDIO_COLORS,
  retro: RETRO_COLORS,
  matrix: MATRIX_COLORS
}

let themeColors: string[] | null = null

/** Lanes of a palette theme; null goes back to the CSS theme's. */
export function setLanePalette(colors: string[] | null): void {
  themeColors = colors && colors.length > 0 ? colors : null
}

export function laneColor(lane: number): string {
  const palette =
    themeColors ?? CSS_LANES[document.documentElement.dataset.theme ?? ''] ?? LANE_COLORS
  return palette[lane % palette.length]
}

function hashString(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Stable background color for an author's avatar. */
export function avatarColor(email: string): string {
  return `hsl(${hashString(email.toLowerCase()) % 360}, 45%, 38%)`
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
