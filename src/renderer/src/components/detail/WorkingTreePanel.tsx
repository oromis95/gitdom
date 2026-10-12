import { ChevronDown, Eraser, Trash2 } from 'lucide-react'
import type { RepoSnapshot } from '../../../../shared/types'
import { openMenu } from '../../ui'
import {
  abortOperation,
  conflictMenu,
  continueOperation,
  discardFiles,
  markResolved,
  run,
  showCleanUp,
  skipOperation
} from '../../actions'
import { pathsOf, useFileView } from './fileListing'
import { ViewToggle } from './ViewToggle'
import { FileList } from './FileList'
import { CommitBox } from './CommitBox'

function OperationBanner({
  snapshot,
  conflicts
}: {
  snapshot: RepoSnapshot
  conflicts: number
}): React.JSX.Element {
  // git am applies patches
  const operation = snapshot.operation === 'am' ? 'patch' : snapshot.operation!
  const repo = snapshot.path
  return (
    <div className="banner-warning operation-banner">
      <div>
        <strong>A {operation} is in progress.</strong>{' '}
        {conflicts > 0
          ? `Resolve ${conflicts} conflicted file${conflicts === 1 ? '' : 's'}: edit ${
              conflicts === 1 ? 'it' : 'them'
            } and mark resolved, or pick one side, then continue.`
          : `No conflicts left: continue to finish the ${operation}.`}
      </div>
      <div className="operation-actions">
        <button
          className="btn btn-small btn-danger-outline"
          onClick={() => void abortOperation(repo, operation)}
        >
          Abort {operation}
        </button>
        {operation !== 'merge' && (
          <button
            className="btn btn-small"
            title="Leave out the commit that stopped the operation"
            onClick={() => void skipOperation(repo, operation)}
          >
            Skip commit
          </button>
        )}
        <button
          className="btn btn-small btn-primary"
          disabled={conflicts > 0}
          title={conflicts > 0 ? 'Resolve all conflicts first' : undefined}
          onClick={() => void continueOperation(repo, operation)}
        >
          Continue {operation}
        </button>
      </div>
    </div>
  )
}

export function WorkingTreePanel({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const { staged } = snapshot.status
  const conflicted = snapshot.status.unstaged.filter((f) => f.status === 'U')
  const unstaged = snapshot.status.unstaged.filter((f) => f.status !== 'U')
  const repo = snapshot.path
  const [view, changeView] = useFileView()

  return (
    <>
      <div className="detail-scroll">
        <div className="detail-title-row">
          <div className="detail-title">
            {staged.length + snapshot.status.unstaged.length} file changes on{' '}
            <span className="link">{snapshot.head.branch ?? 'HEAD'}</span>
          </div>
          <ViewToggle view={view} onChange={changeView} />
        </div>
        {snapshot.operation && (
          <OperationBanner snapshot={snapshot} conflicts={conflicted.length} />
        )}
        {conflicted.length > 0 && (
          <div>
            <div className="file-group-title conflict-title">
              <ChevronDown size={15} /> Conflicted Files ({conflicted.length})
              <span className="toolbar-spacer" />
              <button
                className="btn btn-small"
                onClick={(e) => openMenu(e, conflictMenu(repo, pathsOf(conflicted)))}
              >
                Resolve all…
              </button>
            </div>
            <FileList
              files={conflicted}
              kind="conflicted"
              view={view}
              repo={repo}
              action={{
                label: 'Mark resolved',
                run: (files) => void markResolved(repo, pathsOf(files))
              }}
            />
          </div>
        )}
        <div>
          <div className="file-group-title">
            <ChevronDown size={15} /> Unstaged Files ({unstaged.length})
            <span className="toolbar-spacer" />
            {unstaged.some((f) => f.status === '?') && (
              <button
                className="btn btn-small"
                title="Clean up untracked files…"
                aria-label="Clean up untracked files"
                onClick={() => showCleanUp(repo)}
              >
                <Eraser size={13} />
              </button>
            )}
            {unstaged.length > 0 && (
              <button
                className="btn btn-small btn-danger-outline"
                title="Discard all changes"
                aria-label="Discard all changes"
                onClick={() => void discardFiles(repo, unstaged)}
              >
                <Trash2 size={13} />
              </button>
            )}
            {unstaged.length > 0 && (
              <button
                className="btn btn-small btn-stage"
                onClick={() =>
                  // With conflicts, stage everything else: conflicted files are marked resolved explicitly
                  void (conflicted.length > 0
                    ? run(repo, 'stage', pathsOf(unstaged))
                    : run(repo, 'stageAll'))
                }
              >
                Stage all changes
              </button>
            )}
          </div>
          <FileList
            files={unstaged}
            kind="unstaged"
            view={view}
            repo={repo}
            action={{ label: 'Stage', run: (files) => void run(repo, 'stage', pathsOf(files)) }}
          />
        </div>
        <div>
          <div className="file-group-title">
            <ChevronDown size={15} /> Staged Files ({staged.length})
            <span className="toolbar-spacer" />
            {staged.length > 0 && (
              <button
                className="btn btn-small btn-unstage"
                onClick={() => void run(repo, 'unstageAll')}
              >
                Unstage all changes
              </button>
            )}
          </div>
          <FileList
            files={staged}
            kind="staged"
            view={view}
            repo={repo}
            action={{ label: 'Unstage', run: (files) => void run(repo, 'unstage', pathsOf(files)) }}
          />
        </div>
      </div>
      <CommitBox snapshot={snapshot} />
    </>
  )
}
