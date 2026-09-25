import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  History,
  List,
  ListTree,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  X
} from 'lucide-react'
import type { CommitOptions, Result } from '../../../shared/api'
import { lfsMatcher } from '../../../shared/lfs'
import type {
  CommitDetail,
  DiffSource,
  FileChange,
  RepoSnapshot,
  Signature
} from '../../../shared/types'
import {
  EMPTY_DRAFT,
  WIP_HASH,
  useActiveTab,
  useApp,
  type CompareTarget,
  type DiffTarget
} from '../store'
import { notify, openMenu, type MenuItem } from '../ui'
import { roomBeside, updateSettings } from '../settings'
import ResizeHandle from './ResizeHandle'
import {
  abortOperation,
  conflictMenu,
  continueOperation,
  discardFiles,
  ignoreFile,
  lfsPatternFor,
  lfsTrack,
  markResolved,
  openInEditor,
  reword,
  run,
  showInFolder,
  runValue,
  skipOperation,
  stashFiles
} from '../actions'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const SUMMARY_LIMIT = 72
const VIEW_KEY = 'gitdom.fileView'

type FileView = 'path' | 'tree'

/** The layout of the file lists, the same in every panel and remembered. */
function useFileView(): [FileView, (view: FileView) => void] {
  const [view, setView] = useState<FileView>(() =>
    localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'path'
  )
  const change = (next: FileView): void => {
    localStorage.setItem(VIEW_KEY, next)
    setView(next)
  }
  return [view, change]
}

function ViewToggle({
  view,
  onChange
}: {
  view: FileView
  onChange: (view: FileView) => void
}): React.JSX.Element {
  return (
    <div className="view-toggle">
      <button
        className={view === 'path' ? 'on' : ''}
        onClick={() => onChange('path')}
        title="Path view"
      >
        <List size={15} />
      </button>
      <button
        className={view === 'tree' ? 'on' : ''}
        onClick={() => onChange('tree')}
        title="Tree view"
      >
        <ListTree size={15} />
      </button>
    </div>
  )
}
type ListKind = 'conflicted' | 'unstaged' | 'staged' | 'commit' | 'compare'

function sourceFor(
  kind: ListKind,
  file: FileChange,
  hash?: string,
  compare?: CompareTarget
): DiffSource {
  if (kind === 'commit') return { kind: 'commit', hash: hash! }
  if (kind === 'compare') return { kind: 'compare', ...compare! }
  if (kind === 'unstaged' && file.status === '?') return { kind: 'untracked' }
  if (kind === 'conflicted') return { kind: 'unstaged' }
  return { kind }
}

/** Paths to pass to stage/unstage: renames need the old path too. */
const pathsOf = (files: FileChange[]): string[] =>
  files.flatMap((f) => (f.oldPath && f.oldPath !== f.path ? [f.oldPath, f.path] : [f.path]))

interface FolderNode {
  name: string
  path: string
  folders: Map<string, FolderNode>
  files: FileChange[]
}

function buildFolders(files: FileChange[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let child = node.folders.get(part)
      if (!child) {
        child = {
          name: part,
          path: node.path ? `${node.path}/${part}` : part,
          folders: new Map(),
          files: []
        }
        node.folders.set(part, child)
      }
      node = child
    }
    node.files.push(file)
  }
  return root
}

function allFiles(node: FolderNode): FileChange[] {
  return [...node.files, ...[...node.folders.values()].flatMap(allFiles)]
}

