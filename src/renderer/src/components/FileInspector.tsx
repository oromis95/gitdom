import { useEffect } from 'react'
import {
  Braces,
  Download,
  FileText,
  Film,
  History,
  ListTree,
  ScanText,
  Undo2,
  X
} from 'lucide-react'
import type { RepoSnapshot } from '../../../shared/types'
import { useApp, type FileInspect } from '../store'
import { fromTerminal, notify, prompt } from '../ui'
import { functionRange, rangeLabel } from '../lineRange'
import { saveFileAt } from '../actions'
import FileTimelapse from './FileTimelapse'
import FileBlame from './inspector/FileBlame'
import FileContents from './inspector/FileContents'
import FileHistory from './inspector/FileHistory'
import FileLines from './inspector/FileLines'

/** A file, its history or its blame, in place of the graph. */
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
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !fromTerminal(e) &&
        !document.querySelector('.modal, .menu')
      )
        inspectFile(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectFile])

  const back = inspect.back?.[inspect.back.length - 1]
  const mode = (m: FileInspect['mode']): void => {
    if (m !== inspect.mode) inspectFile({ ...inspect, mode: m })
  }
  const followFunction = async (): Promise<void> => {
    const current = inspect.range?.startsWith(':') ? rangeLabel(inspect.range).slice(9) : ''
    const name = (
      await prompt(
        'History of a function',
        'Function name, as git finds it in the file',
        current,
        'Show history'
      )
    )?.trim()
    if (!name) return
    if (name.includes(':')) return notify('error', 'A function name can’t contain “:”')
    inspectFile({ ...inspect, mode: 'lines', range: functionRange(name) })
  }

  return (
    <div className="diff-view inspector">
      <div className="diff-header">
        <span className="diff-path" title={shownPath}>
          {shownPath !== inspect.path && <span className="muted">{shownPath} → </span>}
          {inspect.path}
        </span>
        {(inspect.mode === 'blame' || inspect.mode === 'file') && (
          <span className="diff-source">
            {inspect.rev ? `at ${inspect.rev.slice(0, 7)}` : 'working tree'}
          </span>
        )}
        {inspect.mode === 'lines' && inspect.range && (
          <span className="diff-source">
            {rangeLabel(inspect.range)}
            {inspect.rev ? ` at ${inspect.rev.slice(0, 7)}` : ''}
          </span>
        )}
        {(inspect.mode === 'blame' || inspect.mode === 'file') && inspect.rev && (
          <button
            className="btn btn-small"
            title="Show the working tree version"
            onClick={() =>
              inspectFile({
                ...inspect,
                rev: null,
                revPath: undefined,
                line: undefined,
                back: undefined
              })
            }
          >
            Latest
          </button>
        )}
        {inspect.mode === 'blame' && back && (
          <button
            className="btn btn-small"
            title={`Back to ${back.rev ? back.rev.slice(0, 7) : 'the working tree'}`}
            onClick={() =>
              inspectFile({
                ...inspect,
                rev: back.rev,
                revPath: back.revPath,
                line: back.line,
                back: inspect.back!.slice(0, -1)
              })
            }
          >
            <Undo2 size={13} /> Back
          </button>
        )}
        <span className="toolbar-spacer" />
        <button
          className="btn btn-small"
          title="Follow a function through the history"
          onClick={() => void followFunction()}
        >
          <Braces size={13} /> Function…
        </button>
        {inspect.mode === 'file' && inspect.rev && (
          <button
            className="btn btn-small"
            title="Save the file as it was at this commit"
            onClick={() => void saveFileAt(snapshot.path, inspect.rev!, shownPath)}
          >
            <Download size={13} /> Save as…
          </button>
        )}
        <div className="segmented">
          <button
            className={inspect.mode === 'file' ? 'active' : ''}
            onClick={() => mode('file')}
            title="The file itself"
          >
            <FileText size={14} /> File
          </button>
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
          <button
            className={inspect.mode === 'timelapse' ? 'active' : ''}
            onClick={() => mode('timelapse')}
            title="Drag through every version of the file, with who changed each line"
          >
            <Film size={14} /> Time-lapse
          </button>
          {inspect.range && (
            <button
              className={inspect.mode === 'lines' ? 'active' : ''}
              onClick={() => mode('lines')}
              title={`History of ${rangeLabel(inspect.range)}`}
            >
              <ListTree size={14} /> Lines
            </button>
          )}
        </div>
        <button className="diff-close" onClick={() => inspectFile(null)} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      {inspect.mode === 'history' ? (
        <FileHistory snapshot={snapshot} inspect={inspect} />
      ) : inspect.mode === 'lines' ? (
        <FileLines snapshot={snapshot} inspect={inspect} />
      ) : inspect.mode === 'file' ? (
        <FileContents snapshot={snapshot} inspect={inspect} />
      ) : inspect.mode === 'timelapse' ? (
        <FileTimelapse snapshot={snapshot} inspect={inspect} />
      ) : (
        <FileBlame snapshot={snapshot} inspect={inspect} />
      )}
    </div>
  )
}
