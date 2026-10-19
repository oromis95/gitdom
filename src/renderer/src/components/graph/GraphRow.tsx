// A row of the graph: the labels of its commit, the message, and the optional columns. Dragged
// along the current branch to reorder the commits.
import { Archive, Pencil } from 'lucide-react'
import type { Commit, RepoSnapshot, Stash } from '../../../../shared/types'
import { NODE_RADIUS, ROW_HEIGHT, laneX } from '../../graph/draw'
import { laneColor } from '../../graph/colors'
import type { GraphItem } from '../../graph/rows'
import type { RefLabel } from '../../graph/refLabels'
import { hoverCard } from '../../hover'
import { describeDate } from '../../time'
import type { Settings } from '../../settings'
import * as actions from '../../actions'
import { AuthorCard, CommitCard, StashCard } from '../HoverCards'
import { Marked, RefPill } from './cells'
import type { CommitReorder } from './hooks'
import { openRefsMenu, rowKey } from './shared'

/** Drag and drop payload: the hash of a commit being moved along the current branch */
const COMMIT_MIME = 'application/x-gitdom-commit'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })

export default function GraphRow({
  snapshot,
  row,
  index,
  lane,
  labels,
  className,
  refsWidth,
  width,
  settings,
  commitKey,
  bisectMark,
  reorder,
  onMouseDown,
  onContextMenu,
  onHoverRef
}: {
  snapshot: RepoSnapshot
  row: GraphItem
  index: number
  lane: number
  labels: RefLabel[] | undefined
  className: string
  refsWidth: number
  /** Width of the graph's lanes */
  width: number
  settings: Settings
  /** The search in commits, marked in the message, SHA and author */
  commitKey: string
  bisectMark: string | undefined
  reorder: CommitReorder
  onMouseDown(e: React.MouseEvent): void
  onContextMenu(e: React.MouseEvent): void
  /** The mouse entered or left the first label: its branch lights up (GRAPH-15) */
  onHoverRef(on: boolean): void
}): React.JSX.Element {
  const { movable, movableIndex, dragged, setDragged, dropAt, setDropAt, endDrag } = reorder
  const color = laneColor(lane)
  const hash = rowKey(row)
  const canMove = movableIndex.has(hash)

  const commitCard = (commit: Commit): ReturnType<typeof hoverCard> =>
    hoverCard(() => (
      <CommitCard
        snapshot={snapshot}
        commit={commit}
        hint={canMove ? 'Drag to move it along the branch' : undefined}
      />
    ))
  const authorCard = (commit: Commit): ReturnType<typeof hoverCard> =>
    hoverCard(() => (
      <AuthorCard snapshot={snapshot} name={commit.authorName} email={commit.authorEmail} />
    ))
  const stashCard = (stash: Stash): ReturnType<typeof hoverCard> =>
    hoverCard(() => <StashCard snapshot={snapshot} stash={stash} />)

  return (
    <div
      className={className}
      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
      onMouseDown={onMouseDown}
      draggable={canMove}
      onDragStart={(e) => {
        if (!canMove || e.target !== e.currentTarget) return
        e.dataTransfer.setData(COMMIT_MIME, hash)
        e.dataTransfer.effectAllowed = 'move'
        setDragged(hash)
      }}
      onDragEnd={endDrag}
      onDragOver={(e) => {
        if (!canMove || !dragged || !e.dataTransfer.types.includes(COMMIT_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const box = e.currentTarget.getBoundingClientRect()
        const after = e.clientY > box.top + box.height / 2
        if (dropAt?.hash !== hash || dropAt.after !== after) setDropAt({ hash, after })
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && dropAt?.hash === hash)
          setDropAt(null)
      }}
      onDrop={(e) => {
        const source = e.dataTransfer.getData(COMMIT_MIME)
        const from = movableIndex.get(source)
        const to = movableIndex.get(hash)
        const after = dropAt?.after ?? false
        endDrag()
        if (from === undefined || to === undefined) return
        e.preventDefault()
        void actions.reorderCommits(snapshot, movable, from, to, after)
      }}
      onContextMenu={onContextMenu}
    >
      <div className="cell-refs" style={{ width: refsWidth + laneX(lane) }}>
        {settings.graphShowRefs && labels && (
          <>
            <RefPill label={labels[0]} color={color} snapshot={snapshot} onHover={onHoverRef} />
            {labels.length > 1 && (
              <span
                className="ref-more"
                title={labels.map((l) => l.name).join('\n')}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => openRefsMenu(e, snapshot, labels.slice(1))}
                onContextMenu={(e) => openRefsMenu(e, snapshot, labels.slice(1))}
              >
                +{labels.length - 1}
              </span>
            )}
            <div className="ref-connector" style={{ background: color }} />
          </>
        )}
        {settings.graphShowRefs && row.kind === 'stash' && (
          <>
            <div className="ref-pill stash-pill" {...stashCard(row.stash)}>
              <Archive size={12} />
              <span>{row.stash.selector}</span>
            </div>
            <div className="ref-connector stash-connector" />
          </>
        )}
      </div>
      <div style={{ width: width - laneX(lane), flexShrink: 0 }} />
      {row.kind === 'commit' && (
        <div
          className="graph-node-hover"
          style={{
            left: refsWidth + laneX(lane) - NODE_RADIUS,
            top: ROW_HEIGHT / 2 - NODE_RADIUS,
            width: NODE_RADIUS * 2,
            height: NODE_RADIUS * 2
          }}
          {...authorCard(row.commit)}
        />
      )}
      {row.kind === 'wip' ? (
        <div className="cell-message wip-message">
          {'// WIP'} &nbsp;
          <Pencil size={12} color="var(--orange)" /> {row.changes}
        </div>
      ) : (
        <>
          <div
            className={`cell-message${row.kind === 'stash' ? ' stash-message' : ''}`}
            {...(row.kind === 'commit' ? commitCard(row.commit) : stashCard(row.stash))}
          >
            {row.kind === 'commit' && bisectMark && (
              <span className={`bisect-mark ${bisectMark}`}>{bisectMark}</span>
            )}
            <Marked
              text={row.kind === 'commit' ? row.commit.subject : row.stash.message}
              mark={commitKey}
            />
          </div>
          {settings.graphShowSha && (
            <div className="cell-sha" style={{ width: settings.graphShaWidth }}>
              <Marked
                text={hash.slice(0, 7)}
                mark={commitKey && hash.startsWith(commitKey) ? commitKey : ''}
              />
            </div>
          )}
          {settings.graphShowAuthor && (
            <div
              className="cell-author"
              style={{ width: settings.graphAuthorWidth }}
              {...(row.kind === 'commit' ? authorCard(row.commit) : {})}
            >
              {row.kind === 'commit' && <Marked text={row.commit.authorName} mark={commitKey} />}
            </div>
          )}
          {settings.graphShowDate && (
            <div
              className="cell-date"
              style={{ width: settings.graphDateWidth }}
              title={describeDate(row.kind === 'commit' ? row.commit.authorDate : row.stash.date)}
            >
              {dateFormat.format(
                (row.kind === 'commit' ? row.commit.authorDate : row.stash.date) * 1000
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