/** Renders files as a flat list or a folder tree, with an optional hover action per file and folder. */
function FileList({
  files,
  kind,
  view = 'path',
  repo,
  hash,
  compare,
  action
}: {
  files: FileChange[]
  kind: ListKind
  view?: FileView
  repo: string
  hash?: string
  compare?: CompareTarget
  /** Hover button, e.g. Stage: applies to one file or to a whole folder */
  action?: { label: string; run: (files: FileChange[]) => void }
}): React.JSX.Element {
  const openDiff = useApp((s) => s.openDiff)
  const inspectFile = useApp((s) => s.inspectFile)
  const activeTab = useActiveTab()
  const activeDiff = activeTab?.diff
  const lfs = activeTab?.snapshot?.lfs
  // Snapshots are new objects on every refresh: the matcher is rebuilt only when the patterns change
  const lfsKey = JSON.stringify(lfs?.patterns ?? [])
  const isLfs = useMemo(() => lfsMatcher(JSON.parse(lfsKey)), [lfsKey])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const tree = useMemo(() => (view === 'tree' ? buildFolders(files) : null), [files, view])

  const isActive = (f: FileChange): boolean =>
    activeDiff?.path === f.path && activeDiff.source.kind === sourceFor(kind, f, hash, compare).kind

  const menuFor = (f: FileChange): MenuItem[] => [
    ...(kind === 'conflicted' ? conflictMenu(repo, [f.path]) : []),
    ...(action && kind !== 'conflicted'
      ? [{ label: action.label, onClick: () => action.run([f]) }]
      : []),
    ...(kind === 'unstaged'
      ? [
          {
            label: f.status === '?' ? 'Delete file' : 'Discard changes',
            danger: true,
            onClick: () => void discardFiles(repo, [f])
          }
        ]
      : []),
    ...(kind === 'unstaged' || kind === 'staged'
      ? [
          'separator' as const,
          { label: 'Stash changes to this file…', onClick: () => void stashFiles(repo, [f]) },
          {
            label: f.status === '?' ? 'Add to .gitignore…' : 'Stop tracking and ignore…',
            disabled: f.status === 'D',
            onClick: () => void ignoreFile(repo, f)
          }
        ]
      : []),
    'separator' as const,
    {
      label: 'Open in editor',
      disabled: f.status === 'D',
      onClick: () => void openInEditor(repo, f.path)
    },
    {
      label: 'Show in Explorer',
      disabled: f.status === 'D',
      onClick: () => showInFolder(repo, f.path)
    },
    'separator' as const,
    ...(f.status !== '?'
      ? [
          {
            label: 'File history',
            onClick: () => inspectFile({ path: f.path, mode: 'history', rev: null })
          },
          {
            label: 'Blame',
            disabled: f.status === 'D' || kind === 'conflicted' || kind === 'compare',
            onClick: () =>
              inspectFile({ path: f.path, mode: 'blame', rev: kind === 'commit' ? hash! : null })
          },
          'separator' as const
        ]
      : []),
    ...(lfs?.installed && !isLfs(f.path)
      ? [
          {
            label: `Track ${lfsPatternFor(f.path)} with LFS`,
            onClick: () => void lfsTrack(repo, lfsPatternFor(f.path))
          },
          'separator' as const
        ]
      : []),
    {
      label: 'Copy file path',
      onClick: () => {
        void navigator.clipboard.writeText(f.path)
        notify('info', 'Copied file path')
      }
    }
  ]

  const fileRow = (f: FileChange, depth: number, label: string): React.JSX.Element => {
    const target: DiffTarget = {
      source: sourceFor(kind, f, hash, compare),
      path: f.path,
      oldPath: f.oldPath,
      merge: kind === 'conflicted' || undefined
    }
    return (
      <div
        key={(f.oldPath ?? '') + f.path}
        className={`file-row${isActive(f) ? ' active' : ''}`}
        style={{ paddingLeft: 4 + depth * 16 }}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        onClick={() => openDiff(target)}
        onContextMenu={(e) => openMenu(e, menuFor(f))}
      >
        <span className={`file-status status-${f.status}`}>
          {f.status === '?' ? 'A' : f.status}
        </span>
        <span className="file-path">
          <bdi>{label}</bdi>
        </span>
        {isLfs(f.path) && (
          <span className="lfs-badge" title="Stored with Git LFS">
            LFS
          </span>
        )}
        {action && (
          <button
            className="row-action"
            onClick={(e) => {
              e.stopPropagation()
              action.run([f])
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    )
  }

  const folderRows = (node: FolderNode, depth: number): React.JSX.Element[] => {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))
    const rows: React.JSX.Element[] = []
    for (const folder of folders) {
      const isCollapsed = collapsed.has(folder.path)
      rows.push(
        <div
          key={`dir:${folder.path}`}
          className="file-row"
          style={{ paddingLeft: 4 + depth * 16 }}
          onClick={() =>
            setCollapsed((prev) => {
              const next = new Set(prev)
              if (isCollapsed) next.delete(folder.path)
              else next.add(folder.path)
              return next
            })
          }
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <Folder size={14} className="muted" />
          <span className="file-path">
            <bdi>{folder.name}</bdi>
          </span>
          {action && (
            <button
              className="row-action"
              onClick={(e) => {
                e.stopPropagation()
                action.run(allFiles(folder))
              }}
            >
              {action.label} folder
            </button>
          )}
        </div>
      )
      if (!isCollapsed) rows.push(...folderRows(folder, depth + 1))
    }
    for (const f of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push(fileRow(f, depth, f.path.split('/').pop()!))
    }
    return rows
  }

  return <div>{tree ? folderRows(tree, 0) : files.map((f) => fileRow(f, 0, f.path))}</div>
}

/** A commit message template (COMMIT-10): its text, and its comment lines as a hint. */
interface Template {
  summary: string
  description: string
  hint: string
}

function splitTemplate(template: string): Template {
  const lines = template.replace(/\r/g, '').split('\n')
  const comment = (line: string): boolean => line.startsWith('#')
  const hint = lines
    .filter(comment)
    .map((l) => l.replace(/^#\s?/, ''))
    .join('\n')
    .trim()
  const [summary = '', ...rest] = lines
    .filter((l) => !comment(l))
    .join('\n')
    // Keep the spaces ending the summary, e.g. "feat: " to type after
    .replace(/^\s*\n|\n\s*$/g, '')
    .split('\n')
  return { summary, description: rest.join('\n').trim(), hint }
}

// Repositories whose template has filled the message box once: clearing it keeps it clear
const templated = new Set<string>()

/** The commit template of a repository, null while loading or when it has none. */
function useTemplate(repo: string): Template | null {
  const [loaded, setLoaded] = useState<{ repo: string; template: Template | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'commitTemplate').then((result) => {
      if (cancelled) return
      setLoaded({ repo, template: result.ok && result.value ? splitTemplate(result.value) : null })
    })
    return () => {
      cancelled = true
    }
  }, [repo])
  return loaded?.repo === repo ? loaded.template : null
}

const SUGGESTIONS = 12

/** Latest distinct subjects of the identity's commits, to reuse one (COMMIT-10). */
function recentSubjects(snapshot: RepoSnapshot): string[] {
  const email = snapshot.identity.email?.toLowerCase()
  const subjects = new Set<string>()
  for (const c of snapshot.commits) {
    if (subjects.size >= SUGGESTIONS) break
    if (c.parents.length > 1 || (email && c.authorEmail.toLowerCase() !== email)) continue
    subjects.add(c.subject)
  }
  return [...subjects]
}

function CommitBox({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const tab = useActiveTab()!
  const setDraft = useApp((s) => s.setDraft)
  const repo = snapshot.path
  const { summary, description, amend, noVerify, sign, author } = tab.draft
  const [committing, setCommitting] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const template = useTemplate(repo)
  const staged = snapshot.status.staged.length
  const remaining = SUMMARY_LIMIT - summary.length
  const canCommit = !committing && summary.trim() !== '' && (staged > 0 || amend)
  const signed = sign ?? snapshot.signing.commits
  const identity = snapshot.identity.name
    ? `${snapshot.identity.name} <${snapshot.identity.email ?? ''}>`
    : 'Name <email>'

  // The template starts the first message, as git does when it opens the editor
  useEffect(() => {
    if (!template || templated.has(repo)) return
    templated.add(repo)
    const draft = useApp.getState().tabs.find((t) => t.path === repo)?.draft
    if (draft && !draft.summary && !draft.description && !draft.amend) {
      setDraft(repo, { summary: template.summary, description: template.description })
    }
  }, [repo, template, setDraft])

  const toggleAmend = async (checked: boolean): Promise<void> => {
    setDraft(repo, { amend: checked })
    // Start from the previous message, as `git commit --amend` does
    const untouched =
      (!summary.trim() && !description.trim()) ||
      (template && summary === template.summary && description === template.description)
    if (checked && untouched) {
      const result = await window.api.op(repo, 'lastCommitMessage')
      if (result.ok) {
        const [first, ...rest] = result.value.split('\n')
        setDraft(repo, { summary: first, description: rest.join('\n').trim() })
      }
    }
  }

  const commit = async (): Promise<void> => {
    if (!canCommit) return
    setCommitting(true)
    const message = description.trim()
      ? `${summary.trim()}\n\n${description.trim()}`
      : summary.trim()
    const options: CommitOptions = {
      noVerify: noVerify || undefined,
      sign: sign ?? undefined,
      author: author.trim() || undefined
    }
    const output = await runValue(repo, 'commit', message, amend, options)
    setCommitting(false)
    if (output !== undefined) {
      // Options apply to one commit: the next one starts over, from the template if any
      setDraft(repo, {
        ...EMPTY_DRAFT,
        summary: template?.summary ?? '',
        description: template?.description ?? ''
      })
      notify('success', amend ? 'Commit amended' : 'Committed', output)
    }
  }

  const suggest = (e: React.MouseEvent): void => {
    const subjects = recentSubjects(snapshot)
    openMenu(
      e,
      subjects.length
        ? subjects.map((s) => ({
            label: s.length > 70 ? s.slice(0, 69) + '…' : s,
            onClick: () => setDraft(repo, { summary: s })
          }))
        : [{ label: 'No commits of yours yet', disabled: true, onClick: () => undefined }]
    )
  }

  const chips = [
    ...(noVerify ? ['Hooks skipped'] : []),
    ...(signed ? ['Signed'] : []),
    ...(author.trim() ? [`Author: ${author.trim()}`] : [])
  ]
  const overrides = Number(noVerify) + Number(sign !== null) + Number(!!author.trim())

  const label = committing
    ? 'Committing…'
    : amend
      ? 'Amend previous commit'
      : staged > 0
        ? `Commit changes to ${staged} file${staged === 1 ? '' : 's'}`
        : 'Stage changes to commit'

  return (
    <div
      className="commit-box"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault()
          void commit()
        }
      }}
    >
      <div className="commit-box-row">
        <label className="modal-check">
          <input
            type="checkbox"
            checked={amend}
            disabled={!snapshot.head.hash}
            onChange={(e) => void toggleAmend(e.target.checked)}
          />
          Amend previous commit
        </label>
        <span className="toolbar-spacer" />
        <button className="commit-box-tool" title="Reuse a recent message" onClick={suggest}>
          <History size={14} />
        </button>
        <button
          className={`commit-box-tool${showOptions ? ' on' : ''}`}
          title="Commit options: hooks, signature, author"
          onClick={() => setShowOptions(!showOptions)}
        >
          <SlidersHorizontal size={14} />
          {overrides > 0 && <span className="commit-box-count">{overrides}</span>}
        </button>
        <span className={`summary-counter${remaining < 0 ? ' over' : ''}`}>{remaining}</span>
      </div>
      {showOptions ? (
        <div className="commit-options">
          <label className="modal-check">
            <input
              type="checkbox"
              checked={noVerify}
              onChange={(e) => setDraft(repo, { noVerify: e.target.checked })}
            />
            Skip hooks (--no-verify)
          </label>
          <label className="modal-check">
            <input
              type="checkbox"
              checked={signed}
              onChange={(e) =>
                setDraft(repo, {
                  sign: e.target.checked === snapshot.signing.commits ? null : e.target.checked
                })
              }
            />
            Sign the commit
            {snapshot.signing.commits && <span className="muted"> (on by default)</span>}
          </label>
          <input
            placeholder={`Author: ${identity}`}
            title="Commit on behalf of someone else, as Name <email>: you stay the committer"
            value={author}
            onChange={(e) => setDraft(repo, { author: e.target.value })}
          />
        </div>
      ) : (
        chips.length > 0 && (
          <div className="commit-chips">
            {chips.map((c) => (
              <span key={c} className="commit-chip">
                {c}
              </span>
            ))}
          </div>
        )
      )}
      <input
        placeholder="Commit summary"
        value={summary}
        onChange={(e) => setDraft(repo, { summary: e.target.value })}
      />
      <textarea
        placeholder={template?.hint || 'Description'}
        rows={4}
        value={description}
        onChange={(e) => setDraft(repo, { description: e.target.value })}
      />
      <button
        className="primary"
        disabled={!canCommit}
        onClick={() => void commit()}
        title="Ctrl+Enter"
      >
        {label}
      </button>
    </div>
  )
}

