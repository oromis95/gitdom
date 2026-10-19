import { useMemo, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import type { DiffLine, LineRevision, RepoSnapshot } from '../../../../shared/types'
import { useActiveTab, useApp, type FileInspect } from '../../store'
import { openMenu, type MenuItem } from '../../ui'
import { highlightHunks } from '../../highlight'
import { foldContext } from '../../lineRange'
import { copyHash, formatDate, showInGraph, useLoaded } from '../inspect'

/** The commits that changed some lines of a file, each with how it changed them. */
export default function FileLines({
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
  const range = inspect.range ?? '1,1'
  // Folds of unchanged lines the user opened: "hash:hunk:first line"
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  const result = useLoaded(`${path}\0${range}\0${inspect.rev}\0${snapshot.head.hash}`, () =>
    window.api.op(repo, 'lineHistory', path, range, inspect.rev)
  )
  const revisions = result?.ok ? result.value : null
  const highlighted = useMemo(
    () => revisions?.map((r) => highlightHunks(r.diff)) ?? [],
    [revisions]
  )
  // Without a revision git numbers the lines as in the last commit, not as on disk
  const modified =
    !inspect.rev &&
    [...snapshot.status.staged, ...snapshot.status.unstaged].some((f) => f.path === inspect.path)

  const menuFor = (r: LineRevision): MenuItem[] => [
    {
      label: 'Blame at this commit',
      disabled: r.diff.change === 'deleted',
      onClick: () =>
        inspectFile({
          ...inspect,
          mode: 'blame',
          rev: r.hash,
          revPath: r.path,
          // Where the lines followed were at that commit
          line: r.diff.hunks[0]?.newStart,
          back: undefined
        })
    },
    { label: 'Show commit in graph', onClick: () => showInGraph(r.hash) },
    'separator',
    { label: 'Copy commit hash', onClick: () => copyHash(r.hash) }
  ]

  const renderLine = (line: DiffLine, l: number, html: string): React.ReactNode => (
    <div key={l} className={`diff-line ${line.type}`}>
      <span className="diff-no">{line.oldNo ?? ''}</span>
      <span className="diff-no">{line.newNo ?? ''}</span>
      <span className="diff-marker">
        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
      </span>
      <span className="diff-code" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
    </div>
  )

  if (!result) return <div className="center-message">Following the lines…</div>
  if (!result.ok) return <div className="banner-error">{result.error}</div>
  if (!revisions!.length) return <div className="center-message">No commits change these lines</div>

  return (
    <>
      {modified && (
        <div className="diff-hint">
          The file has uncommitted changes: lines are numbered as in the last commit.
        </div>
      )}
      {revisions!.length >= 500 && <div className="diff-hint">Showing the latest 500 commits.</div>}
      <div className="diff-body line-history">
        {revisions!.map((r, i) => (
          <section key={r.hash} className="line-revision">
            <div
              className={`history-row${selected === r.hash ? ' selected' : ''}`}
              onClick={() => select(r.hash)}
              onContextMenu={(e) => openMenu(e, menuFor(r))}
              title="Select the commit; right-click for more"
            >
              <span className="history-hash mono">{r.hash.slice(0, 7)}</span>
              <span className="history-subject">
                {r.subject}
                {r.diff.oldPath && <span className="muted"> (renamed from {r.diff.oldPath})</span>}
                {r.diff.change === 'added' && <span className="muted"> (file created)</span>}
              </span>
              <span className="cell-author">{r.authorName}</span>
              <span className="cell-date">{formatDate(r.authorDate)}</span>
            </div>
            {r.diff.hunks.map((hunk, h) => (
              <div key={h} className="hunk">
                {foldContext(hunk.lines).flatMap((row): React.ReactNode[] => {
                  const line = (l: number): React.ReactNode =>
                    renderLine(hunk.lines[l], l, highlighted[i][h][l])
                  if (typeof row === 'number') return [line(row)]
                  const fold = `${r.hash}:${h}:${row.start}`
                  const count = row.end - row.start + 1
                  if (opened.has(fold))
                    return Array.from({ length: count }, (_, k) => line(row.start + k))
                  return [
                    <div
                      key={`fold${row.start}`}
                      className="diff-line line-fold"
                      onClick={() => setOpened(new Set(opened).add(fold))}
                      title="Show the unchanged lines"
                    >
                      <ChevronsUpDown size={13} /> {count} unchanged lines
                    </div>
                  ]
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  )
}
