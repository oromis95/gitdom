// Preferences > Keyboard (UI-03): every shortcut, its keys, and a way to change them.
import { useEffect, useState } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import {
  assignKey,
  comboOf,
  displayCombo,
  keysOf,
  resetAllShortcuts,
  resetShortcut,
  setRecording,
  setShortcutKeys,
  shortcutFor,
  SHORTCUTS,
  useShortcuts,
  type ShortcutDef,
  type ShortcutId
} from '../shortcuts'
import { notify } from '../ui'

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))]

/** Waits for a key combination; Escape cancels. */
function Recorder({ id, onDone }: { id: ShortcutId; onDone(): void }): React.JSX.Element {
  useEffect(() => {
    setRecording(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        onDone()
        return
      }
      const combo = comboOf(e)
      if (!combo) return
      const previous = shortcutFor(combo)
      if (previous && previous.id !== id)
        notify('info', `${displayCombo(combo)} no longer does “${previous.label}”`)
      assignKey(id, combo)
      onDone()
    }
    // Before anything else, the dialog's Escape included
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setRecording(false)
    }
  }, [id, onDone])
  return <span className="key-chip recording">Press the keys… (Esc cancels)</span>
}

function ShortcutRow({
  def,
  recording,
  refocus,
  onRecord
}: {
  def: ShortcutDef
  recording: boolean
  /** Just recorded: the + button gets the focus back, so that Escape still closes the dialog */
  refocus: boolean
  onRecord(id: ShortcutId | null): void
}): React.JSX.Element {
  const overrides = useShortcuts((s) => s.overrides)
  const keys = keysOf(def.id, overrides)
  const changed = def.id in overrides
  return (
    <div className="shortcut-row">
      <span className="shortcut-label">{def.label}</span>
      <span className="shortcut-keys">
        {keys.map((k) => (
          <span key={k} className="key-chip">
            {displayCombo(k)}
            <button
              aria-label={`Remove ${displayCombo(k)}`}
              title="Remove this key"
              onClick={() =>
                setShortcutKeys(
                  def.id,
                  keys.filter((other) => other !== k)
                )
              }
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {recording ? (
          <Recorder id={def.id} onDone={() => onRecord(null)} />
        ) : (
          <button
            className="key-add"
            autoFocus={refocus}
            title="Add a key"
            aria-label={`Add a key to ${def.label}`}
            onClick={() => onRecord(def.id)}
          >
            <Plus size={12} />
          </button>
        )}
      </span>
      <button
        className="key-reset"
        title="Back to the default keys"
        aria-label={`Reset ${def.label}`}
        style={{ visibility: changed ? 'visible' : 'hidden' }}
        onClick={() => resetShortcut(def.id)}
      >
        <RotateCcw size={13} />
      </button>
    </div>
  )
}

export default function ShortcutSettings(): React.JSX.Element {
  const [recording, setRecordingId] = useState<ShortcutId | null>(null)
  const [recorded, setRecorded] = useState<ShortcutId | null>(null)
  const record = (id: ShortcutId | null): void => {
    if (!id) setRecorded(recording)
    setRecordingId(id)
  }
  const changed = useShortcuts((s) => Object.keys(s.overrides).length > 0)
  return (
    <>
      <div className="theme-section-title">
        <span className="pref-hint">
          Click + and press the keys to add one. Keys used by another shortcut move here.
        </span>
        <span className="toolbar-spacer" />
        <button className="btn btn-small" disabled={!changed} onClick={() => resetAllShortcuts()}>
          <RotateCcw size={13} /> Reset all
        </button>
      </div>
      {GROUPS.map((group) => (
        <div key={group} className="shortcut-group">
          <div className="theme-group-title">{group}</div>
          {SHORTCUTS.filter((s) => s.group === group).map((def) => (
            <ShortcutRow
              key={def.id}
              def={def}
              recording={recording === def.id}
              refocus={recorded === def.id}
              onRecord={record}
            />
          ))}
        </div>
      ))}
    </>
  )
}