function OperationBanner({
  snapshot,
  conflicts
}: {
  snapshot: RepoSnapshot
  conflicts: number
}): React.JSX.Element {
  const operation = snapshot.operation!
  const repo = snapshot.path
  return (
    <div className="banner-warning operation-banner">
      <div>
        <strong>A {operation} is in progress.</strong>{' '}
        {conflicts > 0
          ? `Resolve ${conflicts} conflicted file${conflicts === 1 ? '' : 's'}: edit ${
              conflicts === 1 ? 'it' : 'them'
            } and mark resolved, or pick one side, then continue.`
          : `No conflicts left: continue to finish the ${operation}.`}
      </div>
      <div className="operation-actions">
        <button
          className="btn btn-small btn-danger-outline"
          onClick={() => void abortOperation(repo, operation)}
        >
          Abort {operation}
        </button>
        {operation !== 'merge' && (
          <button
            className="btn btn-small"
            title="Leave out the commit that stopped the operation"
            onClick={() => void skipOperation(repo, operation)}
          >
            Skip commit
          </button>
        )}
        <button
          className="btn btn-small btn-primary"
          disabled={conflicts > 0}
          title={conflicts > 0 ? 'Resolve all conflicts first' : undefined}
          onClick={() => void continueOperation(repo, operation)}
        >
          Continue {operation}
        </button>
      </div>
    </div>
  )
}

