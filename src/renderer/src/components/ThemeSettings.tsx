// Preferences > Themes (UI-05): every theme with a preview, and the editor of the user's own.
// Edits apply at once, like the rest of Preferences.
import { useState } from 'react'
import { AlertTriangle, Check, Copy, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  currentPalette,
  deleteCustomTheme,
  exportTheme,
  newThemeId,
  parseTheme,
  saveCustomTheme,
  setTheme,
  useTheme
} from '../theme'
import {
  contrastChecks,
  isHexColor,
  PALETTE_GROUPS,
  PRESET_THEMES,
  type PaletteKey,
  type ThemeDef
} from '../themes'
import { confirm, notify } from '../ui'

interface Preview {
  id: string
  label: string
  bg: string
  panel: string
  text: string
  colors: string[]
}

// The CSS themes' colours, for their previews (from main.css, theme.css and studio.css)
const CSS_PREVIEWS: Preview[] = [
  {
    id: 'dark',
    label: 'Dark',
    bg: '#1b1d23',
    panel: '#22252b',
    text: '#d6d9de',
    colors: ['#1f8fff', '#4cbf6b', '#e8a13a', '#e25555']
  },
  {
    id: 'light',
    label: 'Light',
    bg: '#ffffff',
    panel: '#f4f5f7',
    text: '#1f2328',
    colors: ['#0969da', '#1a7f37', '#bc6c00', '#cf222e']
  },
  {
    id: 'studio',
    label: 'Studio',
    bg: '#15121c',
    panel: '#1e1a27',
    text: '#ebe6f2',
    colors: ['#b48cff', '#5ee6a0', '#f5b454', '#ff6b8b']
  }
]

const preview = (t: ThemeDef): Preview => ({
  id: t.id,
  label: t.name,
  bg: t.palette.bg,
  panel: t.palette.panel,
  text: t.palette.text,
  colors: [t.palette.accent, t.palette.green, t.palette.orange, t.palette.red]
})

function ThemeCard({ p, current }: { p: Preview; current: boolean }): React.JSX.Element {
  return (
    <button
      className={`theme-card${current ? ' current' : ''}`}
      title={current ? `${p.label} (current)` : `Use ${p.label}`}
      aria-pressed={current}
      onClick={() => setTheme(p.id)}
    >
      <span className="theme-card-preview" style={{ background: p.bg }}>
        <span className="theme-card-side" style={{ background: p.panel }} />
        <span className="theme-card-lines">
          {p.colors.map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </span>
        <span className="theme-card-text" style={{ color: p.text }}>
          Aa
        </span>
      </span>
      <span className="theme-card-name">
        {current && <Check size={12} />}
        {p.label}
      </span>
    </button>
  )
}

function ColorField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange(value: string): void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setDraft(value)
  }
  return (
    <label className="theme-color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="theme-color-label">{label}</span>
      <input
        className="theme-color-hex"
        value={draft}
        spellCheck={false}
        aria-label={`${label} (hex)`}
        onChange={(e) => {
          setDraft(e.target.value)
          if (isHexColor(e.target.value)) onChange(e.target.value.trim().toLowerCase())
        }}
        onBlur={() => setDraft(value)}
      />
    </label>
  )
}

