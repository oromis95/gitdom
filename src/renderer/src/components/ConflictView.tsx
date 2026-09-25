import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Result } from '../../../shared/api'
import type { RepoSnapshot } from '../../../shared/types'
import {
  buildOutput,
  conflictCount,
  parseConflicts,
  type Choice,
  type ConflictFile
} from '../conflicts'
import { useApp, type DiffTarget } from '../store'
import { confirm, fromTerminal, notify } from '../ui'
import { openMergeTool, run } from '../actions'

type PaneRow = { kind: 'common' | 'conflict' | 'pad'; text: string; block?: number }

/** Rows of one side, conflicts padded so both panes stay aligned line by line. */
function paneRows(file: ConflictFile, side: 'ours' | 'theirs'): PaneRow[] {
  const rows: PaneRow[] = []
  let block = 0
  for (const segment of file.segments) {
    if (segment.kind === 'common') {
      segment.lines.forEach((text) => rows.push({ kind: 'common', text }))
      continue
    }
    const lines = segment[side]
    const height = Math.max(segment.ours.length, segment.theirs.length, 1)
    for (let i = 0; i < height; i++) {
      rows.push(
        i < lines.length
          ? { kind: 'conflict', text: lines[i], block }
          : { kind: 'pad', text: '', block }
      )
    }
    block++
  }
  return rows
}

