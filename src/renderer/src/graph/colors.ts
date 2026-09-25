// Lane palettes of the commit graph: one for the classic themes, one for Studio.
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

export function laneColor(lane: number): string {
  const palette = document.documentElement.dataset.theme === 'studio' ? STUDIO_COLORS : LANE_COLORS
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
