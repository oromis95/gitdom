import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  List,
  ListTree,
  X
} from 'lucide-react'
import type { Result } from '../../../shared/api'
import { lfsMatcher } from '../../../shared/lfs'
import type { CommitDetail, DiffSource, FileChange, RepoSnapshot } from '../../../shared/types'
import { WIP_HASH, useActiveTab, useApp, type CompareTarget, type DiffTarget } from '../store'
import { notify, openMenu, type MenuItem } from '../ui'
import { roomBeside, updateSettings } from '../settings'
import ResizeHandle from './ResizeHandle'
import {
  abortOperation,
  conflictMenu,
  continueOperation,
  discardFiles,
  lfsPatternFor,
  lfsTrack,
  markResolved,
  openInEditor,
  run,
  showInFolder,
  runValue,
  skipOperation
} from '../actions'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const SUMMARY_LIMIT = 72
const VIEW_KEY = 'gitdom.fileView'

type FileView = 'path' | 'tree'
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
        <span className="file-path">{label}</span>
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
          <span className="file-path">{folder.name}</span>
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

function CommitBox({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const tab = useActiveTab()!
  const setDraft = useApp((s) => s.setDraft)
  const repo = snapshot.path
  const { summary, description, amend } = tab.draft
  const [committing, setCommitting] = useState(false)
  const staged = snapshot.status.staged.length
  const remaining = SUMMARY_LIMIT - summary.length
  const canCommit = !committing && summary.trim() !== '' && (staged > 0 || amend)

  const toggleAmend = async (checked: boolean): Promise<void> => {
    setDraft(repo, { amend: checked })
    // Start from the previous message, as `git commit --amend` does
    if (checked && !summary.trim() && !description.trim()) {
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
    const output = await runValue(repo, 'commit', message, amend)
    setCommitting(false)
    if (output !== undefined) {
      setDraft(repo, { summary: '', description: '', amend: false })
      notify('success', amend ? 'Commit amended' : 'Committed', output)
    }
  }

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
        <span className={`summary-counter${remaining < 0 ? ' over' : ''}`}>{remaining}</span>
      </div>
      <input
        placeholder="Commit summary"
        value={summary}
        onChange={(e) => setDraft(repo, { summary: e.target.value })}
      />
      <textarea
        placeholder="Description"
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

function WorkingTreePanel({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const { staged } = snapshot.status
  const conflicted = snapshot.status.unstaged.filter((f) => f.status === 'U')
  const unstaged = snapshot.status.unstaged.filter((f) => f.status !== 'U')
  const repo = snapshot.path
  const [view, setView] = useState<FileView>(() =>
    localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'path'
  )
  const changeView = (next: FileView): void => {
    localStorage.setItem(VIEW_KEY, next)
    setView(next)
  }

  return (
    <>
      <div className="detail-scroll">
        <div className="detail-title-row">
          <div className="detail-title">
            {staged.length + snapshot.status.unstaged.length} file changes on{' '}
            <span className="link">{snapshot.head.branch ?? 'HEAD'}</span>
          </div>
          <div className="view-toggle">
            <button
              className={view === 'path' ? 'on' : ''}
              onClick={() => changeView('path')}
              title="Path view"
            >
              <List size={15} />
            </button>
            <button
              className={view === 'tree' ? 'on' : ''}
              onClick={() => changeView('tree')}
              title="Tree view"
            >
              <ListTree size={15} />
            </button>
          </div>
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

function CommitPanel({ repoPath, hash }: { repoPath: string; hash: string }): React.JSX.Element {
  const select = useApp((s) => s.select)
  // Keyed by the requested hash so a stale response is never shown for a new selection
  const [loaded, setLoaded] = useState<{ hash: string; result: Result<CommitDetail> } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.op(repoPath, 'commitDetail', hash).then((result) => {
      if (!cancelled) setLoaded({ hash, result })
    })
    return () => {
      cancelled = true
    }
  }, [repoPath, hash])

  if (!loaded || loaded.hash !== hash) return <div className="center-message">Loading…</div>
  if (!loaded.result.ok)
    return <div className="detail-scroll banner-error">{loaded.result.error}</div>
  const detail = loaded.result.value

  return (
    <div className="detail-scroll">
      <div className="detail-title">{detail.subject}</div>
      {detail.body && <div className="detail-body">{detail.body}</div>}
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
      </dl>
      <div>
        <div className="file-group-title">
          {detail.files.length} changed files
          {detail.parents.length > 1 && <span className="muted"> (vs first parent)</span>}
        </div>
        <FileList files={detail.files} kind="commit" repo={repoPath} hash={detail.hash} />
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
  const [view, setView] = useState<FileView>(() =>
    localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'path'
  )
  const changeView = (next: FileView): void => {
    localStorage.setItem(VIEW_KEY, next)
    setView(next)
  }

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
        <div className="view-toggle">
          <button
            className={view === 'path' ? 'on' : ''}
            onClick={() => changeView('path')}
            title="Path view"
          >
            <List size={15} />
          </button>
          <button
            className={view === 'tree' ? 'on' : ''}
            onClick={() => changeView('tree')}
            title="Tree view"
          >
            <ListTree size={15} />
          </button>
        </div>
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
