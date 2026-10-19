import { useMemo } from 'react'
import { Download } from 'lucide-react'
import type { RepoSnapshot } from '../../../../shared/types'
import type { FileInspect } from '../../store'
import { highlightLines } from '../../highlight'
import { formatBytes } from '../../statistics'
import { saveFileAt } from '../../actions'
import { useLoaded } from '../inspect'

/** The file itself, at a commit or in the working tree. */
export default function FileContents({
  snapshot,
  inspect
}: {
  snapshot: RepoSnapshot
  inspect: FileInspect
}): React.JSX.Element {
  const repo = snapshot.path
  const path = inspect.revPath ?? inspect.path
  const reload = inspect.rev ? '' : JSON.stringify(snapshot.status) + snapshot.head.hash
  const result = useLoaded(`${path}\0${inspect.rev}\0${reload}`, () =>
    window.api.op(repo, 'fileAt', inspect.rev, path)
  )
  const file = result?.ok ? result.value : null
  const lines = useMemo(
    () => (file?.text ? file.text.replace(/\r?\n$/, '').split(/\r?\n/) : []),
    [file]
  )
  const highlighted = useMemo(() => highlightLines(path, lines), [path, lines])

  if (!result) return <div className="center-message">Loading…</div>
  if (!result.ok) return <div className="banner-error">{result.error}</div>
  const save = inspect.rev && (
    <button className="btn btn-small" onClick={() => void saveFileAt(repo, inspect.rev!, path)}>
      <Download size={13} /> Save as…
    </button>
  )
  if (file!.tooLarge || file!.binary)
    return (
      <div className="center-message file-unshown">
        <span>
          {file!.tooLarge ? 'Too large to show' : 'Binary file'}: {formatBytes(file!.size)}
        </span>
        {save}
      </div>
    )
  return (
    <div className="diff-body blame-body">
      {file!.image && (
        <div className="file-image">
          <img className="checkerboard" src={file!.image} alt={path} />
          <span className="muted">{formatBytes(file!.size)}</span>
        </div>
      )}
      {!file!.image && !lines.length && <div className="center-message">Empty file</div>}
      {lines.length > 0 && (
        <div className="blame-lines">
          {lines.map((_, i) => (
            <div key={i} className="blame-line">
              <span className="diff-no">{i + 1}</span>
              <span
                className="diff-code"
                dangerouslySetInnerHTML={{ __html: highlighted[i] || ' ' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
