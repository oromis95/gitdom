// The commits that changed a file, and the diff of the one picked.
import type { FileRevision, RepoSnapshot } from '../../../../shared/types'
import { useApp, type FileInspect } from '../../store'
import { openMenu, type MenuItem } from '../../ui'
import DiffView from '../DiffView'
import { copyHash, formatDate, showInGraph, useLoaded } from '../inspect'

export default function FileHistory({
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
    inspectFile({ ...inspect, rev: r.hash, revPath: r.path, line: undefined, back: undefined })
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