/** The repository snapshot once HEAD has moved from `head`: null after a few seconds. */
function snapshotAfter(repo: string, head: string | null): Promise<RepoSnapshot | null> {
  const current = (): RepoSnapshot | undefined => {
    const snapshot = useApp.getState().tabs.find((t) => t.path === repo)?.snapshot
    return snapshot && snapshot.head.hash !== head ? snapshot : undefined
  }
  return new Promise((resolve) => {
    if (current()) return resolve(current()!)
    const done = (snapshot: RepoSnapshot | null): void => {
      clearTimeout(timer)
      unsubscribe()
      resolve(snapshot)
    }
    const timer = setTimeout(() => done(null), 5000)
    const unsubscribe = useApp.subscribe(() => {
      const snapshot = current()
      if (snapshot) done(snapshot)
    })
    void useApp.getState().refreshPath(repo)
  })
}

function WorkingTreePanel({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const { staged } = snapshot.status
  const conflicted = snapshot.status.unstaged.filter((f) => f.status === 'U')
  const unstaged = snapshot.status.unstaged.filter((f) => f.status !== 'U')
  const repo = snapshot.path
  const [view, changeView] = useFileView()

  return (
    <>
      <div className="detail-scroll">
        <div className="detail-title-row">
          <div className="detail-title">
            {staged.length + snapshot.status.unstaged.length} file changes on{' '}
            <span className="link">{snapshot.head.branch ?? 'HEAD'}</span>
          </div>
          <ViewToggle view={view} onChange={changeView} />
        </div>
        {snapshot.operation && (
          <OperationBanner snapshot={snapshot} conflicts={conflicted.length} />
        )}
        {conflicted.length > 0 && (
          <div>
            <div className="file-group-title conflict-title">
              <ChevronDown size={15} /> Conflicted Files ({conflicted.length})
              <span className="toolbar-spacer" />
              <button
                className="btn btn-small"
                onClick={(e) => openMenu(e, conflictMenu(repo, pathsOf(conflicted)))}
              >
                Resolve all…
              </button>
            </div>
            <FileList
              files={conflicted}
              kind="conflicted"
              view={view}
              repo={repo}
              action={{
                label: 'Mark resolved',
                run: (files) => void markResolved(repo, pathsOf(files))
              }}
            />
          </div>
        )}
        <div>
          <div className="file-group-title">
            <ChevronDown size={15} /> Unstaged Files ({unstaged.length})
            <span className="toolbar-spacer" />
            {unstaged.length > 0 && (
              <button
                className="btn btn-small btn-stage"
                onClick={() =>
                  // With conflicts, stage everything else: conflicted files are marked resolved explicitly
                  void (conflicted.length > 0
                    ? run(repo, 'stage', pathsOf(unstaged))
                    : run(repo, 'stageAll'))
                }
              >
                Stage all changes
              </button>
            )}
          </div>
          <FileList
            files={unstaged}
            kind="unstaged"
            view={view}
            repo={repo}
            action={{ label: 'Stage', run: (files) => void run(repo, 'stage', pathsOf(files)) }}
          />
        </div>
        <div>
          <div className="file-group-title">
            <ChevronDown size={15} /> Staged Files ({staged.length})
            <span className="toolbar-spacer" />
            {staged.length > 0 && (
              <button
                className="btn btn-small btn-unstage"
                onClick={() => void run(repo, 'unstageAll')}
              >
                Unstage all changes
              </button>
            )}
          </div>
          <FileList
            files={staged}
            kind="staged"
            view={view}
            repo={repo}
            action={{ label: 'Unstage', run: (files) => void run(repo, 'unstage', pathsOf(files)) }}
          />
        </div>
      </div>
      <CommitBox snapshot={snapshot} />
    </>
  )
}

const SIGNATURES: Record<
  Signature['status'],
  { label: string; tone: 'good' | 'warn' | 'bad'; hint: string }
> = {
  good: { label: 'Verified', tone: 'good', hint: 'Signed with a trusted key' },
  untrusted: {
    label: 'Signed, key not trusted',
    tone: 'warn',
    hint: 'The signature is valid, but the key is not trusted: for SSH keys, list it in gpg.ssh.allowedSignersFile'
  },
  bad: { label: 'Bad signature', tone: 'bad', hint: 'The commit was changed after it was signed' },
  expired: { label: 'Expired signature', tone: 'warn', hint: 'The signature or its key expired' },
  revoked: { label: 'Revoked key', tone: 'bad', hint: 'The key that signed was revoked' },
  unknown: {
    label: 'Signed, cannot verify',
    tone: 'warn',
    hint: 'The public key is missing, or the signing program is not available'
  }
}

/** Verification of the commit signature (DETAIL-05). */
function SignatureBadge({ signature }: { signature: Signature }): React.JSX.Element {
  const { label, tone, hint } = SIGNATURES[signature.status]
  const Icon = tone === 'good' ? ShieldCheck : tone === 'bad' ? ShieldX : ShieldAlert
  return (
    <span
      className={`signature-badge signature-${tone}`}
      title={`${hint}${signature.key ? `\nKey: ${signature.key}` : ''}`}
    >
      <Icon size={13} /> {label}
      {signature.signer && <span className="muted"> · {signature.signer}</span>}
    </span>
  )
}

function CommitPanel({ repoPath, hash }: { repoPath: string; hash: string }): React.JSX.Element {
  const select = useApp((s) => s.select)
  const snapshot = useActiveTab()?.snapshot
  // Keyed by the requested hash so a stale response is never shown for a new selection
  const [loaded, setLoaded] = useState<{
    hash: string
    result: Result<CommitDetail>
    onBranch: boolean
  } | null>(null)
  // The message being edited (DETAIL-04), null when not editing
  const [editing, setEditing] = useState<{ hash: string; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const head = snapshot?.head.hash
  const [view, changeView] = useFileView()

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.api.op(repoPath, 'commitDetail', hash),
      head ? window.api.op(repoPath, 'isAncestor', hash, head) : null
    ]).then(([result, ancestor]) => {
      if (!cancelled) setLoaded({ hash, result, onBranch: !!ancestor?.ok && ancestor.value })
    })
    return () => {
      cancelled = true
    }
  }, [repoPath, hash, head])

  if (!loaded || loaded.hash !== hash) return <div className="center-message">Loading…</div>
  if (!loaded.result.ok)
    return <div className="detail-scroll banner-error">{loaded.result.error}</div>
  const detail = loaded.result.value
  const message = detail.body ? `${detail.subject}\n\n${detail.body}` : detail.subject
  const canReword =
    loaded.onBranch && !!snapshot?.head.branch && !snapshot.operation && !!snapshot.head.hash
  const draft = editing?.hash === hash ? editing.message : null

  const save = async (): Promise<void> => {
    if (!snapshot || draft === null || !draft.trim()) return
    if (draft.trim() === message.trim()) {
      setEditing(null)
      return
    }
    // The reworded commit gets a new hash, as many first parents below HEAD as the old one
    let depth = 0
    const byHash = new Map(snapshot.commits.map((c) => [c.hash, c]))
    for (let c = byHash.get(snapshot.head.hash!); c && c.hash !== hash; depth++) {
      c = byHash.get(c.parents[0])
    }
    setSaving(true)
    const ok = await reword(repoPath, snapshot, hash, draft.trim())
    setSaving(false)
    if (!ok) return
    setEditing(null)
    const updated = await snapshotAfter(repoPath, snapshot.head.hash)
    const after = new Map(updated?.commits.map((c) => [c.hash, c]))
    let moved = after.get(updated?.head.hash ?? '')
    for (let i = 0; i < depth && moved; i++) moved = after.get(moved.parents[0])
    if (moved) select(moved.hash, true)
  }

  return (
    <div className="detail-scroll">
      {draft !== null ? (
        <div
          className="reword-box"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault()
              void save()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(null)
            }
          }}
        >
          <textarea
            autoFocus
            rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
            value={draft}
            onChange={(e) => setEditing({ hash, message: e.target.value })}
          />
          <div className="reword-actions">
            <span className="muted">
              {hash === snapshot?.head.hash
                ? 'Amends the last commit: staged changes are left out'
                : 'Rewrites this commit and the ones after it'}
            </span>
            <span className="toolbar-spacer" />
            <button className="btn btn-small" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              className="btn btn-small btn-primary"
              disabled={saving || !draft.trim()}
              title="Ctrl+Enter"
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save message'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="detail-title-row">
            <div className="detail-title">{detail.subject}</div>
            {canReword && (
              <button
                className="commit-box-tool"
                title="Edit the commit message"
                onClick={() => setEditing({ hash, message })}
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
          {detail.body && <div className="detail-body">{detail.body}</div>}
        </>
      )}
      <dl className="detail-meta">
        <dt>commit</dt>
        <dd className="mono">
          {detail.hash.slice(0, 10)}{' '}
          <Copy
            size={12}
            className="link"
            onClick={() => navigator.clipboard.writeText(detail.hash)}
            aria-label="Copy commit hash"
          />
        </dd>
        <dt>parents</dt>
        <dd className="mono">
          {detail.parents.map((p) => (
            <span
              key={p}
              className="link"
              onClick={() => select(p, true)}
              style={{ marginRight: 8 }}
            >
              {p.slice(0, 7)}
            </span>
          ))}
        </dd>
        <dt>author</dt>
        <dd>
          {detail.authorName} &lt;{detail.authorEmail}&gt;
        </dd>
        <dt>authored</dt>
        <dd>{dateFormat.format(detail.authorDate * 1000)}</dd>
        {(detail.committerName !== detail.authorName ||
          detail.committerDate !== detail.authorDate) && (
          <>
            <dt>committer</dt>
            <dd>
              {detail.committerName}, {dateFormat.format(detail.committerDate * 1000)}
            </dd>
          </>
        )}
        {detail.signature && (
          <>
            <dt>signature</dt>
            <dd>
              <SignatureBadge signature={detail.signature} />
            </dd>
          </>
        )}
      </dl>
      <div>
        <div className="file-group-title file-group-header">
          <span>
            {detail.files.length} changed files
            {detail.parents.length > 1 && <span className="muted"> (vs first parent)</span>}
          </span>
          <ViewToggle view={view} onChange={changeView} />
        </div>
        <FileList
          files={detail.files}
          kind="commit"
          view={view}
          repo={repoPath}
          hash={detail.hash}
        />
      </div>
    </div>
  )
}

