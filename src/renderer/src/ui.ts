// Transient UI state: toasts, modal dialogs and the context menu.
import { create } from 'zustand'
import type { RebaseCommit } from '../../shared/api'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  /** Full git output, shown on demand */
  details?: string
}

export interface FormField {
  key: string
  label: string
  initial?: string
  placeholder?: string
  multiline?: boolean
  /** Field may be left empty */
  optional?: boolean
  /** Makes the field a drop-down list */
  options?: { value: string; label: string }[]
}

export interface FormCheck {
  key: string
  label: string
  initial?: boolean
}

export interface FormSpec {
  title: string
  message?: string
  fields?: FormField[]
  checks?: FormCheck[]
  confirmLabel?: string
  danger?: boolean
}

export type FormValues = Record<string, string | boolean>

interface OpenForm extends FormSpec {
  resolve(values: FormValues | null): void
}

export type MenuItem =
  { label: string; onClick: () => void; danger?: boolean; disabled?: boolean } | 'separator'

interface OpenMenu {
  x: number
  y: number
  items: MenuItem[]
}

/** Commits shown in the interactive rebase editor. */
export interface RebaseSession {
  repo: string
  /** Commit the rewritten commits start from, null for the root */
  base: string | null
  commits: RebaseCommit[]
  /** Merge commits in the range: the rebase flattens them */
  merges: number
}

interface UiState {
  toasts: Toast[]
  form: OpenForm | null
  menu: OpenMenu | null
  rebase: RebaseSession | null
  /** Command palette open */
  palette: boolean
  /** Clone or new repository dialog open */
  repoDialog: 'clone' | 'init' | null
  dismiss(id: number): void
  closeForm(values: FormValues | null): void
  closeMenu(): void
}

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  form: null,
  menu: null,
  rebase: null,
  palette: false,
  repoDialog: null,
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  closeForm(values) {
    get().form?.resolve(values)
    set({ form: null })
  },
  closeMenu: () => set({ menu: null })
}))

let nextToastId = 1

/** Keys typed in the terminal belong to the shell, not to the app's shortcuts. */
export const fromTerminal = (e: KeyboardEvent): boolean =>
  e.target instanceof Element && e.target.closest('.terminal-dock') !== null

export function notify(kind: ToastKind, message: string, details?: string): void {
  const id = nextToastId++
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message, details }] }))
  // Errors and warnings stay longer: they usually need reading
  setTimeout(
    () => useUi.getState().dismiss(id),
    kind === 'error' || kind === 'warning' ? 15000 : 4000
  )
}

/** Shows a modal form; resolves with the values, or null when cancelled. */
export function showForm(spec: FormSpec): Promise<FormValues | null> {
  return new Promise((resolve) => {
    // A form opened while another is showing replaces it: the old one counts as cancelled
    useUi.getState().form?.resolve(null)
    useUi.setState({ form: { ...spec, resolve } })
  })
}

export async function prompt(
  title: string,
  label: string,
  initial = '',
  confirmLabel = 'OK'
): Promise<string | null> {
  const values = await showForm({ title, fields: [{ key: 'value', label, initial }], confirmLabel })
  return values ? String(values.value) : null
}

export async function confirm(
  title: string,
  message: string,
  confirmLabel = 'OK',
  danger = false
): Promise<boolean> {
  return (await showForm({ title, message, confirmLabel, danger })) !== null
}

export const openRepoDialog = (dialog: 'clone' | 'init'): void =>
  useUi.setState({ repoDialog: dialog })

export function openMenu(event: React.MouseEvent, items: MenuItem[]): void {
  event.preventDefault()
  event.stopPropagation()
  useUi.setState({ menu: { x: event.clientX, y: event.clientY, items } })
}

/** Opens a context menu at a position, e.g. to follow up on a choice made in another menu. */
export function openMenuAt(x: number, y: number, items: MenuItem[]): void {
  useUi.setState({ menu: { x, y, items } })
}
