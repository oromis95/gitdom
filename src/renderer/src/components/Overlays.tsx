import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useUi, type FormValues } from '../ui'
import CommandPalette from './CommandPalette'
import RepoDialogs from './RepoDialogs'

// Loaded on first use, to keep the startup bundle small
const RebaseEditor = lazy(() => import('./RebaseEditor'))
const SplitEditor = lazy(() => import('./SplitEditor'))
const ReleaseNotes = lazy(() => import('./ReleaseNotes'))
const IgnoredFiles = lazy(() => import('./IgnoredFiles'))
const CleanUp = lazy(() => import('./CleanUp'))
const BranchOverview = lazy(() => import('./BranchOverview'))
const RepoHealth = lazy(() => import('./RepoHealth'))
const Hooks = lazy(() => import('./Hooks'))
const Preferences = lazy(() => import('./Preferences'))

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
            ) : f.browseParent ? (
              <span className="modal-browse">
                <input
                  autoFocus={i === 0}
                  placeholder={f.placeholder}
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const parent = await window.api.repos.pickFolder(f.browseParent!)
                    if (!parent) return
                    const name = String(values[f.key] ?? '')
                      .split(/[\\/]/)
                      .filter(Boolean)
                      .pop()
                    const folder = parent.replace(/\\/g, '/')
                    setValues((v) => ({ ...v, [f.key]: `${folder}/${name ?? ''}` }))
                  }}
                >
                  Browse…
                </button>
              </span>
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

  // Keyboard (NFR-09): the first item takes the focus, arrows move it, Enter picks; the focus
  // goes back where it was when the menu closes
  useEffect(() => {
    if (!menu) return
    const before = document.activeElement as HTMLElement | null
    const items = (): HTMLButtonElement[] =>
      Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? []
      )
    items()[0]?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeMenu()
        return
      }
      const list = items()
      const at = list.indexOf(document.activeElement as HTMLButtonElement)
      const target =
        e.key === 'ArrowDown'
          ? list[(at + 1) % list.length]
          : e.key === 'ArrowUp'
            ? list[(at - 1 + list.length) % list.length]
            : e.key === 'Home'
              ? list[0]
              : e.key === 'End'
                ? list[list.length - 1]
                : null
      if (target) {
        e.preventDefault()
        e.stopPropagation()
        target.focus()
      } else if (e.key === 'Tab') e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', closeMenu)
      // Unless the item moved it on purpose, e.g. into a dialog
      if (!document.activeElement || document.activeElement === document.body)
        before?.focus({ preventScroll: true })
    }
  }, [menu, closeMenu])

  if (!menu) return null
  return (
    <div
      className="menu-backdrop"
      onMouseDown={closeMenu}
      onContextMenu={(e) => {
        e.preventDefault()
        // The menu key sends one on release, to the item it just focused
        if (!ref.current?.contains(e.target as Node)) closeMenu()
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
      <Suspense>
        <RebaseEditor />
        <SplitEditor />
        <ReleaseNotes />
        <IgnoredFiles />
        <CleanUp />
        <BranchOverview />
        <RepoHealth />
        <Hooks />
        <Preferences />
      </Suspense>
      <CommandPalette />
      <RepoDialogs />
      <FormDialog />
      <Toasts />
    </>
  )
}