const shortRev = (rev: string): string => (/^[0-9a-f]{40,64}$/i.test(rev) ? rev.slice(0, 7) : rev)

/** Files changed between two revisions picked in the graph or the sidebar (DIFF-08). */
function ComparePanel({
  repoPath,
  target
}: {
  repoPath: string
  target: CompareTarget
}): React.JSX.Element {
  const compare = useApp((s) => s.compare)
  const key = JSON.stringify(target)
  const [loaded, setLoaded] = useState<{ key: string; result: Result<FileChange[]> } | null>(null)
  const [view, changeView] = useFileView()

  useEffect(() => {
    let cancelled = false
    void window.api.op(repoPath, 'compareFiles', target.from, target.to).then((result) => {
      if (!cancelled) setLoaded({ key, result })
    })
    return () => {
      cancelled = true
    }
    // target is covered by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, key])

  let files: React.ReactNode
  if (!loaded || loaded.key !== key) files = <div className="center-message">Loading…</div>
  else if (!loaded.result.ok) files = <div className="banner-error">{loaded.result.error}</div>
  else if (!loaded.result.value.length)
    files = <div className="center-message">No differences between the two</div>
  else
    files = (
      <div>
        <div className="file-group-title">{loaded.result.value.length} changed files</div>
        <FileList
          files={loaded.result.value}
          kind="compare"
          view={view}
          repo={repoPath}
          compare={target}
        />
      </div>
    )

  return (
    <div className="detail-scroll">
      <div className="detail-title-row">
        <div className="detail-title">Comparing two revisions</div>
        <ViewToggle view={view} onChange={changeView} />
      </div>
      <dl className="detail-meta">
        <dt>from</dt>
        <dd className="mono" title={target.from}>
          {shortRev(target.from)}
        </dd>
        <dt>to</dt>
        <dd className="mono" title={target.to}>
          {shortRev(target.to)}
        </dd>
      </dl>
      <div className="compare-actions">
        <button
          className="btn btn-small"
          onClick={() => compare({ from: target.to, to: target.from })}
        >
          <ArrowLeftRight size={13} /> Swap
        </button>
        <button className="btn btn-small" onClick={() => compare(null)}>
          <X size={13} /> Close
        </button>
      </div>
      {files}
    </div>
  )
}

export default function DetailPanel({
  snapshot,
  selected,
  compare
}: {
  snapshot: RepoSnapshot
  selected: string | null
  compare?: CompareTarget
}): React.JSX.Element {
  let content: React.JSX.Element
  if (compare) content = <ComparePanel repoPath={snapshot.path} target={compare} />
  else if (selected === WIP_HASH) content = <WorkingTreePanel snapshot={snapshot} />
  else if (selected) content = <CommitPanel repoPath={snapshot.path} hash={selected} />
  else content = <div className="center-message">Select a commit</div>

  return (
    <aside className="detail">
      <ResizeHandle
        edge="left"
        min={300}
        max={() => roomBeside('.sidebar', 300)}
        onResize={(width) => updateSettings({ detailWidth: width })}
      />
      {content}
    </aside>
  )
}