function Editor({ theme, onDone }: { theme: ThemeDef; onDone(): void }): React.JSX.Element {
  const update = (change: Partial<ThemeDef>): void => saveCustomTheme({ ...theme, ...change })
  const setColor = (key: PaletteKey, value: string): void =>
    update({ palette: { ...theme.palette, [key]: value } })
  const checks = contrastChecks(theme.palette)
  const failed = checks.filter((c) => !c.ok)

  return (
    <div className="theme-editor">
      <div className="theme-editor-head">
        <input
          className="theme-name"
          value={theme.name}
          aria-label="Theme name"
          spellCheck={false}
          onChange={(e) => update({ name: e.target.value })}
          onBlur={() => !theme.name.trim() && update({ name: 'My theme' })}
        />
        <select
          value={theme.base}
          title="Dark or light: decides the details not in the palette, such as shadows"
          onChange={(e) => update({ base: e.target.value as ThemeDef['base'] })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <button className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
      <div className={`theme-contrast${failed.length ? ' bad' : ''}`}>
        {failed.length === 0 ? (
          <>
            <Check size={14} /> All the text is easy to read (WCAG contrast)
          </>
        ) : (
          <>
            <AlertTriangle size={14} />
            <span>
              Hard to read:{' '}
              {failed
                .map((c) => `${c.label.toLowerCase()} (${c.ratio.toFixed(1)}:1, needs ${c.min}:1)`)
                .join(', ')}
            </span>
          </>
        )}
      </div>
      {PALETTE_GROUPS.map((group) => (
        <div key={group.title} className="theme-group">
          <div className="theme-group-title">{group.title}</div>
          <div className="theme-colors">
            {group.keys.map(({ key, label }) => (
              <ColorField
                key={key}
                label={label}
                value={theme.palette[key]}
                onChange={(value) => setColor(key, value)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ThemeSettings(): React.JSX.Element {
  const theme = useTheme((t) => t.theme)
  const custom = useTheme((t) => t.custom)
  const [editing, setEditing] = useState<string | null>(null)
  const edited = custom.find((t) => t.id === editing)

  if (edited) return <Editor theme={edited} onDone={() => setEditing(null)} />

  const edit = (def: ThemeDef): void => {
    saveCustomTheme(def)
    setTheme(def.id)
    setEditing(def.id)
  }
  const createFromCurrent = (): void => {
    const { base } = useTheme.getState()
    const name = themeName(theme, custom)
    edit({
      id: newThemeId(),
      name: `${name} (custom)`,
      base: base === 'light' ? 'light' : 'dark',
      palette: currentPalette()
    })
  }
  const importTheme = async (): Promise<void> => {
    const def = parseTheme(await navigator.clipboard.readText())
    if (!def) {
      notify(
        'warning',
        'The clipboard has no GitDom theme',
        'Copy a theme exported from GitDom first.'
      )
      return
    }
    saveCustomTheme(def)
    setTheme(def.id)
    notify('success', `Theme "${def.name}" imported`)
  }
  const remove = async (def: ThemeDef): Promise<void> => {
    if (await confirm('Delete theme', `Delete the theme "${def.name}"?`, 'Delete', true))
      deleteCustomTheme(def.id)
  }

  return (
    <>
      <div className="theme-section-title">Built in</div>
      <div className="theme-grid">
        {[...CSS_PREVIEWS, ...PRESET_THEMES.map(preview)].map((p) => (
          <ThemeCard key={p.id} p={p} current={p.id === theme} />
        ))}
        <button
          className={`theme-card theme-card-system${theme === 'system' ? ' current' : ''}`}
          aria-pressed={theme === 'system'}
          onClick={() => setTheme('system')}
        >
          <span className="theme-card-preview">
            <span style={{ background: '#1b1d23' }} />
            <span style={{ background: '#ffffff' }} />
          </span>
          <span className="theme-card-name">
            {theme === 'system' && <Check size={12} />}
            Follow the system
          </span>
        </button>
      </div>
      <div className="theme-section-title">
        Your themes
        <span className="toolbar-spacer" />
        <button className="btn btn-small" onClick={createFromCurrent}>
          <Plus size={13} /> New from the current theme
        </button>
        <button className="btn btn-small" onClick={() => void importTheme()}>
          <Download size={13} /> Import from the clipboard
        </button>
      </div>
      {custom.length === 0 ? (
        <div className="pref-hint">
          None yet: start from the theme you are using and change its colours.
        </div>
      ) : (
        <div className="theme-list">
          {custom.map((def) => (
            <div key={def.id} className="theme-list-row">
              <ThemeCard p={preview(def)} current={def.id === theme} />
              <span className="toolbar-spacer" />
              <button className="btn btn-small" onClick={() => edit(def)}>
                <Pencil size={13} /> Edit
              </button>
              <button
                className="btn btn-small"
                title="Copy it as text, to share it or keep a copy"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(exportTheme(def))
                    .then(() => notify('info', 'Theme copied to the clipboard'))
                }
              >
                <Copy size={13} /> Export
              </button>
              <button
                className="btn btn-small"
                aria-label={`Delete ${def.name}`}
                onClick={() => void remove(def)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function themeName(id: string, custom: ThemeDef[]): string {
  if (id === 'system') return useTheme.getState().base === 'light' ? 'Light' : 'Dark'
  return (
    CSS_PREVIEWS.find((p) => p.id === id)?.label ??
    [...PRESET_THEMES, ...custom].find((t) => t.id === id)?.name ??
    'Dark'
  )
}
