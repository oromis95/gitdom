// Dialogs that bring a repository onto the machine: clone from a URL and create a new one.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import type { CloneProgress } from '../../../shared/api'
import { GITIGNORE_TEMPLATES, LICENSE_TEMPLATES, repoNameFromUrl } from '../../../shared/templates'
import { useApp } from '../store'
import { notify, useUi } from '../ui'

// Last folder repositories were cloned or created in, proposed again next time
const PARENT_KEY = 'gitdom.parentFolder'

let nextCloneId = 1

function FolderField({
  value,
  onChange,
  disabled
}: {
  value: string
  onChange(value: string): void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className="modal-field">
      <span>Parent folder</span>
      <div className="folder-field">
        <input
          value={value}
          disabled={disabled}
          placeholder="C:\Users\me\Projects"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={async () => {
            const folder = await window.api.repos.pickFolder('Choose the parent folder')
            if (folder) onChange(folder)
          }}
        >
          <FolderOpen size={14} /> Browse…
        </button>
      </div>
    </label>
  )
}

/** Where the repository will end up, as the user types. */
function TargetHint({ parent, name }: { parent: string; name: string }): React.JSX.Element | null {
  if (!parent.trim() || !name.trim()) return null
  const sep = parent.includes('/') && !parent.includes('\\') ? '/' : '\\'
  return (
    <div className="modal-hint">
      Creates <code>{parent.trim().replace(/[\\/]+$/, '') + sep + name.trim()}</code>
    </div>
  )
}

function CloneDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const openRepo = useApp((s) => s.openRepo)
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState(() => localStorage.getItem(PARENT_KEY) ?? '')
  const [name, setName] = useState('')
  // The folder name follows the URL until the user edits it
  const [nameEdited, setNameEdited] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [branch, setBranch] = useState('')
  const [depth, setDepth] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [running, setRunning] = useState<number | null>(null)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [error, setError] = useState<{ message: string; details?: string } | null>(null)
  const cancelled = useRef(false)

  useEffect(
    () =>
      window.api.repos.onCloneProgress((id, p) => {
        if (id === running) setProgress(p)
      }),
    [running]
  )

  const depthValue = depth.trim() ? Number(depth) : undefined
  const depthValid = depthValue === undefined || (Number.isInteger(depthValue) && depthValue > 0)
  const valid = url.trim() && parent.trim() && name.trim() && depthValid

  const start = async (): Promise<void> => {
    if (!valid || running !== null) return
    const id = nextCloneId++
    cancelled.current = false
    setRunning(id)
    setProgress(null)
    setError(null)
    localStorage.setItem(PARENT_KEY, parent.trim())
    const result = await window.api.repos.clone(id, {
      url: url.trim(),
      parent: parent.trim(),
      name: name.trim(),
      branch: branch.trim() || undefined,
      depth: depthValue,
      recursive
    })
    setRunning(null)
    if (result.ok) {
      onClose()
      notify('success', `Cloned ${name.trim()}`)
      await openRepo(result.value)
    } else if (!cancelled.current) {
      setError({ message: result.error, details: result.details })
    }
  }

  const cancel = (): void => {
    if (running === null) return onClose()
    cancelled.current = true
    window.api.repos.cancelClone(running)
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => running === null && onClose()}>
      <form
        className="modal repo-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
        }}
      >
        <div className="modal-title">Clone a repository</div>
        <label className="modal-field">
          <span>URL (HTTPS or SSH)</span>
          <input
            autoFocus
            value={url}
            disabled={running !== null}
            placeholder="https://github.com/user/project.git"
            onChange={(e) => {
              setUrl(e.target.value)
              if (!nameEdited) setName(repoNameFromUrl(e.target.value))
            }}
          />
        </label>
        <FolderField value={parent} onChange={setParent} disabled={running !== null} />
        <label className="modal-field">
          <span>Folder name</span>
          <input
            value={name}
            disabled={running !== null}
            onChange={(e) => {
              setName(e.target.value)
              setNameEdited(true)
            }}
          />
        </label>
        <TargetHint parent={parent} name={name} />

        <button
          type="button"
          className="link options-toggle"
          onClick={() => setShowOptions(!showOptions)}
        >
          {showOptions ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Options
        </button>
        {showOptions && (
          <div className="repo-options">
            <label className="modal-field">
              <span>Branch (empty: the remote&apos;s default)</span>
              <input
                value={branch}
                disabled={running !== null}
                placeholder="main"
                onChange={(e) => setBranch(e.target.value)}
              />
            </label>
            <label className="modal-field">
              <span>History depth (empty: full history)</span>
              <input
                value={depth}
                disabled={running !== null}
                placeholder="e.g. 50"
                inputMode="numeric"
                className={depthValid ? '' : 'invalid'}
                onChange={(e) => setDepth(e.target.value)}
              />
            </label>
            <label className="modal-check">
              <input
                type="checkbox"
                checked={recursive}
                disabled={running !== null}
                onChange={(e) => setRecursive(e.target.checked)}
              />
              Clone submodules too
            </label>
          </div>
        )}

        {running !== null && (
          <div className="clone-progress">
            <div className="clone-progress-label">
              <span>{progress?.phase ?? 'Connecting…'}</span>
              {progress?.percent != null && <span>{progress.percent}%</span>}
            </div>
            <div className={`progress-bar${progress?.percent == null ? ' indeterminate' : ''}`}>
              <div style={{ width: `${progress?.percent ?? 0}%` }} />
            </div>
          </div>
        )}
        {error && (
          <div className="modal-error">
            {error.message}
            {error.details && error.details !== error.message && <pre>{error.details}</pre>}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || running !== null}>
            {running !== null ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </form>
    </div>
  )
}

function InitDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const openRepo = useApp((s) => s.openRepo)
  const [parent, setParent] = useState(() => localStorage.getItem(PARENT_KEY) ?? '')
  const [name, setName] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [gitignore, setGitignore] = useState('')
  const [license, setLicense] = useState('')
  const [readme, setReadme] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = parent.trim() && name.trim() && defaultBranch.trim()

  const create = async (): Promise<void> => {
    if (!valid || running) return
    setRunning(true)
    setError(null)
    localStorage.setItem(PARENT_KEY, parent.trim())
    const result = await window.api.repos.init({
      parent: parent.trim(),
      name: name.trim(),
      defaultBranch: defaultBranch.trim(),
      gitignore: gitignore || null,
      license: license || null,
      readme
    })
    setRunning(false)
    if (!result.ok) return setError(result.error)
    onClose()
    const files = readme || gitignore || license
    if (files && !result.value.committed) {
      notify(
        'warning',
        'Repository created. The starter files are staged but not committed: set your identity, then commit them.'
      )
    } else {
      notify('success', `Created ${name.trim()}`)
    }
    await openRepo(result.value.path)
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !running && onClose()}>
      <form
        className="modal repo-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !running) onClose()
        }}
      >
        <div className="modal-title">New repository</div>
        <label className="modal-field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <FolderField value={parent} onChange={setParent} />
        <TargetHint parent={parent} name={name} />
        <label className="modal-field">
          <span>Default branch</span>
          <input value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
        </label>
        <div className="repo-options-row">
          <label className="modal-field">
            <span>.gitignore</span>
            <select value={gitignore} onChange={(e) => setGitignore(e.target.value)}>
              <option value="">None</option>
              {GITIGNORE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="modal-field">
            <span>License</span>
            <select value={license} onChange={(e) => setLicense(e.target.value)}>
              <option value="">None</option>
              {LICENSE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="modal-check">
          <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} />
          Add a README
        </label>
        {(readme || gitignore || license) && (
          <div className="modal-hint">The starter files go in a first commit.</div>
        )}
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={running} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid || running}>
            Create
          </button>
        </div>
      </form>
    </div>
  )
}

export default function RepoDialogs(): React.JSX.Element | null {
  const dialog = useUi((s) => s.repoDialog)
  const close = (): void => useUi.setState({ repoDialog: null })
  if (dialog === 'clone') return <CloneDialog onClose={close} />
  if (dialog === 'init') return <InitDialog onClose={close} />
  return null
}
