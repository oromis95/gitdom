// Preferences dialog (SET-01): changes apply right away, there's nothing to save.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { MergeToolInfo, PullMode } from '../../../shared/api'
import { savePullMode, savedPullMode } from '../actions'
import {
  CODE_FONT_SIZES,
  COMMIT_CHECKS,
  DEFAULT_SETTINGS,
  ZOOM_STEPS,
  updateSettings,
  useSettings,
  type Settings
} from '../settings'
import { setSplashEnabled, setTheme, splashEnabled, themeOptions, useTheme } from '../theme'
import { useUi } from '../ui'
import { checkForUpdates, showWhatsNew } from '../updates'
import { showTip } from '../tips'
import ThemeSettings from './ThemeSettings'
import ShortcutSettings from './ShortcutSettings'
import ConfigSettings from './ConfigSettings'

const PULL_MODES: { value: PullMode; label: string }[] = [
  { value: 'ff', label: 'Fast-forward if possible, otherwise merge' },
  { value: 'ff-only', label: 'Fast-forward only' },
  { value: 'rebase', label: 'Rebase' }
]

const FETCH_INTERVALS = [0, 5, 10, 15, 30, 60]

const UI_FONTS = ['Segoe UI', 'Inter', 'Arial', 'Calibri', 'Verdana', 'system-ui']
const CODE_FONTS = [
  'Consolas',
  'Cascadia Code',
  'Cascadia Mono',
  'JetBrains Mono',
  'Fira Code',
  'Courier New'
]
const EDITORS = ['code', 'code -r', 'notepad', 'subl', 'notepad++']

// Offered while git works out which tools are installed, which can take a minute
const COMMON_MERGE_TOOLS: MergeToolInfo[] = [
  { name: 'vscode', label: 'Visual Studio Code', available: false },
  { name: 'winmerge', label: 'WinMerge', available: false },
  { name: 'kdiff3', label: 'KDiff3', available: false },
  { name: 'meld', label: 'Meld', available: false },
  { name: 'bc', label: 'Beyond Compare', available: false },
  { name: 'p4merge', label: 'HelixCore P4Merge', available: false },
  { name: 'tortoisemerge', label: 'TortoiseMerge', available: false },
  { name: 'smerge', label: 'Sublime Merge', available: false }
]

type Section = 'appearance' | 'themes' | 'keyboard' | 'git' | 'config' | 'tools'

/**
 * A text setting saved when the field loses focus or Enter is pressed, not at every key:
 * a half-typed git path would break every git command in the meantime.
 */
function LazyInput({
  value,
  onCommit,
  placeholder,
  list
}: {
  value: string
  onCommit(value: string): void
  placeholder?: string
  list?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setDraft(value)
  }
  const commit = (): void => {
    if (draft.trim() !== value) onCommit(draft.trim())
  }
  return (
    <input
      value={draft}
      placeholder={placeholder}
      list={list}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
    />
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="pref-row">
      <div className="pref-label">
        <span>{label}</span>
        {hint && <span className="pref-hint">{hint}</span>}
      </div>
      <div className="pref-control">{children}</div>
    </div>
  )
}

