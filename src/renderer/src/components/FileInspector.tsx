import { useEffect, useMemo, useState } from 'react'
import { History, ScanText, X } from 'lucide-react'
import type { Result } from '../../../shared/api'
import type { Blame, BlameCommit, FileRevision, RepoSnapshot } from '../../../shared/types'
import { WIP_HASH, useActiveTab, useApp, type FileInspect } from '../store'
import { fromTerminal, notify, openMenu, type MenuItem } from '../ui'
import { highlightLines } from '../highlight'
import DiffView from './DiffView'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const formatDate = (seconds: number, format = dateFormat): string =>
  format.format(new Date(seconds * 1000))

interface Loaded<T> {
  key: string
  result: Result<T>
}

/** Loads with an operation whenever `key` changes, dropping the answers to outdated requests. */
function useLoaded<T>(key: string, load: () => Promise<Result<T>>): Result<T> | null {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  useEffect(() => {
    let cancelled = false
    void load().then((result) => {
      if (!cancelled) setLoaded({ key, result })
    })
    return () => {
      cancelled = true
    }
    // key identifies what load fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return loaded?.key === key ? loaded.result : null
}

function copyHash(hash: string): void {
  void navigator.clipboard.writeText(hash)
  notify('info', 'Copied commit hash')
}

/** Leaves the inspector and selects the commit in the graph. */
function showInGraph(hash: string): void {
  const { inspectFile, select } = useApp.getState()
  inspectFile(null)
  select(hash, true)
}

function FileHistory({
  snapshot,
  inspect
}: {
  snapshot: RepoSnapshot
  inspect: FileInspect
}): React.JSX.Element {
  const { inspectFile, select } = useApp()
  const repo = snapshot.path
  // Reloaded with the snapshot: a new commit may have changed the file
  const result = useLoaded(
    `${inspect.path}\0${snapshot.head.hash}\0${snapshot.commits.length}`,
    () => window.api.op(repo, 'fileHistory', inspect.path)
  )
  const revisions = result?.ok ? result.value : null
  const current = revisions?.find((r) => r.hash === inspect.rev)

  const open = (r: FileRevision): void => {
    inspectFile({ ...inspect, rev: r.hash, revPath: r.path })
    select(r.hash)
  }
  const blameAt = (r: FileRevision): void =>
    inspectFile({ path: inspect.path, mode: 'blame', rev: r.hash, revPath: r.path })

  const menuFor = (r: FileRevision): MenuItem[] => [
    { label: 'Blame at this commit', disabled: r.status === 'D', onClick: () => blameAt(r) },
    { label: 'Show commit in graph', onClick: () => showInGraph(r.hash) },
    'separator',
    { label: 'Copy commit hash', onClick: () => copyHash(r.hash) }
  ]

  let list: React.ReactNode
  if (!result) list = <div className="center-message">Loading…</div>
  else if (!result.ok) list = <div className="banner-error">{result.error}</div>
  else if (!revisions!.length)
    list = <div className="center-message">No commits change this file</div>
  else {
    list = revisions!.map((r) => (
      <div
        key={r.hash}
        className={`history-row${r.hash === inspect.rev ? ' selected' : ''}`}
        onClick={() => open(r)}
        onContextMenu={(e) => openMenu(e, menuFor(r))}
        title={r.path !== inspect.path ? `As ${r.path}` : undefined}
      >
        <span className={`file-status status-${r.status ?? 'M'}`}>{r.status ?? '·'}</span>
        <span className="history-hash mono">{r.hash.slice(0, 7)}</span>
        <span className="history-subject">
          {r.subject}
          {r.oldPath && <span className="muted"> (renamed from {r.oldPath})</span>}
        </span>
        <span className="cell-author">{r.authorName}</span>
        <span className="cell-date">{formatDate(r.authorDate)}</span>
        {r.status !== 'D' && (
          <button
            className="row-action"
            onClick={(e) => {
              e.stopPropagation()
              blameAt(r)
            }}
          >
            Blame
          </button>
        )}
      </div>
    ))
  }

  return (
    <>
      <div className={`history-list${current ? ' split' : ''}`}>
        {revisions && revisions.length >= 5000 && (
          <div className="diff-hint">Showing the latest 5000 commits.</div>
        )}
        {list}
      </div>
      {current && (
        <DiffView
          snapshot={snapshot}
          target={{
            source: { kind: 'commit', hash: current.hash },
            path: current.path,
            oldPath: current.oldPath
          }}
          onClose={() => inspectFile({ ...inspect, rev: null, revPath: undefined })}
        />
      )}
    </>
  )
}

/** Opacity of the age stripe: recent commits are bright, the oldest fade out. */
function ageScale(commits: BlameCommit[]): (c: BlameCommit) => number {
  const dates = commits.filter((c) => !c.uncommitted).map((c) => c.authorDate)
  const [min, max] = [Math.min(...dates), Math.max(...dates)]
  return (c) =>
    c.uncommitted ? 1 : max > min ? 0.15 + (0.85 * (c.authorDate - min)) / (max - min) : 1
}

function FileBlame({
  snapshot,
  inspect
}: {
  snapshot: RepoSnapshot
  inspect: FileInspect
}): React.JSX.Element {
  const { inspectFile, select } = useApp()
  const selected = useActiveTab()?.selected
  const repo = snapshot.path
  const path = inspect.revPath ?? inspect.path
  // The working tree version changes with every edit
  const reload = inspect.rev ? '' : JSON.stringify(snapshot.status) + snapshot.head.hash
  const result = useLoaded(`${path}\0${inspect.rev}\0${reload}`, () =>
    window.api.op(repo, 'blame', path, inspect.rev)
  )
  const blame: Blame | null = result?.ok ? result.value : null

  const highlighted = useMemo(
    () =>
      blame
        ? highlightLines(
            blame.path,
            blame.lines.map((l) => l.text)
          )
        : [],
    [blame]
  )
  const age = useMemo(() => (blame ? ageScale(Object.values(blame.commits)) : () => 1), [blame])

  const menuFor = (c: BlameCommit): MenuItem[] =>
    c.uncommitted
      ? [{ label: 'Show uncommitted changes', onClick: () => showInGraph(WIP_HASH) }]
      : [
          {
            label: 'Blame before this change',
            disabled: !c.previous,
            onClick: () =>
              c.previous &&
              inspectFile({ ...inspect, rev: c.previous.hash, revPath: c.previous.path })
          },
          {
            label: 'Blame at this commit',
            onClick: () => inspectFile({ ...inspect, rev: c.hash, revPath: c.path })
          },
          { label: 'Show commit in graph', onClick: () => showInGraph(c.hash) },
          'separator',
          { label: 'Copy commit hash', onClick: () => copyHash(c.hash) }
        ]

  if (!result) return <div className="center-message">Loading…</div>
  if (!result.ok) return <div className="banner-error">{result.error}</div>
  if (!blame!.lines.length) return <div className="center-message">Empty file</div>

  return (
    <div className="diff-body blame-body">
      <div className="blame-lines">
        {blame!.lines.map((line, i) => {
          const commit = blame!.commits[line.hash]
          const first = i === 0 || blame!.lines[i - 1].hash !== line.hash
          const hash = commit.uncommitted ? WIP_HASH : commit.hash
          return (
            <div
              key={i}
              className={`blame-line${first ? ' first' : ''}${selected === hash ? ' active' : ''}`}
            >
              <span
                className="blame-gutter"
                style={{
                  borderLeftColor: `color-mix(in srgb, var(--accent) ${Math.round(age(commit) * 100)}%, transparent)`
                }}
                title={
                  commit.uncommitted
                    ? 'Not committed yet'
                    : `${commit.summary}\n${commit.authorName} <${commit.authorEmail}>\n${formatDate(commit.authorDate)}\n${commit.hash}`
                }
                onClick={() => select(hash)}
                onContextMenu={(e) => openMenu(e, menuFor(commit))}
              >
                {first &&
                  (commit.uncommitted ? (
                    <span className="blame-summary muted">Uncommitted changes</span>
                  ) : (
                    <>
                      <span className="blame-summary">{commit.summary}</span>
                      <span className="blame-meta">
                        {commit.authorName} · {formatDate(commit.authorDate, dayFormat)}
                      </span>
                    </>
                  ))}
              </span>
              <span className="diff-no">{line.lineNo}</span>
              <span
                className="diff-code"
                dangerouslySetInnerHTML={{ __html: highlighted[i] || ' ' }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** History or blame of a file, in place of the graph. */
export default function FileInspector({
  snapshot,
  inspect
}: {
  snapshot: RepoSnapshot
  inspect: FileInspect
}): React.JSX.Element {
  const inspectFile = useApp((s) => s.inspectFile)
  const shownPath = inspect.revPath ?? inspect.path

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !fromTerminal(e) && !document.querySelector('.modal, .menu'))
        inspectFile(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectFile])

  const mode = (m: FileInspect['mode']): void => {
    if (m !== inspect.mode) inspectFile({ ...inspect, mode: m })
  }

  return (
    <div className="diff-view inspector">
      <div className="diff-header">
        <span className="diff-path" title={shownPath}>
          {shownPath !== inspect.path && <span className="muted">{shownPath} → </span>}
          {inspect.path}
        </span>
        {inspect.mode === 'blame' && (
          <span className="diff-source">
            {inspect.rev ? `at ${inspect.rev.slice(0, 7)}` : 'working tree'}
          </span>
        )}
        {inspect.mode === 'blame' && inspect.rev && (
          <button
            className="btn btn-small"
            title="Blame the working tree version"
            onClick={() => inspectFile({ ...inspect, rev: null, revPath: undefined })}
          >
            Latest
          </button>
        )}
        <span className="toolbar-spacer" />
        <div className="segmented">
          <button
            className={inspect.mode === 'history' ? 'active' : ''}
            onClick={() => mode('history')}
          >
            <History size={14} /> History
          </button>
          <button
            className={inspect.mode === 'blame' ? 'active' : ''}
            onClick={() => mode('blame')}
          >
            <ScanText size={14} /> Blame
          </button>
        </div>
        <button className="diff-close" onClick={() => inspectFile(null)} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      {inspect.mode === 'history' ? (
        <FileHistory snapshot={snapshot} inspect={inspect} />
      ) : (
        <FileBlame snapshot={snapshot} inspect={inspect} />
      )}
    </div>
  )
}
