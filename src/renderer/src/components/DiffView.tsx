import { useEffect, useMemo, useState } from 'react'
import { History, ScanText, X } from 'lucide-react'
import type { Result } from '../../../shared/api'
import { buildPatch } from '../../../shared/diff'
import type {
  DiffLine,
  DiffSource,
  FileChange,
  FileDiff,
  Hunk,
  RepoSnapshot
} from '../../../shared/types'
import { hunkWordRanges, markHtml } from '../../../shared/wordDiff'
import { useApp, type DiffTarget } from '../store'
import { highlightLines } from '../highlight'
import { DIFF_CONTEXT_MAX, updateSettings, useSettings } from '../settings'
import { confirm, fromTerminal } from '../ui'
import { discardFiles, markResolved, resolveWith, run } from '../actions'
import ImageDiff from './ImageDiff'

/** Highlights the lines of all hunks, grouped by hunk, with the changed words marked (DIFF-03). */
function highlightHunks(diff: FileDiff): string[][] {
  const html = highlightLines(
    diff.path,
    diff.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text))
  )
  let next = 0
  return diff.hunks.map((hunk) => {
    const words = hunkWordRanges(hunk.lines)
    return hunk.lines.map((_, l) => {
      const line = html[next++]
      const ranges = words.get(l)
      return ranges ? markHtml(line, ranges) : line
    })
  })
}

/** Line indexes shown side by side (DIFF-01): removed lines on the left, facing the added ones. */
function splitRows(lines: DiffLine[]): [number | null, number | null][] {
  const rows: [number | null, number | null][] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'context') {
      rows.push([i, i])
      i++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (i < lines.length && lines[i].type === 'del') dels.push(i++)
    while (i < lines.length && lines[i].type === 'add') adds.push(i++)
    for (let k = 0; k < Math.max(dels.length, adds.length); k++)
      rows.push([dels[k] ?? null, adds[k] ?? null])
  }
  return rows
}

const shortRev = (rev: string): string => (/^[0-9a-f]{40,64}$/i.test(rev) ? rev.slice(0, 7) : rev)

function sourceLabel(source: DiffSource): string {
  switch (source.kind) {
    case 'commit':
      return `commit ${source.hash.slice(0, 7)}`
    case 'compare':
      return `${shortRev(source.from)} → ${shortRev(source.to)}`
    case 'untracked':
      return 'new file'
    default:
      return source.kind
  }
}

const isImagePath = (path: string): boolean =>
  /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i.test(path)

const CONTEXT_CHOICES = [0, 1, 3, 5, 10, 25]
/** Context large enough to include every line of the file (DIFF-05) */
const WHOLE_FILE = 1_000_000

type Selection = Map<number, Set<number>>

interface LoadedDiff {
  key: string
  result: Result<FileDiff>
}

