// The Pull Requests section of the sidebar (SIDE-07): the user's own, those waiting for their
// review, and the others; or the button connecting the account.
import { GitPullRequest, LogIn, MessageSquare, TriangleAlert } from 'lucide-react'
import {
  FORGE_NAMES,
  PUBLIC_HOSTS,
  PULL_NOUN,
  type ForgeKind,
  type ForgeStatus,
  type PullRequest
} from '../../../../shared/forge'
import type { RepoSnapshot } from '../../../../shared/types'
import {
  connectForge,
  groupPulls,
  openInBrowser,
  pullLabel,
  refreshForge,
  useForge
} from '../../forge'
import { hoverCard } from '../../hover'
import { useApp } from '../../store'
import { openMenu, type MenuItem } from '../../ui'
import * as actions from '../../actions'
import Section from '../SidebarSection'
import PullCard from './PullCard'
import { CheckIcon, PullIcon, VoteIcon } from './PullBits'

const matches = (pull: PullRequest, query: string, kind: ForgeKind): boolean =>
  !query ||
  [pull.title, pullLabel(kind, pull.number), pull.author.login, pull.sourceBranch].some((text) =>
    text.toLowerCase().includes(query)
  )

function pullMenu(snapshot: RepoSnapshot, pull: PullRequest, kind: ForgeKind): MenuItem[] {
  // Bitbucket gives the start of the hash only
  const head = pull.headSha
    ? snapshot.commits.find((c) => c.hash.startsWith(pull.headSha))
    : undefined
  return [
    {
      label: `Open ${pullLabel(kind, pull.number)}`,
      onClick: () => useApp.getState().openPullRequest(pull.number)
    },
    { label: `Open in ${FORGE_NAMES[kind]}`, onClick: () => openInBrowser(pull.url) },
    ...(head
      ? [
          {
            label: 'Show its last commit in the graph',
            onClick: () => useApp.getState().select(head.hash, true)
          }
        ]
      : []),
    'separator' as const,
    { label: 'Copy link', onClick: () => actions.copy(pull.url) },
    { label: 'Copy source branch name', onClick: () => actions.copy(pull.sourceBranch) }
  ]
}

function PullRow({
  snapshot,
  pull,
  kind,
  viewer
}: {
  snapshot: RepoSnapshot
  pull: PullRequest
  kind: ForgeKind
  viewer: string
}): React.JSX.Element {
  const open = useApp((s) => s.tabs[s.active]?.pullRequest === pull.number)
  const mine = pull.reviewers.find((r) => r.user.login.toLowerCase() === viewer)
  return (
    <button
      className={`tree-item pull-row${open ? ' current' : ''}`}
      style={{ paddingLeft: 26 }}
      {...hoverCard(() => <PullCard pull={pull} kind={kind} hint="Click to open" />)}
      onClick={() => useApp.getState().openPullRequest(pull.number)}
      onContextMenu={(e) => openMenu(e, pullMenu(snapshot, pull, kind))}
    >
      <PullIcon pull={pull} />
      <span className="pull-row-title">{pull.title}</span>
      <span className="pull-row-facts">
        {mine && mine.vote !== 'requested' && <VoteIcon vote={mine.vote} />}
        {pull.comments > 0 && (
          <span className="pull-row-comments">
            <MessageSquare size={11} />
            {pull.comments}
          </span>
        )}
        {pull.checks && <CheckIcon state={pull.checks.state} size={12} />}
        <span className="muted">{pullLabel(kind, pull.number)}</span>
      </span>
    </button>
  )
}

export default function PullSection({
  snapshot,
  status,
  filter
}: {
  snapshot: RepoSnapshot
  status: Exclude<ForgeStatus, { state: 'none' }>
  filter: string
}): React.JSX.Element {
  const loading = useForge((s) => !!s.loading[snapshot.path])
  const { kind, host } = status.repo
  const title = PULL_NOUN[kind].name === 'merge request' ? 'Merge Requests' : 'Pull Requests'
  const query = filter.trim().toLowerCase()
  const refresh = {
    title: `Read the ${PULL_NOUN[kind].name}s again`,
    run: () => void refreshForge(snapshot.path, true),
    busy: loading
  }

  if (status.state !== 'ready') {
    const reconnect = status.state === 'error' && status.auth
    return (
      <Section title={title} icon={<GitPullRequest size={15} />} count={0} onRefresh={refresh}>
        {status.state === 'error' && (
          <div className="tree-item sidebar-warning pull-error" title={status.error}>
            <TriangleAlert size={14} />
            <span>{status.error}</span>
          </div>
        )}
        {(status.state === 'signedOut' || reconnect) && (
          <button
            className="tree-item pull-connect"
            title={`Show the ${PULL_NOUN[kind].name}s of ${host}`}
            onClick={() =>
              void connectForge({ host, kind, path: status.repo.path, device: status.device })
            }
          >
            <LogIn size={14} />
            <span>
              {reconnect ? 'Reconnect' : 'Connect'} to {FORGE_NAMES[kind]}
              {PUBLIC_HOSTS.has(host) ? '' : ` (${host})`}
            </span>
          </button>
        )}
      </Section>
    )
  }

  const groups = groupPulls(status)
  const viewer = status.viewer.login.toLowerCase()
  const shown = (list: PullRequest[]): PullRequest[] => list.filter((p) => matches(p, query, kind))
  const lists: [string, PullRequest[]][] = [
    ['Mine', shown(groups.mine)],
    ['Review requested', shown(groups.review)],
    ['Others', shown(groups.others)]
  ]
  const count = lists.reduce((n, [, list]) => n + list.length, 0)
  return (
    <Section title={title} icon={<GitPullRequest size={15} />} count={count} onRefresh={refresh}>
      {count === 0 && (
        <div className="tree-item muted" style={{ paddingLeft: 12 }}>
          {query ? 'None match the filter' : `No open ${PULL_NOUN[kind].name}s`}
        </div>
      )}
      {lists.map(
        ([name, list]) =>
          list.length > 0 && (
            <div key={name}>
              <div className="tree-item pull-group" style={{ paddingLeft: 12 }}>
                <span>{name}</span>
                <span className="muted">{list.length}</span>
              </div>
              {list.map((pull) => (
                <PullRow
                  key={pull.number}
                  snapshot={snapshot}
                  pull={pull}
                  kind={kind}
                  viewer={viewer}
                />
              ))}
            </div>
          )
      )}
    </Section>
  )
}
