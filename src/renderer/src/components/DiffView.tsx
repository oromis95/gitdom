import { useEffect, useMemo, useState } from 'react'
import { History, ScanText, X } from 'lucide-react'
import type { Result } from '../../../shared/api'
import { buildPatch } from '../../../shared/diff'
import type { FileChange, FileDiff, Hunk, RepoSnapshot } from '../../../shared/types'
import { useApp, type DiffTarget } from '../store'
import { highlightLines } from '../highlight'
import { confirm, fromTerminal } from '../ui'
import { discardFiles, markResolved, resolveWith, run } from '../actions'

/** Highlights the lines of all hunks, keeping them grouped by hunk. */
function highlightHunks(diff: FileDiff): string[][] {
  const html = highlightLines(
    diff.path,
    diff.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text))
  )
  let next = 0
  return diff.hunks.map((hunk) => hunk.lines.map(() => html[next++]))
}

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
  const repo = snapshot.path
  const { source } = target
  const key = JSON.stringify(target)
  // Working tree diffs change as files are staged or edited: reload with every status update
  const reloadToken = source.kind === 'commit' ? null : snapshot.status

  const [loaded, setLoaded] = useState<LoadedDiff | null>(null)
  const [selection, setSelection] = useState<{ diff: FileDiff | null; lines: Selection }>({
    diff: null,
    lines: new Map()
  })
  const [anchor, setAnchor] = useState<{ hunk: number; line: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'diff', source, target.path, target.oldPath).then((result) => {
      if (!cancelled) setLoaded({ key, result })
    })
    return () => {
      cancelled = true
    }
    // reloadToken is a deliberate trigger; source/path are covered by key
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
  const lineLevel =
    !!diff &&
    !diff.binary &&
    !diff.change &&
    !diff.conflicted &&
    (source.kind === 'unstaged' || source.kind === 'staged')

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

  let body: React.ReactNode
  if (!loaded || loaded.key !== key) body = <div className="center-message">Loading…</div>
  else if (!loaded.result.ok) body = <div className="banner-error">{loaded.result.error}</div>
  else if (diff!.binary) body = <div className="center-message">Binary file</div>
  else if (diff!.hunks.length === 0) body = <div className="center-message">No changes</div>
  else {
    body = diff!.hunks.map((hunk, h) => {
      const hunkSelection = selected.get(h)
      const count = hunkSelection?.size ?? 0
      const unit = count ? 'lines' : 'hunk'
      const suffix = count ? ` (${count})` : ''
      return (
        <div key={h} className="hunk">
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
          {hunk.lines.map((line, l) => (
            <div
              key={l}
              className={`diff-line ${line.type}${hunkSelection?.has(l) ? ' selected' : ''}${
                lineLevel && line.type !== 'context' ? ' selectable' : ''
              }`}
              onMouseDown={(e) => {
                if (line.type === 'context') return
                e.preventDefault()
                toggleLine(h, l, e.shiftKey)
              }}
            >
              <span className="diff-no">{line.oldNo ?? ''}</span>
              <span className="diff-no">{line.newNo ?? ''}</span>
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
          ))}
        </div>
      )
    })
  }

  const sourceLabel =
    source.kind === 'commit'
      ? `commit ${source.hash.slice(0, 7)}`
      : source.kind === 'untracked'
        ? 'new file'
        : source.kind

  return (
    <div className="diff-view">
      <div className="diff-header">
        <span className="diff-path" title={target.path}>
          {target.oldPath && target.oldPath !== target.path && (
            <span className="muted">{target.oldPath} → </span>
          )}
          {target.path}
        </span>
        <span className="diff-source">{sourceLabel}</span>
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
      {lineLevel && (
        <div className="diff-hint">Click lines to select them, Shift+click to select a range.</div>
      )}
      {diff?.conflicted && (
        <div className="diff-hint conflict-hint">
          Conflicted file, compared with HEAD. Edit it to remove the conflict markers and mark it
          resolved, or keep one side.
        </div>
      )}
      <div className="diff-body">{body}</div>
    </div>
  )
}
