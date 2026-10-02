// Transient UI state: toasts, modal dialogs and the context menu.
import { create } from 'zustand'
import type { CleanScope, RebaseCommit } from '../../shared/api'
import type { FileChange } from '../../shared/types'

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
  /**
   * Adds a Browse button to a folder path: the folder picked, titled with this, replaces the
   * parent and keeps the last name
   */
  browseParent?: string
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

/** The ignored files dialog, and the path it checks first. */
export interface IgnoredSession {
  repo: string
  path: string
}

/** The branch overview of a repository. */
export interface BranchesSession {
  repo: string
}

export interface HealthSession {
  repo: string
}

export interface HooksSession {
  repo: string
}

/** A patch file to look at before applying it */
export interface PatchSession {
  repo: string
  path: string
}

/** The clean up dialog, and the files it starts with. */
export interface CleanSession {
  repo: string
  scope: CleanScope
}

/** The range shown in the release notes dialog. */
export interface ReleaseNotesSession {
  repo: string
  /** Tag the notes end at, or HEAD */
  to: string
}

/** The commit shown in the split dialog. */
export interface SplitSession {
  repo: string
  hash: string
  message: string
  files: FileChange[]
  /** The last commit of the branch: no commits after it to recreate */
  isHead: boolean
  /** Remote branch the commit is already on, to warn of the force push */
  pushedTo?: string
}

interface UiState {
  toasts: Toast[]
  form: OpenForm | null
  menu: OpenMenu | null
  rebase: RebaseSession | null
  split: SplitSession | null
  releaseNotes: ReleaseNotesSession | null
  ignored: IgnoredSession | null
  clean: CleanSession | null
  branches: BranchesSession | null
  health: HealthSession | null
  hooks: HooksSession | null
  patch: PatchSession | null
  /** Command palette open */
  palette: boolean
  /** Workspace dashboard open */
  dashboard: boolean
  /** Clone or new repository dialog open */
  repoDialog: 'clone' | 'init' | null
  preferences: boolean
  dismiss(id: number): void
  closeForm(values: FormValues | null): void
  closeMenu(): void
}

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  form: null,
  menu: null,
  rebase: null,
  split: null,
  releaseNotes: null,
  ignored: null,
  clean: null,
  branches: null,
  health: null,
  hooks: null,
  patch: null,
  palette: false,
  dashboard: false,
  repoDialog: null,
  preferences: false,
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

export const openPreferences = (): void => useUi.setState({ preferences: true })

export function openMenu(event: React.MouseEvent, items: MenuItem[]): void {
  event.preventDefault()
  event.stopPropagation()
  useUi.setState({ menu: { x: event.clientX, y: event.clientY, items } })
}

/** Opens a context menu at a position, e.g. to follow up on a choice made in another menu. */
export function openMenuAt(x: number, y: number, items: MenuItem[]): void {
  useUi.setState({ menu: { x, y, items } })
}
