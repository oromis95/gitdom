// The blame of a file: who last changed each line, and from there back in time.
import { useEffect, useMemo, useRef, useState } from 'react'
import { History, StepBack } from 'lucide-react'
import type { Blame, BlameCommit, BlameLine, RepoSnapshot } from '../../../../shared/types'
import { WIP_HASH, useActiveTab, useApp, type FileInspect } from '../../store'
import { openMenu, type MenuItem } from '../../ui'
import { highlightLines } from '../../highlight'
import { rangeLabel } from '../../lineRange'
import { copyHash, dayFormat, formatDate, showInGraph, useLoaded } from '../inspect'

/** Lines picked in the blame, by clicking their numbers. */
interface Picked {
  key: string
  anchor: number
  start: number
  end: number
}

/** Opacity of the age stripe: recent commits are bright, the oldest fade out. */
function ageScale(commits: BlameCommit[]): (c: BlameCommit) => number {
  const dates = commits.filter((c) => !c.uncommitted).map((c) => c.authorDate)
  const [min, max] = [Math.min(...dates), Math.max(...dates)]
  return (c) =>
    c.uncommitted ? 1 : max > min ? 0.15 + (0.85 * (c.authorDate - min)) / (max - min) : 1
}

export default function FileBlame({
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
  const blameKey = `${path}\0${inspect.rev}`
  const [picking, setPicked] = useState<Picked | null>(null)
  // A pick belongs to the version it was made in
  const picked = picking?.key === blameKey ? picking : null

  const pick = (lineNo: number, extend: boolean): void =>
    setPicked(
      extend && picked
        ? {
            ...picked,
            start: Math.min(picked.anchor, lineNo),
            end: Math.max(picked.anchor, lineNo)
          }
        : { key: blameKey, anchor: lineNo, start: lineNo, end: lineNo }
    )
  const followLines = (start: number, end: number): void =>
    inspectFile({ ...inspect, mode: 'lines', range: `${start},${end}` })

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

  // Shows the line the blame came to, once per version
  const body = useRef<HTMLDivElement>(null)
  const shown = useRef('')
  const target = blame && inspect.line ? Math.min(inspect.line, blame.lines.length) : 0
  useEffect(() => {
    const key = `${blameKey}\0${target}`
    if (!target || shown.current === key) return
    const row = body.current?.querySelector(`[data-line="${target}"]`)
    if (!row) return
    shown.current = key
    row.scrollIntoView({ block: 'center' })
  })

  /** Blames another version at a line, remembering this one to come back */
  const goTo = (rev: string, revPath: string, line: number, from: BlameLine): void =>
    inspectFile({
      ...inspect,
      rev,
      revPath,
      line,
      back: [
        ...(inspect.back ?? []),
        { rev: inspect.rev, revPath: inspect.revPath, line: from.lineNo }
      ]
    })
  const blameBefore = async (c: BlameCommit, line: BlameLine): Promise<void> => {
    if (!c.previous) return
    const before = await window.api.op(
      repo,
      'lineBefore',
      c.hash,
      c.path,
      c.previous,
      line.sourceLine
    )
    goTo(c.previous.hash, c.previous.path, before.ok ? before.value : line.sourceLine, line)
  }

  const menuFor = (c: BlameCommit, line: BlameLine): MenuItem[] =>
    c.uncommitted
      ? [{ label: 'Show uncommitted changes', onClick: () => showInGraph(WIP_HASH) }]
      : [
          {
            label: 'Blame before this change',
            disabled: !c.previous,
            onClick: () => void blameBefore(c, line)
          },
          {
            label: 'Blame at this commit',
            onClick: () => goTo(c.hash, c.path, line.sourceLine, line)
          },
          { label: 'Show commit in graph', onClick: () => showInGraph(c.hash) },
          'separator',
          { label: 'Copy commit hash', onClick: () => copyHash(c.hash) }
        ]

  if (!result) return <div className="center-message">Loading…</div>
  if (!result.ok) return <div className="banner-error">{result.error}</div>
  if (!blame!.lines.length) return <div className="center-message">Empty file</div>

  const numberMenu = (lineNo: number): MenuItem[] => {
    const inPick = picked && lineNo >= picked.start && lineNo <= picked.end
    const [start, end] = inPick ? [picked.start, picked.end] : [lineNo, lineNo]
    return [
      {
        label: `History of ${rangeLabel(`${start},${end}`)}`,
        onClick: () => followLines(start, end)
      }
    ]
  }

  return (
    <>
      {picked ? (
        <div className="diff-hint blame-pick">
          <span>
            {rangeLabel(`${picked.start},${picked.end}`).replace(/^./, (c) => c.toUpperCase())}{' '}
            selected
          </span>
          <button className="btn btn-small" onClick={() => followLines(picked.start, picked.end)}>
            <History size={13} /> History of these lines
          </button>
          <button className="link" onClick={() => setPicked(null)}>
            Clear
          </button>
        </div>
      ) : (
        <div className="diff-hint">
          Click a line number, Shift+click another for a range, then History of these lines. The
          arrow beside a commit shows the blame from before it.
        </div>
      )}
      <div className="diff-body blame-body" ref={body}>
        <div className="blame-lines">
          {blame!.lines.map((line, i) => {
            const commit = blame!.commits[line.hash]
            const first = i === 0 || blame!.lines[i - 1].hash !== line.hash
            const hash = commit.uncommitted ? WIP_HASH : commit.hash
            return (
              <div
                key={i}
                data-line={line.lineNo}
                className={`blame-line${first ? ' first' : ''}${selected === hash ? ' active' : ''}${
                  line.lineNo === target ? ' target' : ''
                }`}
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
                  onContextMenu={(e) => openMenu(e, menuFor(commit, line))}
                >
                  {first && commit.previous && (
                    <button
                      className="blame-before"
                      title="Blame before this change"
                      aria-label="Blame before this change"
                      onClick={(e) => {
                        e.stopPropagation()
                        void blameBefore(commit, line)
                      }}
                    >
                      <StepBack size={12} />
                    </button>
                  )}
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
                <span
                  className={`diff-no blame-no${
                    picked && line.lineNo >= picked.start && line.lineNo <= picked.end
                      ? ' picked'
                      : ''
                  }`}
                  title="Click to follow this line through the history, Shift+click for a range"
                  onMouseDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    pick(line.lineNo, e.shiftKey)
                  }}
                  onContextMenu={(e) => openMenu(e, numberMenu(line.lineNo))}
                >
                  {line.lineNo}
                </span>
                <span
                  className="diff-code"
                  dangerouslySetInnerHTML={{ __html: highlighted[i] || ' ' }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
