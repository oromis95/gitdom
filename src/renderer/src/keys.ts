// The keyboard shortcuts and their default keys (UI-03), and key combinations as text, e.g.
// "Ctrl+Shift+P": what a key press stands for, and how it reads.

export type ShortcutId =
  | 'palette'
  | 'openRepo'
  | 'preferences'
  | 'terminal'
  | 'activity'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'undo'
  | 'redo'
  | 'search'
  | 'refresh'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'branch'
  | 'stash'
  | 'pop'
  | 'commit'
  | 'focusSidebar'
  | 'focusGraph'
  | 'focusDetail'
  | 'filterSidebar'
  | 'stageFile'
  | 'nextHunk'
  | 'prevHunk'

export interface ShortcutDef {
  id: ShortcutId
  label: string
  group: string
  keys: string[]
  /** Also works from the terminal (never for plain Ctrl+letter: those belong to the shell) */
  terminal?: boolean
}

export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'palette',
    label: 'Command palette',
    group: 'General',
    keys: ['Ctrl+Shift+P', 'Ctrl+P'],
    terminal: true
  },
  { id: 'openRepo', label: 'Open a repository', group: 'General', keys: ['Ctrl+O'] },
  { id: 'preferences', label: 'Preferences', group: 'General', keys: ['Ctrl+,'] },
  {
    id: 'terminal',
    label: 'Show or hide the terminal',
    group: 'General',
    keys: ['Ctrl+`'],
    terminal: true
  },
  {
    id: 'activity',
    label: 'Show or hide the activity log',
    group: 'General',
    keys: ['Ctrl+Shift+L'],
    terminal: true
  },
  {
    id: 'zoomIn',
    label: 'Zoom in',
    group: 'General',
    keys: ['Ctrl+=', 'Ctrl+Plus', 'Ctrl+Shift+Plus']
  },
  { id: 'zoomOut', label: 'Zoom out', group: 'General', keys: ['Ctrl+-'] },
  { id: 'zoomReset', label: 'Actual size', group: 'General', keys: ['Ctrl+0'] },
  { id: 'undo', label: 'Undo', group: 'Repository', keys: ['Ctrl+Z'] },
  { id: 'redo', label: 'Redo', group: 'Repository', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'search', label: 'Search the history', group: 'Repository', keys: ['Ctrl+F'] },
  { id: 'refresh', label: 'Refresh', group: 'Repository', keys: ['F5'] },
  { id: 'fetch', label: 'Fetch all', group: 'Repository', keys: [] },
  { id: 'pull', label: 'Pull', group: 'Repository', keys: ['Ctrl+Shift+Down'] },
  { id: 'push', label: 'Push', group: 'Repository', keys: [] },
  { id: 'branch', label: 'New branch', group: 'Repository', keys: ['Ctrl+B'] },
  { id: 'stash', label: 'Stash the changes', group: 'Repository', keys: ['Ctrl+Shift+S'] },
  { id: 'pop', label: 'Pop the last stash', group: 'Repository', keys: [] },
  { id: 'commit', label: 'Commit (in the message box)', group: 'Repository', keys: ['Ctrl+Enter'] },
  { id: 'focusSidebar', label: 'Go to the side panel', group: 'Navigation', keys: ['Ctrl+1'] },
  { id: 'focusGraph', label: 'Go to the graph', group: 'Navigation', keys: ['Ctrl+2'] },
  { id: 'focusDetail', label: 'Go to the detail panel', group: 'Navigation', keys: ['Ctrl+3'] },
  {
    id: 'filterSidebar',
    label: 'Filter the side panel',
    group: 'Navigation',
    keys: ['Ctrl+Alt+F']
  },
  {
    id: 'stageFile',
    label: 'Stage or unstage the file (in a file list)',
    group: 'Navigation',
    keys: ['Space']
  },
  {
    id: 'nextHunk',
    label: 'Next change (in a diff)',
    group: 'Navigation',
    keys: ['Alt+Down', 'F7']
  },
  {
    id: 'prevHunk',
    label: 'Previous change (in a diff)',
    group: 'Navigation',
    keys: ['Alt+Up', 'Shift+F7']
  }
]

const CODES: Record<string, string> = {
  // The key left of 1, whatever the layout says it types
  Backquote: '`'
}

const NAMED: Record<string, string> = {
  ' ': 'Space',
  '+': 'Plus',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc'
}

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

/**
 * The combination a key press stands for, e.g. "Ctrl+Shift+P"; null for a modifier alone.
 * Letters come from the key's position, so they work on any layout; the rest from what it types.
 */
export function comboOf(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): string | null {
  if (MODIFIERS.has(e.key) || e.key === 'Dead' || e.key === 'Unidentified') return null
  let key: string
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (CODES[e.code]) key = CODES[e.code]
  else if (/^Digit[0-9]$/.test(e.code) && e.ctrlKey && !e.altKey) key = e.code.slice(5)
  else key = NAMED[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key]
    .filter(Boolean)
    .join('+')
}

/** How a combination is shown: "Ctrl+Plus" reads "Ctrl++". */
export function displayCombo(combo: string): string {
  return combo.replace(/Plus$/, '+').replace(/Esc$/, 'Escape')
}

/** A plain Ctrl+letter, which in the terminal belongs to the shell. */
export const shellKey = (combo: string): boolean => /^Ctrl\+[A-Z]$/.test(combo)
