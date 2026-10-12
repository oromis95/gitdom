import type { RepoSnapshot } from '../../../shared/types'
import { WIP_HASH, type CompareTarget } from '../store'
import { roomBeside, updateSettings } from '../settings'
import ResizeHandle from './ResizeHandle'
import { ComparePanel } from './detail/ComparePanel'
import { CommitPanel } from './detail/CommitPanel'
import { WorkingTreePanel } from './detail/WorkingTreePanel'

export default function DetailPanel({
  snapshot,
  selected,
  compare,
  edge = 'left'
}: {
  snapshot: RepoSnapshot
  selected: string | null
  compare?: CompareTarget
  /** Edge with the resize handle, where the layout puts it; null when it fills the room */
  edge?: 'left' | 'right' | null
}): React.JSX.Element {
  let content: React.JSX.Element
  if (compare) content = <ComparePanel repoPath={snapshot.path} target={compare} />
  else if (selected === WIP_HASH) content = <WorkingTreePanel snapshot={snapshot} />
  else if (selected) content = <CommitPanel repoPath={snapshot.path} hash={selected} />
  else content = <div className="center-message">Select a commit</div>

  return (
    <aside className="detail">
      {edge && (
        <ResizeHandle
          edge={edge}
          min={300}
          max={() => roomBeside('.sidebar', 300)}
          onResize={(width) => updateSettings({ detailWidth: width })}
        />
      )}
      {content}
    </aside>
  )
}
