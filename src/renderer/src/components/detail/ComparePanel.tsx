import { useEffect, useState } from 'react'
import { ArrowLeftRight, X } from 'lucide-react'
import type { Result } from '../../../../shared/api'
import type { FileChange } from '../../../../shared/types'
import { useApp, type CompareTarget } from '../../store'
import { useFileView } from './fileListing'
import { ViewToggle } from './ViewToggle'
import { FileList } from './FileList'

const shortRev = (rev: string): string => (/^[0-9a-f]{40,64}$/i.test(rev) ? rev.slice(0, 7) : rev)

/** Files changed between two revisions picked in the graph or the sidebar (DIFF-08). */
export function ComparePanel({
  repoPath,
  target
}: {
  repoPath: string
  target: CompareTarget
}): React.JSX.Element {
  const compare = useApp((s) => s.compare)
  const key = JSON.stringify(target)
  const [loaded, setLoaded] = useState<{ key: string; result: Result<FileChange[]> } | null>(null)
  const [view, changeView] = useFileView()

  useEffect(() => {
    let cancelled = false
    void window.api.op(repoPath, 'compareFiles', target.from, target.to).then((result) => {
      if (!cancelled) setLoaded({ key, result })
    })
    return () => {
      cancelled = true
    }
    // target is covered by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, key])

  let files: React.ReactNode
  if (!loaded || loaded.key !== key) files = <div className="center-message">Loading…</div>
  else if (!loaded.result.ok) files = <div className="banner-error">{loaded.result.error}</div>
  else if (!loaded.result.value.length)
    files = <div className="center-message">No differences between the two</div>
  else
    files = (
      <div>
        <div className="file-group-title">{loaded.result.value.length} changed files</div>
        <FileList
          files={loaded.result.value}
          kind="compare"
          view={view}
          repo={repoPath}
          compare={target}
        />
      </div>
    )

  return (
    <div className="detail-scroll">
      <div className="detail-title-row">
        <div className="detail-title">Comparing two revisions</div>
        <ViewToggle view={view} onChange={changeView} />
      </div>
      <dl className="detail-meta">
        <dt>from</dt>
        <dd className="mono" title={target.from}>
          {shortRev(target.from)}
        </dd>
        <dt>to</dt>
        <dd className="mono" title={target.to}>
          {shortRev(target.to)}
        </dd>
      </dl>
      <div className="compare-actions">
        <button
          className="btn btn-small"
          onClick={() => compare({ from: target.to, to: target.from })}
        >
          <ArrowLeftRight size={13} /> Swap
        </button>
        <button className="btn btn-small" onClick={() => compare(null)}>
          <X size={13} /> Close
        </button>
      </div>
      {files}
    </div>
  )
}
