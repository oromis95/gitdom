// Pieces of the rows and the header of the graph: branch and tag labels, marked text, column headers.
import { Fragment, useState } from 'react'
import { Check, Cloud, Laptop, Tag } from 'lucide-react'
import type { RepoSnapshot } from '../../../../shared/types'
import { hoverCard } from '../../hover'
import { markMatches } from '../../graph/search'
import { readableOn } from '../../themes'
import type { RefLabel } from '../../graph/refLabels'
import { openMenu } from '../../ui'
import { DEFAULT_SETTINGS, GRAPH_COLUMN_WIDTH, updateSettings, useSettings } from '../../settings'
import * as actions from '../../actions'
import { RefCard } from '../HoverCards'
import { isReady, pullsByRef, useForgeStatus } from '../../forge'
import { useApp } from '../../store'
import { PullBadge } from '../forge/PullBits'
import PullCard from '../forge/PullCard'
import ResizeHandle from '../ResizeHandle'
import type { WidthKey } from './shared'

/** Drag and drop payload: the full name of the dragged branch */
const REF_MIME = 'application/x-gitdom-ref'

/** Header cell of an optional column, resized from its edge next to the message. */
export function ColumnHeader({
  title,
  width,
  edge
}: {
  title: string
  width: WidthKey
  edge: 'left' | 'right'
}): React.JSX.Element {
  const value = useSettings((s) => s[width])
  return (
    <div className={`graph-col col-${width}`} style={{ width: value }}>
      {title}
      <ResizeHandle
        edge={edge}
        min={GRAPH_COLUMN_WIDTH.min}
        max={() => GRAPH_COLUMN_WIDTH.max}
        onResize={(w) => updateSettings({ [width]: w ?? DEFAULT_SETTINGS[width] })}
      />
    </div>
  )
}

/** Text with every occurrence of the search marked. */
export function Marked({ text, mark }: { text: string; mark: string }): React.JSX.Element {
  return (
    <>
      {markMatches(text, mark).map((part, i) =>
        part.mark ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>
      )}
    </>
  )
}

export function RefPill({
  label,
  color,
  snapshot,
  onHover
}: {
  label: RefLabel
  color: string
  snapshot: RepoSnapshot
  /** The mouse entered or left the pill: its branch lights up (GRAPH-15) */
  onHover(on: boolean): void
}): React.JSX.Element {
  const ref = snapshot.refs.find((r) => r.fullName === label.key)
  const [over, setOver] = useState(false)
  const forge = useForgeStatus(snapshot.path)
  const showPulls = useSettings((s) => s.graphPullRequests)
  const pull = showPulls && isReady(forge) ? pullsByRef(forge, snapshot).get(label.key) : undefined
  const isBranch = ref?.type === 'local' || ref?.type === 'remote'
  const dragging = (e: React.DragEvent): boolean =>
    isBranch && e.dataTransfer.types.includes(REF_MIME)
  const card = hoverCard(() =>
    ref ? (
      <>
        <RefCard
          snapshot={snapshot}
          refInfo={ref}
          hint={
            isBranch
              ? `${label.current ? '' : 'Double-click to check out · '}Drag onto another branch to merge or rebase`
              : undefined
          }
        />
        {pull && isReady(forge) && (
          <div className="hover-pull">
            <PullCard pull={pull} kind={forge.repo.kind} hint="Click the badge to open it" />
          </div>
        )}
      </>
    ) : null
  )

  return (
    <div
      className={`ref-pill${over ? ' drop-target' : ''}`}
      style={{ background: color, color: readableOn(color) }}
      title={ref ? undefined : label.name}
      draggable={isBranch}
      onMouseEnter={(e) => {
        onHover(true)
        card.onMouseEnter(e)
      }}
      onMouseLeave={() => {
        onHover(false)
        card.onMouseLeave()
      }}
      onDragStart={(e) => {
        if (!ref) return
        e.dataTransfer.setData(REF_MIME, ref.fullName)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!dragging(e)) return
        e.preventDefault()
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        const source = snapshot.refs.find((r) => r.fullName === e.dataTransfer.getData(REF_MIME))
        if (!ref || !source || !dragging(e)) return
        e.preventDefault()
        void actions.dropBranch(e.clientX, e.clientY, snapshot, source, ref)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (ref?.type === 'local' && !label.current)
          void actions.checkoutBranch(snapshot.path, ref.name)
        else if (ref?.type === 'remote')
          void actions.checkoutRemoteBranch(snapshot.path, snapshot, ref)
      }}
      onContextMenu={(e) => ref && openMenu(e, actions.refMenu(snapshot, ref))}
    >
      {label.current && <Check size={13} />}
      {label.tag && <Tag size={12} />}
      <span>{label.name}</span>
      {label.local && <Laptop size={13} />}
      {label.remote && <Cloud size={13} />}
      {pull && isReady(forge) && (
        <PullBadge
          pull={pull}
          kind={forge.repo.kind}
          onOpen={() => useApp.getState().openPullRequest(pull.number)}
        />
      )}
    </div>
  )
}
