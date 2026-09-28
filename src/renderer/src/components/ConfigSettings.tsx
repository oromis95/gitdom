// Preferences > Git config (SET-03): the user's global git settings and the open repository's own.
import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { ConfigEntry, ConfigScope, Result } from '../../../shared/api'
import { useActiveTab, useApp } from '../store'
import { confirm, notify } from '../ui'

/** A value saved when the field loses focus or Enter is pressed; Escape puts it back. */
function ValueInput({
  value,
  label,
  onCommit
}: {
  value: string
  label: string
  onCommit(value: string): void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setDraft(value)
  }
  return (
    <input
      className="config-value"
      value={draft}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (draft !== value) onCommit(draft)
        } else if (e.key === 'Escape' && draft !== value) {
          e.stopPropagation()
          setDraft(value)
        }
      }}
    />
  )
}

export default function ConfigSettings(): React.JSX.Element {
  const repo = useActiveTab()?.path ?? null
  const [scope, setScope] = useState<ConfigScope>('global')
  // What was read, and for which scope and repository; a reread after a change keeps it shown
  const [loaded, setLoaded] = useState<{ key: string; result: Result<ConfigEntry[]> } | null>(null)
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const source = `${scope}:${repo}`
  const result = loaded?.key === source ? loaded.result : null
  const entries = result?.ok ? result.value : null
  const error = result && !result.ok ? result.error : null
  const load = (): void => setRevision((r) => r + 1)

  useEffect(() => {
    let current = true
    const key = `${scope}:${repo}`
    void window.api.tools
      .configList(scope, scope === 'local' ? repo : null)
      .then((result) => current && setLoaded({ key, result }))
    return () => {
      current = false
    }
  }, [scope, repo, revision])

  const target = scope === 'local' ? repo : null
  const apply = async (work: Promise<Result<void>>): Promise<boolean> => {
    const result = await work
    if (!result.ok) notify('error', result.error)
    load()
    // The identity, the pull mode and the like come from the configuration
    if (result.ok && repo) void useApp.getState().refreshPath(repo)
    return result.ok
  }
  const add = async (): Promise<void> => {
    const key = newKey.trim()
    if (!key) return
    if (await apply(window.api.tools.configSet(scope, target, key, newValue, null))) {
      setNewKey('')
      setNewValue('')
    }
  }
  const remove = async (entry: ConfigEntry): Promise<void> => {
    const where =
      scope === 'global' ? 'your global configuration' : "the repository's configuration"
    if (await confirm('Remove setting', `Remove ${entry.key} from ${where}?`, 'Remove', true))
      await apply(window.api.tools.configUnset(scope, target, entry.key, entry.value))
  }

  const needle = filter.trim().toLowerCase()
  const shown = (entries ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        !needle ||
        entry.key.toLowerCase().includes(needle) ||
        entry.value.toLowerCase().includes(needle)
    )
  const sections = [...new Set(shown.map(({ entry }) => entry.key.split('.')[0]))]

  return (
    <>
      <div className="theme-section-title">
        <div className="config-scope" role="tablist">
          {(
            [
              ['global', 'Global (all repositories)'],
              ['local', 'This repository']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={scope === id}
              className={`btn btn-small${scope === id ? ' active' : ''}`}
              disabled={id === 'local' && !repo}
              title={id === 'local' && !repo ? 'Open a repository first' : undefined}
              onClick={() => setScope(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <button className="btn btn-small" title="Read the configuration again" onClick={load}>
          <RefreshCw size={13} />
        </button>
      </div>
      <span className="pref-hint">
        {scope === 'global'
          ? 'Your ~/.gitconfig, used by every repository unless one sets its own value.'
          : `The .git/config of ${repo}: it wins over the global values.`}{' '}
        Changes are written right away.
      </span>
      <div className="config-add">
        <input
          value={newKey}
          placeholder="section.name, e.g. core.autocrlf"
          aria-label="New setting name"
          spellCheck={false}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <input
          value={newValue}
          placeholder="Value"
          aria-label="New setting value"
          spellCheck={false}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button className="btn btn-small" disabled={!newKey.trim()} onClick={() => void add()}>
          <Plus size={13} /> Add
        </button>
      </div>
      <input
        className="config-filter"
        value={filter}
        placeholder="Filter settings"
        aria-label="Filter settings"
        spellCheck={false}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && filter) {
            e.stopPropagation()
            setFilter('')
          }
        }}
      />
      {error && <span className="pref-bad">{error}</span>}
      {!error && !entries && <span className="pref-hint">Reading the configuration…</span>}
      {entries && shown.length === 0 && (
        <span className="pref-hint">
          {needle ? 'No setting matches.' : 'Nothing set here yet.'}
        </span>
      )}
      {sections.map((section) => (
        <div key={section} className="shortcut-group">
          <div className="theme-group-title">{section}</div>
          {shown
            .filter(({ entry }) => entry.key.split('.')[0] === section)
            .map(({ entry, index }) => (
              <div key={`${index}:${entry.key}`} className="shortcut-row config-row">
                <span className="config-key" title={entry.key}>
                  {entry.key}
                </span>
                <ValueInput
                  value={entry.value}
                  label={`Value of ${entry.key}`}
                  onCommit={(value) =>
                    void apply(
                      window.api.tools.configSet(scope, target, entry.key, value, entry.value)
                    )
                  }
                />
                <button
                  className="key-reset"
                  title="Remove"
                  aria-label={`Remove ${entry.key}`}
                  onClick={() => void remove(entry)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
        </div>
      ))}
    </>
  )
}
