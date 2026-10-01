import { useEffect, useState } from 'react'
import { buildEditedPatch, hunkNewText } from '../../../shared/diff'
import type { FileDiff, Hunk } from '../../../shared/types'
import { run } from '../actions'

/**
 * Edits what a hunk stages: the lines as they will be in the index, while the file on disk keeps
 * its changes. Resolves through onClose once staged or cancelled.
 */
export default function HunkEditor({
  repo,
  diff,
  hunk,
  onClose
}: {
  repo: string
  diff: FileDiff
  hunk: Hunk
  onClose(): void
}): React.JSX.Element {
  const lines = hunkNewText(hunk)
  // A textarea turns line endings into \n: Windows ones go back on when staging
  const crlf = lines.length > 0 && lines.every((l) => l.endsWith('\r'))
  const original = (crlf ? lines.map((l) => l.slice(0, -1)) : lines).join('\n')
  const [text, setText] = useState(original)
  const [busy, setBusy] = useState(false)

  const edited = text === '' ? [] : text.split('\n').map((l) => (crlf ? l + '\r' : l))
  const patch = buildEditedPatch(diff, hunk, edited)
  const first = hunk.oldStart
  const last = first + Math.max(hunk.oldLines - 1, 0)

  // On the window: a button that just got disabled leaves the focus nowhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stage = async (): Promise<void> => {
    if (!patch || busy) return
    setBusy(true)
    if (await run(repo, 'applyPatch', patch, true, false)) onClose()
    else setBusy(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal hunk-editor"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void stage()
        }}
      >
        <div className="modal-title">Edit before staging</div>
        <div className="modal-message">
          Change the lines as they should be staged. The file on disk stays as it is: what you leave
          out remains an unstaged change.
        </div>
        <div className="hunk-editor-where mono">
          {diff.path} · {first === last ? `line ${first}` : `lines ${first}–${last}`} in the index
        </div>
        <textarea
          className="hunk-editor-text mono"
          value={text}
          autoFocus
          spellCheck={false}
          wrap="off"
          rows={Math.min(Math.max(lines.length + 1, 6), 22)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Code is indented with Tab; insertText keeps the textarea's own undo
            if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey) return
            e.preventDefault()
            document.execCommand('insertText', false, '\t')
          }}
        />
        <div className="hunk-editor-hint">
          {patch ? 'Ctrl+Enter stages' : 'Nothing to stage: these lines are as in the index'}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn hunk-editor-reset"
            disabled={text === original}
            onClick={() => setText(original)}
          >
            Reset
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!patch || busy}
            onClick={() => void stage()}
          >
            Stage
          </button>
        </div>
      </div>
    </div>
  )
}
