import { useEffect, useState } from 'react'
import { Copy, Pencil, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import type { Result } from '../../../../shared/api'
import type { CommitDetail, RepoSnapshot, Signature } from '../../../../shared/types'
import { useActiveTab, useApp } from '../../store'
import { displayCombo } from '../../keys'
import { matches } from '../../shortcuts'
import { hoverCard } from '../../hover'
import { relativeTime } from '../../time'
import { AuthorCard } from '../HoverCards'
import { reword } from '../../actions'
import { useFileView } from './fileListing'
import { ViewToggle } from './ViewToggle'
import { FileList } from './FileList'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** The repository snapshot once HEAD has moved from `head`: null after a few seconds. */
function snapshotAfter(repo: string, head: string | null): Promise<RepoSnapshot | null> {
  const current = (): RepoSnapshot | undefined => {
    const snapshot = useApp.getState().tabs.find((t) => t.path === repo)?.snapshot
    return snapshot && snapshot.head.hash !== head ? snapshot : undefined
  }
  return new Promise((resolve) => {
    if (current()) return resolve(current()!)
    const done = (snapshot: RepoSnapshot | null): void => {
      clearTimeout(timer)
      unsubscribe()
      resolve(snapshot)
    }
    const timer = setTimeout(() => done(null), 5000)
    const unsubscribe = useApp.subscribe(() => {
      const snapshot = current()
      if (snapshot) done(snapshot)
    })
    void useApp.getState().refreshPath(repo)
  })
}

const SIGNATURES: Record<
  Signature['status'],
  { label: string; tone: 'good' | 'warn' | 'bad'; hint: string }
> = {
  good: { label: 'Verified', tone: 'good', hint: 'Signed with a trusted key' },
  untrusted: {
    label: 'Signed, key not trusted',
    tone: 'warn',
    hint: 'The signature is valid, but the key is not trusted: for SSH keys, list it in gpg.ssh.allowedSignersFile'
  },
  bad: { label: 'Bad signature', tone: 'bad', hint: 'The commit was changed after it was signed' },
  expired: { label: 'Expired signature', tone: 'warn', hint: 'The signature or its key expired' },
  revoked: { label: 'Revoked key', tone: 'bad', hint: 'The key that signed was revoked' },
  unknown: {
    label: 'Signed, cannot verify',
    tone: 'warn',
    hint: 'The public key is missing, or the signing program is not available'
  }
}

/** Verification of the commit signature (DETAIL-05). */
function SignatureBadge({ signature }: { signature: Signature }): React.JSX.Element {
  const { label, tone, hint } = SIGNATURES[signature.status]
  const Icon = tone === 'good' ? ShieldCheck : tone === 'bad' ? ShieldX : ShieldAlert
  return (
    <span
      className={`signature-badge signature-${tone}`}
      title={`${hint}${signature.key ? `\nKey: ${signature.key}` : ''}`}
    >
      <Icon size={13} /> {label}
      {signature.signer && <span className="muted"> · {signature.signer}</span>}
    </span>
  )
}

export function CommitPanel({
  repoPath,
  hash
}: {
  repoPath: string
  hash: string
}): React.JSX.Element {
  const select = useApp((s) => s.select)
  const snapshot = useActiveTab()?.snapshot
  // Keyed by the requested hash so a stale response is never shown for a new selection
  const [loaded, setLoaded] = useState<{
    hash: string
    result: Result<CommitDetail>
    onBranch: boolean
  } | null>(null)
  // The message being edited (DETAIL-04), null when not editing
  const [editing, setEditing] = useState<{ hash: string; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const head = snapshot?.head.hash
  const [view, changeView] = useFileView()

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.api.op(repoPath, 'commitDetail', hash),
      head ? window.api.op(repoPath, 'isAncestor', hash, head) : null
    ]).then(([result, ancestor]) => {
      if (!cancelled) setLoaded({ hash, result, onBranch: !!ancestor?.ok && ancestor.value })
    })
    return () => {
      cancelled = true
    }
  }, [repoPath, hash, head])

  if (!loaded || loaded.hash !== hash) return <div className="center-message">Loading…</div>
  if (!loaded.result.ok)
    return <div className="detail-scroll banner-error">{loaded.result.error}</div>
  const detail = loaded.result.value
  const message = detail.body ? `${detail.subject}\n\n${detail.body}` : detail.subject
  const canReword =
    loaded.onBranch && !!snapshot?.head.branch && !snapshot.operation && !!snapshot.head.hash
  const draft = editing?.hash === hash ? editing.message : null

  const save = async (): Promise<void> => {
    if (!snapshot || draft === null || !draft.trim()) return
    if (draft.trim() === message.trim()) {
      setEditing(null)
      return
    }
    // The reworded commit gets a new hash, as many first parents below HEAD as the old one
    let depth = 0
    const byHash = new Map(snapshot.commits.map((c) => [c.hash, c]))
    for (let c = byHash.get(snapshot.head.hash!); c && c.hash !== hash; depth++) {
      c = byHash.get(c.parents[0])
    }
    setSaving(true)
    const ok = await reword(repoPath, snapshot, hash, draft.trim())
    setSaving(false)
    if (!ok) return
    setEditing(null)
    const updated = await snapshotAfter(repoPath, snapshot.head.hash)
    const after = new Map(updated?.commits.map((c) => [c.hash, c]))
    let moved = after.get(updated?.head.hash ?? '')
    for (let i = 0; i < depth && moved; i++) moved = after.get(moved.parents[0])
    if (moved) select(moved.hash, true)
  }

  return (
    <div className="detail-scroll">
      {draft !== null ? (
        <div
          className="reword-box"
          onKeyDown={(e) => {
            if (matches(e, 'commit')) {
              e.preventDefault()
              void save()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(null)
            }
          }}
        >
          <textarea
            autoFocus
            rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
            value={draft}
            onChange={(e) => setEditing({ hash, message: e.target.value })}
          />
          <div className="reword-actions">
            <span className="muted">
              {hash === snapshot?.head.hash
                ? 'Amends the last commit: staged changes are left out'
                : 'Rewrites this commit and the ones after it'}
            </span>
            <span className="toolbar-spacer" />
            <button className="btn btn-small" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              className="btn btn-small btn-primary"
              disabled={saving || !draft.trim()}
              title={displayCombo('Ctrl+Enter')}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save message'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="detail-title-row">
            <div className="detail-title">{detail.subject}</div>
            {canReword && (
              <button
                className="commit-box-tool"
                title="Edit the commit message"
                onClick={() => setEditing({ hash, message })}
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
          {detail.body && <div className="detail-body">{detail.body}</div>}
        </>
      )}
      <dl className="detail-meta">
        <dt>commit</dt>
        <dd className="mono">
          {detail.hash.slice(0, 10)}{' '}
          <Copy
            size={12}
            className="link"
            onClick={() => navigator.clipboard.writeText(detail.hash)}
            aria-label="Copy commit hash"
          />
        </dd>
        <dt>parents</dt>
        <dd className="mono">
          {detail.parents.map((p) => (
            <span
              key={p}
              className="link"
              onClick={() => select(p, true)}
              style={{ marginRight: 8 }}
            >
              {p.slice(0, 7)}
            </span>
          ))}
        </dd>
        <dt>author</dt>
        <dd>
          <span
            {...(snapshot &&
              hoverCard(() => (
                <AuthorCard
                  snapshot={snapshot}
                  name={detail.authorName}
                  email={detail.authorEmail}
                />
              )))}
          >
            {detail.authorName} &lt;{detail.authorEmail}&gt;
          </span>
        </dd>
        <dt>authored</dt>
        <dd title={relativeTime(detail.authorDate)}>
          {dateFormat.format(detail.authorDate * 1000)}
        </dd>
        {(detail.committerName !== detail.authorName ||
          detail.committerDate !== detail.authorDate) && (
          <>
            <dt>committer</dt>
            <dd>
              {detail.committerName}, {dateFormat.format(detail.committerDate * 1000)}
            </dd>
          </>
        )}
        {detail.signature && (
          <>
            <dt>signature</dt>
            <dd>
              <SignatureBadge signature={detail.signature} />
            </dd>
          </>
        )}
      </dl>
      <div>
        <div className="file-group-title file-group-header">
          <span>Changed Files ({detail.files.length})</span>
          {detail.parents.length > 1 && <span className="muted">vs first parent</span>}
          <span className="toolbar-spacer" />
          <ViewToggle view={view} onChange={changeView} />
        </div>
        <FileList
          files={detail.files}
          kind="commit"
          view={view}
          repo={repoPath}
          hash={detail.hash}
        />
      </div>
    </div>
  )
}