function Pane({
  title,
  rows,
  choices,
  side,
  toggle,
  scrollRef,
  onScroll
}: {
  title: string
  rows: PaneRow[]
  choices: Choice[]
  side: 'ours' | 'theirs'
  toggle: (block: number, side: 'ours' | 'theirs') => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
}): React.JSX.Element {
  const taken = (block: number): boolean => choices[block] === side || choices[block] === 'both'
  return (
    <div className="merge-pane">
      <div className="merge-pane-title">{title}</div>
      <div className="merge-pane-body" ref={scrollRef} onScroll={onScroll}>
        {rows.map((row, i) => {
          const first = row.block !== undefined && rows[i - 1]?.block !== row.block
          const cls =
            row.kind === 'common'
              ? ''
              : ` conflict-${side}${taken(row.block!) ? ' taken' : ''}${
                  choices[row.block!] === null ? ' unresolved' : ''
                }`
          return (
            <div key={i} className={`merge-line${cls}`}>
              <span className="merge-gutter">
                {first && (
                  <input
                    type="checkbox"
                    title={`Take these lines (${side === 'ours' ? 'HEAD' : 'incoming'})`}
                    checked={taken(row.block!)}
                    onChange={() => toggle(row.block!, side)}
                  />
                )}
              </span>
              <span className="merge-text">{row.kind === 'pad' ? '' : row.text || ' '}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Tool({
  snapshot,
  target,
  file
}: {
  snapshot: RepoSnapshot
  target: DiffTarget
  file: ConflictFile
}): React.JSX.Element {
  const openDiff = useApp((s) => s.openDiff)
  const repo = snapshot.path
  const count = conflictCount(file)
  const [choices, setChoices] = useState<Choice[]>(() => Array(count).fill(null))
  const [output, setOutput] = useState(() => buildOutput(file, choices))
  const [edited, setEdited] = useState(false)
  const ours = useMemo(() => paneRows(file, 'ours'), [file])
  const theirs = useMemo(() => paneRows(file, 'theirs'), [file])
  const oursRef = useRef<HTMLDivElement>(null)
  const theirsRef = useRef<HTMLDivElement>(null)

  const apply = async (next: Choice[]): Promise<void> => {
    if (
      edited &&
      !(await confirm(
        'Replace edits',
        'Choosing lines rebuilds the output: your manual edits to it are lost. Continue?',
        'Rebuild output'
      ))
    )
      return
    setChoices(next)
    setOutput(buildOutput(file, next))
    setEdited(false)
  }

  const toggle = (block: number, side: 'ours' | 'theirs'): void => {
    const current = choices[block]
    const has = {
      ours: current === 'ours' || current === 'both',
      theirs: current === 'theirs' || current === 'both'
    }
    has[side] = !has[side]
    const choice: Choice =
      has.ours && has.theirs ? 'both' : has.ours ? 'ours' : has.theirs ? 'theirs' : null
    void apply(choices.map((c, i) => (i === block ? choice : c)))
  }

  const syncScroll = (from: 'ours' | 'theirs'): void => {
    const [source, other] = from === 'ours' ? [oursRef, theirsRef] : [theirsRef, oursRef]
    if (source.current && other.current && other.current.scrollTop !== source.current.scrollTop) {
      other.current.scrollTop = source.current.scrollTop
    }
  }

  const save = async (): Promise<void> => {
    if (/^(<{7}|>{7})( |\r?$)/m.test(output)) {
      const ok = await confirm(
        'Conflict markers left',
        'The output still contains conflict markers (<<<<<<< / >>>>>>>). Save and mark resolved anyway?',
        'Save anyway'
      )
      if (!ok) return
    }
    if (await run(repo, 'saveResolution', target.path, output)) {
      notify('success', `Resolved ${target.path}`)
      openDiff({ source: { kind: 'staged' }, path: target.path })
    }
  }

  const resolved = choices.filter((c) => c !== null).length
  const oursLabel = file.segments.find((s) => s.kind === 'conflict')?.oursLabel
  const theirsLabel = file.segments.find((s) => s.kind === 'conflict')?.theirsLabel

  return (
    <>
      <div className="merge-toolbar">
        <span>
          {edited
            ? 'Output edited by hand'
            : `${resolved} of ${count} conflict${count === 1 ? '' : 's'} resolved`}
        </span>
        <span className="toolbar-spacer" />
        <button className="btn btn-small" onClick={() => void apply(Array(count).fill('ours'))}>
          Take all HEAD
        </button>
        <button className="btn btn-small" onClick={() => void apply(Array(count).fill('theirs'))}>
          Take all incoming
        </button>
        <button
          className="btn btn-small"
          title="Open the merge tool configured in git (merge.tool)"
          onClick={() => void openMergeTool(repo, target.path)}
        >
          External tool
        </button>
        <button className="btn btn-small btn-stage" onClick={() => void save()}>
          Save and mark resolved
        </button>
      </div>
      <div className="merge-panes">
        <Pane
          title={`HEAD (ours)${oursLabel ? ` — ${oursLabel}` : ''}`}
          rows={ours}
          choices={choices}
          side="ours"
          toggle={toggle}
          scrollRef={oursRef}
          onScroll={() => syncScroll('ours')}
        />
        <Pane
          title={`Incoming (theirs)${theirsLabel ? ` — ${theirsLabel}` : ''}`}
          rows={theirs}
          choices={choices}
          side="theirs"
          toggle={toggle}
          scrollRef={theirsRef}
          onScroll={() => syncScroll('theirs')}
        />
      </div>
      <div className="merge-output">
        <div className="merge-pane-title">Output — editable</div>
        <textarea
          spellCheck={false}
          value={output}
          onChange={(e) => {
            setOutput(e.target.value)
            setEdited(true)
          }}
        />
      </div>
    </>
  )
}

export default function ConflictView({
  snapshot,
  target
}: {
  snapshot: RepoSnapshot
  target: DiffTarget
}): React.JSX.Element {
  const openDiff = useApp((s) => s.openDiff)
  const repo = snapshot.path
  const [loaded, setLoaded] = useState<{ path: string; result: Result<string> } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'readConflictFile', target.path).then((result) => {
      if (!cancelled) setLoaded({ path: target.path, result })
    })
    return () => {
      cancelled = true
    }
  }, [repo, target.path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !fromTerminal(e) && !document.querySelector('.modal, .menu'))
        openDiff(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDiff])

  const result = loaded?.path === target.path ? loaded.result : null
  const file = useMemo(() => (result?.ok ? parseConflicts(result.value) : null), [result])

  let body: React.ReactNode
  if (!result) body = <div className="center-message">Loading…</div>
  else if (!result.ok) body = <div className="banner-error">{result.error}</div>
  else if (!file || conflictCount(file) === 0) {
    body = (
      <div className="center-message">
        No conflict markers left in this file: review it and mark it resolved.
      </div>
    )
  } else body = <Tool key={target.path} snapshot={snapshot} target={target} file={file} />

  return (
    <div className="diff-view merge-view">
      <div className="diff-header">
        <span className="diff-path" title={target.path}>
          {target.path}
        </span>
        <span className="diff-source">merge conflict</span>
        <span className="toolbar-spacer" />
        <button className="btn" onClick={() => openDiff({ ...target, merge: false })}>
          Show diff
        </button>
        <button className="diff-close" onClick={() => openDiff(null)} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      {body}
    </div>
  )
}
