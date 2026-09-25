import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useUi, type FormValues } from '../ui'
import RebaseEditor from './RebaseEditor'
import CommandPalette from './CommandPalette'

function Toasts(): React.JSX.Element {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <div className="toast-main">
            {t.kind === 'error' ? (
              <CircleAlert size={16} />
            ) : t.kind === 'warning' ? (
              <TriangleAlert size={16} />
            ) : t.kind === 'success' ? (
              <CircleCheck size={16} />
            ) : (
              <Info size={16} />
            )}
            <span className="toast-message">{t.message}</span>
            {t.details && t.details !== t.message && (
              <button
                className="link toast-toggle"
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
              >
                {expanded === t.id ? 'Hide' : 'Details'}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
          {expanded === t.id && <pre className="toast-details">{t.details}</pre>}
        </div>
      ))}
    </div>
  )
}

function FormDialog(): React.JSX.Element | null {
  const form = useUi((s) => s.form)
  const closeForm = useUi((s) => s.closeForm)
  const [values, setValues] = useState<FormValues>({})
  const [shownForm, setShownForm] = useState(form)

  // Reset the values whenever a different form opens
  if (form !== shownForm) {
    setShownForm(form)
    const initial: FormValues = {}
    form?.fields?.forEach((f) => (initial[f.key] = f.initial ?? ''))
    form?.checks?.forEach((c) => (initial[c.key] = c.initial ?? false))
    setValues(initial)
  }

  if (!form) return null
  const valid = (form.fields ?? []).every((f) => f.optional || String(values[f.key] ?? '').trim())
  const submit = (): void => {
    if (valid) closeForm(values)
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => closeForm(null)}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeForm(null)
          if (e.key === 'Enter' && e.ctrlKey) submit()
        }}
      >
        <div className="modal-title">{form.title}</div>
        {form.message && <div className="modal-message">{form.message}</div>}
        {form.fields?.map((f, i) => (
          <label key={f.key} className="modal-field">
            <span>{f.label}</span>
            {f.options ? (
              <select
                autoFocus={i === 0}
                value={String(values[f.key] ?? '')}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.multiline ? (
              <textarea
                rows={4}
                autoFocus={i === 0}
                placeholder={f.placeholder}
                value={String(values[f.key] ?? '')}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            ) : (
              <input
                autoFocus={i === 0}
                placeholder={f.placeholder}
                value={String(values[f.key] ?? '')}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </label>
        ))}
        {form.checks?.map((c) => (
          <label key={c.key} className="modal-check">
            <input
              type="checkbox"
              checked={!!values[c.key]}
              onChange={(e) => setValues({ ...values, [c.key]: e.target.checked })}
            />
            {c.label}
          </label>
        ))}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => closeForm(null)}>
            Cancel
          </button>
          <button
            type="submit"
            className={`btn ${form.danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={!valid}
            // Confirmation dialogs have no field to focus: focus the button so Enter confirms
            autoFocus={!form.fields?.length}
          >
            {form.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ContextMenu(): React.JSX.Element | null {
  const menu = useUi((s) => s.menu)
  const closeMenu = useUi((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  // Keep the menu inside the window
  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return
    setPosition({
      left: Math.min(menu.x, window.innerWidth - el.offsetWidth - 4),
      top: Math.min(menu.y, window.innerHeight - el.offsetHeight - 4)
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', closeMenu)
    }
  }, [menu, closeMenu])

  if (!menu) return null
  return (
    <div
      className="menu-backdrop"
      onMouseDown={closeMenu}
      onContextMenu={(e) => {
        e.preventDefault()
        closeMenu()
      }}
    >
      <div ref={ref} className="menu" style={position} onMouseDown={(e) => e.stopPropagation()}>
        {menu.items.map((item, i) =>
          item === 'separator' ? (
            <div key={i} className="menu-separator" />
          ) : (
            <button
              key={i}
              className={`menu-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                closeMenu()
                item.onClick()
              }}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}

export default function Overlays(): React.JSX.Element {
  return (
    <>
      <ContextMenu />
      <RebaseEditor />
      <CommandPalette />
      <FormDialog />
      <Toasts />
    </>
  )
}