export default function DiffView({
  snapshot,
  target,
  onClose
}: {
  snapshot: RepoSnapshot
  target: DiffTarget
  /** Set when embedded in another view: replaces closing the diff, and Esc belongs to that view */
  onClose?: () => void
}): React.JSX.Element {
  const openDiff = useApp((s) => s.openDiff)
  const inspectFile = useApp((s) => s.inspectFile)
  const layout = useSettings((s) => s.diffLayout)
  const wrap = useSettings((s) => s.diffWrap)
  const ignoreWhitespace = useSettings((s) => s.diffIgnoreWhitespace)
  const contextSetting = useSettings((s) => s.diffContext)
  const fullFile = useSettings((s) => s.diffFullFile)
  const repo = snapshot.path
  const { source } = target
  const context = fullFile ? WHOLE_FILE : contextSetting
  const key = JSON.stringify([target, ignoreWhitespace, context])
  // Working tree diffs change as files are staged or edited: reload with every status update
  const reloadToken = source.kind === 'commit' || source.kind === 'compare' ? null : snapshot.status

  const [loaded, setLoaded] = useState<LoadedDiff | null>(null)
  const [selection, setSelection] = useState<{ diff: FileDiff | null; lines: Selection }>({
    diff: null,
    lines: new Map()
  })
  const [anchor, setAnchor] = useState<{ hunk: number; line: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api
      .op(repo, 'diff', source, target.path, target.oldPath, { ignoreWhitespace, context })
      .then((result) => {
        if (!cancelled) setLoaded({ key, result })
      })
    return () => {
      cancelled = true
    }
    // reloadToken is a deliberate trigger; source, path and options are covered by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, key, reloadToken])

  useEffect(() => {
    if (onClose) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !fromTerminal(e) && !document.querySelector('.modal, .menu'))
        openDiff(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDiff, onClose])

  const diff = loaded?.key === key && loaded.result.ok ? loaded.result.value : null
  const highlighted = useMemo(() => (diff ? highlightHunks(diff) : []), [diff])
  // A reloaded diff invalidates the selected line indexes
  const selected = selection.diff === diff ? selection.lines : new Map<number, Set<number>>()

  const editable =
    source.kind === 'unstaged' || source.kind === 'staged' || source.kind === 'untracked'
  const partial =
    !!diff &&
    !diff.binary &&
    !diff.change &&
    !diff.conflicted &&
    (source.kind === 'unstaged' || source.kind === 'staged')
  // A patch built without the whitespace changes or without context would not apply cleanly
  const patchable = !ignoreWhitespace && context > 0
  const lineLevel = partial && patchable
  const image = !!diff?.binary && (isImagePath(target.path) || isImagePath(target.oldPath ?? ''))

  const file: FileChange = {
    path: target.path,
    oldPath: target.oldPath,
    status: source.kind === 'untracked' ? '?' : 'M'
  }
  // Once resolved the file has no unstaged changes left: show the staged resolution instead
  const showResolved = (resolved: boolean): void => {
    if (resolved) openDiff({ source: { kind: 'staged' }, path: target.path })
  }
  const filePaths =
    target.oldPath && target.oldPath !== target.path ? [target.oldPath, target.path] : [target.path]

  const toggleLine = (hunkIndex: number, lineIndex: number, shift: boolean): void => {
    if (!lineLevel || !diff) return
    const lines = new Map(selected)
    const set = new Set(lines.get(hunkIndex))
    if (shift && anchor?.hunk === hunkIndex) {
      const [from, to] = [Math.min(anchor.line, lineIndex), Math.max(anchor.line, lineIndex)]
      for (let i = from; i <= to; i++)
        if (diff.hunks[hunkIndex].lines[i].type !== 'context') set.add(i)
    } else if (set.has(lineIndex)) {
      set.delete(lineIndex)
    } else {
      set.add(lineIndex)
    }
    if (set.size) lines.set(hunkIndex, set)
    else lines.delete(hunkIndex)
    setSelection({ diff, lines })
    setAnchor({ hunk: hunkIndex, line: lineIndex })
  }

  const applyHunk = async (
    hunk: Hunk,
    lines: Set<number> | undefined,
    action: 'stage' | 'unstage' | 'discard'
  ): Promise<void> => {
    if (!diff) return
    if (action === 'discard') {
      const what = lines ? `${lines.size} selected lines` : 'this hunk'
      if (
        !(await confirm(
          'Discard changes',
          `Discard ${what}? This cannot be undone.`,
          'Discard',
          true
        ))
      )
        return
    }
    const reverse = action !== 'stage'
    const patch = buildPatch(diff, [{ hunk, lines }], reverse)
    if (patch) await run(repo, 'applyPatch', patch, action !== 'discard', reverse)
  }

  /** One line of a hunk; in the split layout each side shows only its own line number. */
  const renderLine = (h: number, l: number | null, side?: 'left' | 'right'): React.ReactNode => {
    if (l === null) return <div key={side} className="diff-line empty" />
    const line = diff!.hunks[h].lines[l]
    return (
      <div
        key={side ?? l}
        className={`diff-line ${line.type}${selected.get(h)?.has(l) ? ' selected' : ''}${
          lineLevel && line.type !== 'context' ? ' selectable' : ''
        }`}
        onMouseDown={(e) => {
          if (line.type === 'context') return
          e.preventDefault()
          toggleLine(h, l, e.shiftKey)
        }}
      >
        {side !== 'right' && <span className="diff-no">{line.oldNo ?? ''}</span>}
        {side !== 'left' && <span className="diff-no">{line.newNo ?? ''}</span>}
        <span className="diff-marker">
          {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
        </span>
        <span
          className="diff-code"
          dangerouslySetInnerHTML={{ __html: highlighted[h][l] || ' ' }}
        />
        {line.noNewline && (
          <span className="diff-eof" title="No newline at end of file">
            ⏎̸
          </span>
        )}
      </div>
    )
  }

  let body: React.ReactNode
  if (!loaded || loaded.key !== key) body = <div className="center-message">Loading…</div>
  else if (!loaded.result.ok) body = <div className="banner-error">{loaded.result.error}</div>
  else if (image)
    body = (
      <ImageDiff
        repo={repo}
        source={source}
        path={target.path}
        oldPath={target.oldPath}
        reloadToken={reloadToken}
      />
    )
  else if (diff!.binary) body = <div className="center-message">Binary file</div>
  else if (diff!.hunks.length === 0)
    body = (
      <div className="center-message">
        {ignoreWhitespace ? 'Only whitespace changed' : 'No changes'}
      </div>
    )
  else {
    body = diff!.hunks.map((hunk, h) => {
      const hunkSelection = selected.get(h)
      const count = hunkSelection?.size ?? 0
      const unit = count ? 'lines' : 'hunk'
      const suffix = count ? ` (${count})` : ''
      return (
        <div key={h} className={`hunk${layout === 'split' ? ' split' : ''}`}>
          <div className="hunk-header">
            <span className="mono">{hunk.header}</span>
            {editable && lineLevel && (
              <span className="hunk-actions">
                {count > 0 && (
                  <button
                    className="btn btn-small"
                    onClick={() => setSelection({ diff, lines: new Map() })}
                  >
                    Clear selection
                  </button>
                )}
                {source.kind === 'unstaged' && (
                  <>
                    <button
                      className="btn btn-small btn-danger-outline"
                      onClick={() => void applyHunk(hunk, hunkSelection, 'discard')}
                    >
                      Discard {unit}
                      {suffix}
                    </button>
                    <button
                      className="btn btn-small btn-stage"
                      onClick={() => void applyHunk(hunk, hunkSelection, 'stage')}
                    >
                      Stage {unit}
                      {suffix}
                    </button>
                  </>
                )}
                {source.kind === 'staged' && (
                  <button
                    className="btn btn-small btn-unstage"
                    onClick={() => void applyHunk(hunk, hunkSelection, 'unstage')}
                  >
                    Unstage {unit}
                    {suffix}
                  </button>
                )}
              </span>
            )}
          </div>
          {layout === 'split'
            ? splitRows(hunk.lines).map(([left, right], r) => (
                <div key={r} className="split-row">
                  {renderLine(h, left, 'left')}
                  {renderLine(h, right, 'right')}
                </div>
              ))
            : hunk.lines.map((_, l) => renderLine(h, l))}
        </div>
      )
    })
  }

  return (
    <div className="diff-view">
      <div className="diff-header">
        <span className="diff-path" title={target.path}>
          {target.oldPath && target.oldPath !== target.path && (
            <span className="muted">{target.oldPath} → </span>
          )}
          {target.path}
        </span>
        <span className="diff-source">{sourceLabel(source)}</span>
        <span className="toolbar-spacer" />
        {diff?.conflicted && (
          <>
            <button
              className="btn"
              onClick={() => openDiff({ ...target, merge: true })}
              title="Pick lines from each side in the merge tool"
            >
              Merge tool
            </button>
            <button
              className="btn"
              onClick={() => void resolveWith(repo, [target.path], 'ours').then(showResolved)}
              title="Replace the file with the HEAD version"
            >
              Keep HEAD
            </button>
            <button
              className="btn"
              onClick={() => void resolveWith(repo, [target.path], 'theirs').then(showResolved)}
              title="Replace the file with the incoming version"
            >
              Take incoming
            </button>
            <button
              className="btn btn-stage"
              onClick={() => void markResolved(repo, [target.path]).then(showResolved)}
            >
              Mark resolved
            </button>
          </>
        )}
        {!diff?.conflicted && (source.kind === 'unstaged' || source.kind === 'untracked') && (
          <>
            <button
              className="btn btn-danger-outline"
              onClick={() => void discardFiles(repo, [file])}
            >
              {source.kind === 'untracked' ? 'Delete file' : 'Discard file'}
            </button>
            <button
              className="btn btn-stage"
              onClick={() => void run(repo, 'stage', [target.path])}
            >
              Stage file
            </button>
          </>
        )}
        {source.kind === 'staged' && (
          <button className="btn btn-unstage" onClick={() => void run(repo, 'unstage', filePaths)}>
            Unstage file
          </button>
        )}
        {!onClose && source.kind !== 'untracked' && !diff?.conflicted && (
          <>
            <button
              className="btn"
              title="Commits that changed this file"
              onClick={() => inspectFile({ path: target.path, mode: 'history', rev: null })}
            >
              <History size={14} /> History
            </button>
            {source.kind !== 'compare' && (
              <button
                className="btn"
                title="Who last changed each line"
                onClick={() =>
                  inspectFile({
                    path: target.path,
                    mode: 'blame',
                    rev: source.kind === 'commit' ? source.hash : null
                  })
                }
              >
                <ScanText size={14} /> Blame
              </button>
            )}
          </>
        )}
        <button
          className="diff-close"
          onClick={() => (onClose ? onClose() : openDiff(null))}
          title={onClose ? 'Close' : 'Close (Esc)'}
        >
          <X size={18} />
        </button>
      </div>
      {diff && !diff.binary && (
        <div className="diff-options">
          <span className="segmented">
            {(['unified', 'split'] as const).map((value) => (
              <button
                key={value}
                className={layout === value ? 'active' : ''}
                onClick={() => updateSettings({ diffLayout: value })}
              >
                {value === 'unified' ? 'Unified' : 'Split'}
              </button>
            ))}
          </span>
          <label title="Show every line of the file, not only the changed parts">
            <input
              type="checkbox"
              checked={fullFile}
              onChange={(e) => updateSettings({ diffFullFile: e.target.checked })}
            />
            Whole file
          </label>
          <label title="Unchanged lines shown around each change">
            Context
            <select
              value={contextSetting}
              disabled={fullFile}
              onChange={(e) =>
                updateSettings({ diffContext: Math.min(DIFF_CONTEXT_MAX, Number(e.target.value)) })
              }
            >
              {[...new Set([...CONTEXT_CHOICES, contextSetting])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={ignoreWhitespace}
              onChange={(e) => updateSettings({ diffIgnoreWhitespace: e.target.checked })}
            />
            Ignore whitespace
          </label>
          <label>
            <input
              type="checkbox"
              checked={wrap}
              onChange={(e) => updateSettings({ diffWrap: e.target.checked })}
            />
            Wrap lines
          </label>
        </div>
      )}
      {lineLevel && (
        <div className="diff-hint">Click lines to select them, Shift+click to select a range.</div>
      )}
      {partial && !patchable && (
        <div className="diff-hint">
          To stage hunks or lines,{' '}
          {ignoreWhitespace ? 'show whitespace changes' : 'set the context to at least 1 line'}.
        </div>
      )}
      {diff?.conflicted && (
        <div className="diff-hint conflict-hint">
          Conflicted file, compared with HEAD. Edit it to remove the conflict markers and mark it
          resolved, or keep one side.
        </div>
      )}
      <div className={`diff-body${wrap ? ' wrap' : ''}`}>{body}</div>
    </div>
  )
}