function Appearance({ s }: { s: Settings }): React.JSX.Element {
  const theme = useTheme((t) => t.theme)
  const custom = useTheme((t) => t.custom)
  const [splash, setSplash] = useState(splashEnabled)
  return (
    <>
      <Row label="Theme" hint="Also in Window → Theme; previews and your own themes in Themes">
        <select value={theme} onChange={(e) => setTheme(e.target.value)}>
          {themeOptions(custom).map((t) => (
            <option key={t.id} value={t.id}>
              {t.id === 'studio' ? 'Studio (different layout)' : t.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Interface size" hint="Ctrl+= and Ctrl+-, or Ctrl+mouse wheel">
        <select value={s.zoom} onChange={(e) => updateSettings({ zoom: Number(e.target.value) })}>
          {ZOOM_STEPS.map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
      </Row>
      <Row label="Interface font" hint="Empty: Segoe UI">
        <LazyInput
          value={s.uiFont}
          placeholder="Segoe UI"
          list="pref-ui-fonts"
          onCommit={(uiFont) => updateSettings({ uiFont })}
        />
      </Row>
      <Row label="Code font" hint="Diffs, blame, merge editor and terminal">
        <div className="pref-inline">
          <LazyInput
            value={s.codeFont}
            placeholder="Consolas"
            list="pref-code-fonts"
            onCommit={(codeFont) => updateSettings({ codeFont })}
          />
          <select
            className="pref-size"
            value={s.codeFontSize}
            title="Code font size"
            onChange={(e) => updateSettings({ codeFontSize: Number(e.target.value) })}
          >
            {Array.from(
              { length: CODE_FONT_SIZES.max - CODE_FONT_SIZES.min + 1 },
              (_, i) => CODE_FONT_SIZES.min + i
            ).map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </div>
      </Row>
      <Row label="Panel sizes" hint="Drag the edge of the side panels; double-click it to reset">
        <button
          className="btn"
          disabled={s.sidebarWidth === null && s.detailWidth === null}
          onClick={() => updateSettings({ sidebarWidth: null, detailWidth: null })}
        >
          Reset panel sizes
        </button>
      </Row>
      <Row label="Startup animation">
        <label className="modal-check">
          <input
            type="checkbox"
            checked={splash}
            onChange={(e) => {
              setSplashEnabled(e.target.checked)
              setSplash(e.target.checked)
            }}
          />
          Show the logo when GitDom starts
        </label>
      </Row>
      <Row
        label="Tips"
        hint="A feature explained at startup, and now and then after an action it builds on"
      >
        <label className="modal-check">
          <input
            type="checkbox"
            checked={s.showTips}
            onChange={(e) => updateSettings({ showTips: e.target.checked })}
          />
          Show tips
        </label>
        <div className="pref-buttons">
          <button
            className="btn btn-small"
            onClick={() => {
              useUi.setState({ preferences: false })
              showTip()
            }}
          >
            See all the tips
          </button>
        </div>
      </Row>
      <Row
        label="Author pictures"
        hint="Looked up on Gravatar (or GitHub, for its noreply addresses) from a hash of the email; initials otherwise"
      >
        <label className="modal-check">
          <input
            type="checkbox"
            checked={s.graphAvatars}
            onChange={(e) => updateSettings({ graphAvatars: e.target.checked })}
          />
          Show author pictures in the graph
        </label>
      </Row>
      <Row label="Hover cards" hint="Appear after a short pause and never take the mouse">
        <label className="modal-check">
          <input
            type="checkbox"
            checked={s.hoverCards}
            onChange={(e) => updateSettings({ hoverCards: e.target.checked })}
          />
          Show details when resting the mouse on authors, commits, branches and stashes
        </label>
      </Row>
      <datalist id="pref-ui-fonts">
        {UI_FONTS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <datalist id="pref-code-fonts">
        {CODE_FONTS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  )
}

function Git({ s }: { s: Settings }): React.JSX.Element {
  const [pullMode, setPullMode] = useState(savedPullMode)
  // Result of `git --version` for the path it was run with: stale while a new check runs
  const [check, setCheck] = useState<{ path: string; ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let current = true
    const path = s.gitPath
    void window.api.tools.checkGit(path).then((result) => {
      if (!current) return
      setCheck(
        result.ok ? { path, ok: true, text: result.value } : { path, ok: false, text: result.error }
      )
    })
    return () => {
      current = false
    }
  }, [s.gitPath])

  return (
    <>
      <Row
        label="Git executable"
        hint={
          check?.path === s.gitPath ? (
            <span className={check.ok ? 'pref-ok' : 'pref-bad'}>{check.text}</span>
          ) : (
            'Checking…'
          )
        }
      >
        <LazyInput
          value={s.gitPath}
          placeholder="git (from the PATH)"
          onCommit={(gitPath) => updateSettings({ gitPath })}
        />
      </Row>
      <Row label="Background fetch" hint="Keeps the remote branches up to date">
        <select
          value={s.autoFetchMinutes}
          onChange={(e) => updateSettings({ autoFetchMinutes: Number(e.target.value) })}
        >
          {FETCH_INTERVALS.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'Off' : `Every ${m} minutes`}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Pull" hint="What the Pull button does">
        <select
          value={pullMode}
          onChange={(e) => {
            savePullMode(e.target.value as PullMode)
            setPullMode(e.target.value as PullMode)
          }}
        >
          {PULL_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Row>
      <Row
        label="Local changes"
        hint="Pull, merge and rebase always set them aside and bring them back"
      >
        <label className="modal-check">
          <input
            type="checkbox"
            checked={s.autoStash}
            onChange={(e) => updateSettings({ autoStash: e.target.checked })}
          />
          Stash and reapply them on checkout without asking
        </label>
      </Row>
      <Row label="Before committing" hint="Warnings in the commit panel: they never block it">
        {COMMIT_CHECKS.map(({ key, label }) => (
          <label key={key} className="modal-check pref-checks">
            <input
              type="checkbox"
              checked={s[key]}
              onChange={(e) => updateSettings({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </Row>
      <Row label="Updates" hint={`GitDom ${__APP_VERSION__}`}>
        <label className="modal-check">
          <input
            type="checkbox"
            checked={s.checkUpdates}
            onChange={(e) => updateSettings({ checkUpdates: e.target.checked })}
          />
          Tell me at startup when a new version is out
        </label>
        <div className="pref-buttons">
          <button className="btn btn-small" onClick={() => void checkForUpdates(true)}>
            Check now
          </button>
          <button className="btn btn-small" onClick={() => showWhatsNew()}>
            What&apos;s new
          </button>
        </div>
      </Row>
    </>
  )
}

function Tools({ s }: { s: Settings }): React.JSX.Element {
  const [probe, setProbe] = useState<{ git: string; tools: MergeToolInfo[] } | null>(null)
  useEffect(() => {
    let current = true
    const git = s.gitPath
    void window.api.tools.mergeTools().then((tools) => current && setProbe({ git, tools }))
    return () => {
      current = false
    }
  }, [s.gitPath])
  const tools = probe?.git === s.gitPath ? probe.tools : null
  const found = tools?.filter((t) => t.available) ?? []
  const missing = tools?.filter((t) => !t.available) ?? COMMON_MERGE_TOOLS
  const listed = tools ?? COMMON_MERGE_TOOLS
  // bc, bc3 and bc4 are all "Beyond Compare": their name tells them apart
  const label = (tool: MergeToolInfo): string =>
    listed.filter((t) => t.label === tool.label).length > 1
      ? `${tool.label} (${tool.name})`
      : tool.label
  // Diff and merge tools share the names git knows (git difftool --tool-help lists the same ones)
  const toolSelect = (
    value: string,
    fallback: string,
    onChange: (value: string) => void
  ): React.JSX.Element => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{fallback}</option>
      {value && !listed.some((t) => t.name === value) && <option value={value}>{value}</option>}
      {found.length > 0 && (
        <optgroup label="Found on this machine">
          {found.map((t) => (
            <option key={t.name} value={t.name}>
              {label(t)}
            </option>
          ))}
        </optgroup>
      )}
      {missing.length > 0 && (
        <optgroup label={tools ? 'Not found' : 'Common tools'}>
          {missing.map((t) => (
            <option key={t.name} value={t.name}>
              {tools ? `${label(t)} - not found` : label(t)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )

  return (
    <>
      <Row
        label="External editor"
        hint={
          <>
            Command that opens a file, e.g. <code>code</code>. Quote paths with spaces. Empty: the
            app Windows associates with the file.
          </>
        }
      >
        <LazyInput
          value={s.editor}
          placeholder="System default"
          list="pref-editors"
          onCommit={(editor) => updateSettings({ editor })}
        />
      </Row>
      <Row
        label="Merge tool"
        hint={
          tools
            ? 'Opened from a conflicted file. A tool marked “not found” needs its path in git config (mergetool.<tool>.path).'
            : 'Checking which tools are installed…'
        }
      >
        {toolSelect(s.mergeTool, 'From git config (merge.tool)', (mergeTool) =>
          updateSettings({ mergeTool })
        )}
      </Row>
      <Row
        label="Diff tool"
        hint="Opens a file's changes side by side, from the diff view or the file's menu."
      >
        {toolSelect(s.diffTool, 'From git config (diff.tool)', (diffTool) =>
          updateSettings({ diffTool })
        )}
      </Row>
      <datalist id="pref-editors">
        {EDITORS.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
    </>
  )
}

export default function Preferences(): React.JSX.Element | null {
  const open = useUi((u) => u.preferences)
  const settings = useSettings()
  const [section, setSection] = useState<Section>('appearance')
  // Starts the slow merge tool probe early; main keeps the answer for the Tools page
  useEffect(() => {
    if (open) void window.api.tools.mergeTools()
  }, [open])
  if (!open) return null
  const close = (): void => useUi.setState({ preferences: false })

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal preferences"
        role="dialog"
        aria-label="Preferences"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      >
        <div className="pref-header">
          <div className="modal-title">Preferences</div>
          <button className="pref-close" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="pref-body">
          <nav className="pref-nav">
            {(
              [
                ['appearance', 'Appearance'],
                ['themes', 'Themes'],
                ['keyboard', 'Keyboard'],
                ['git', 'Git'],
                ['config', 'Git config'],
                ['tools', 'External tools']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={section === id ? 'active' : ''}
                autoFocus={section === id}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="pref-content">
            {section === 'appearance' && <Appearance s={settings} />}
            {section === 'themes' && <ThemeSettings />}
            {section === 'keyboard' && <ShortcutSettings />}
            {section === 'git' && <Git s={settings} />}
            {section === 'config' && <ConfigSettings />}
            {section === 'tools' && <Tools s={settings} />}
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="btn"
            title="Fonts, zoom, panels, fetch interval and tools; the theme and the keys stay"
            onClick={() => updateSettings(DEFAULT_SETTINGS)}
          >
            Restore defaults
          </button>
          <span className="toolbar-spacer" />
          <button className="btn btn-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
