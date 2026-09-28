// The contents of the hover cards (UI-13) and the layer that places them beside the hovered element.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Archive, Check, Cloud, GitBranch, GitMerge, Tag } from 'lucide-react'
import type { Result } from '../../../shared/api'
import type {
  Commit,
  CommitPreview,
  Ref,
  RepoSnapshot,
  Stash,
  TagInfo
} from '../../../shared/types'
import { avatarUrl } from '../graph/avatars'
import { avatarColor, initials } from '../graph/colors'
import { hideHover, useHover } from '../hover'
import { useSettings } from '../settings'
import { describeDate } from '../time'

const MARGIN = 8
const GAP = 6

export function HoverLayer(): React.JSX.Element | null {
  const card = useHover((s) => s.card)
  const ref = useRef<HTMLDivElement>(null)

  // Below the element, or above when there is no room; always inside the window
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !card) return
    const place = (): void => {
      const { width, height } = el.getBoundingClientRect()
      const { anchor } = card
      let top = anchor.bottom + GAP
      if (top + height > window.innerHeight - MARGIN)
        top = Math.max(MARGIN, anchor.top - GAP - height)
      const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN))
      el.style.top = `${top}px`
      el.style.left = `${left}px`
      el.style.visibility = 'visible'
    }
    place()
    // Files and tag messages arrive later and make the card taller
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [card])

  useEffect(() => {
    const events = ['mousedown', 'wheel', 'keydown', 'blur', 'resize'] as const
    events.forEach((e) => window.addEventListener(e, hideHover, true))
    return () => events.forEach((e) => window.removeEventListener(e, hideHover, true))
  }, [])

  if (!card) return null
  return (
    <div key={card.id} ref={ref} className="hover-card" style={{ visibility: 'hidden' }}>
      {card.render()}
    </div>
  )
}

function Avatar({
  name,
  email,
  size
}: {
  name: string
  email: string
  size: number
}): React.JSX.Element {
  const pictures = useSettings((s) => s.graphAvatars)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!pictures) return
    let cancelled = false
    void avatarUrl(email).then((u) => !cancelled && setUrl(u))
    return () => {
      cancelled = true
    }
  }, [email, pictures])
  const style = { width: size, height: size, background: avatarColor(email) }
  return url && !failed ? (
    <img className="hover-avatar" style={style} src={url} alt="" onError={() => setFailed(true)} />
  ) : (
    <span className="hover-avatar" style={{ ...style, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  )
}

// Commits never change: their previews are asked for once
const previews = new Map<string, Promise<Result<CommitPreview>>>()
const PREVIEW_CACHE = 300

function usePreview(repo: string, hash: string): CommitPreview | 'error' | null {
  const [preview, setPreview] = useState<CommitPreview | 'error' | null>(null)
  useEffect(() => {
    const key = `${repo}\0${hash}`
    let promise = previews.get(key)
    if (!promise) {
      if (previews.size >= PREVIEW_CACHE) previews.clear()
      promise = window.api.op(repo, 'commitPreview', hash)
      previews.set(key, promise)
    }
    let cancelled = false
    void promise.then((result) => {
      if (!result.ok) previews.delete(key)
      if (!cancelled) setPreview(result.ok ? result.value : 'error')
    })
    return () => {
      cancelled = true
    }
  }, [repo, hash])
  return preview
}

const MAX_FILES = 8

function FilesPreview({
  preview
}: {
  preview: CommitPreview | 'error' | null
}): React.JSX.Element | null {
  if (preview === 'error') return null
  if (!preview) return <div className="hover-files muted">Loading changes…</div>
  const { files } = preview
  if (!files.length) return <div className="hover-files muted">No file changes</div>
  const sum = (key: 'additions' | 'deletions'): number =>
    files.reduce((total, f) => total + (f[key] ?? 0), 0)
  return (
    <div className="hover-files">
      {files.slice(0, MAX_FILES).map((f) => (
        <div key={f.path} className="hover-file">
          <span className={`hover-file-status status-${f.status}`}>{f.status}</span>
          <span className="hover-file-path">
            <bdi>{f.path}</bdi>
          </span>
          {f.additions === null ? (
            <span className="muted">binary</span>
          ) : (
            <span className="hover-counts">
              {f.additions > 0 && <span className="hover-add">+{f.additions}</span>}
              {f.deletions! > 0 && <span className="hover-del">−{f.deletions}</span>}
            </span>
          )}
        </div>
      ))}
      <div className="hover-stats">
        {files.length > MAX_FILES && <span>and {files.length - MAX_FILES} more · </span>}
        {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
        <span className="hover-add">+{sum('additions')}</span>{' '}
        <span className="hover-del">−{sum('deletions')}</span>
      </div>
    </div>
  )
}

const REF_ICONS = { local: GitBranch, remote: Cloud, tag: Tag }

function RefChips({ refs }: { refs: Ref[] }): React.JSX.Element | null {
  if (!refs.length) return null
  return (
    <div className="hover-refs">
      {refs.map((r) => {
        const Icon = REF_ICONS[r.type]
        return (
          <span key={r.fullName} className={`hover-ref hover-ref-${r.type}`}>
            <Icon size={11} /> {r.name}
          </span>
        )
      })}
    </div>
  )
}

export function AuthorCard({
  snapshot,
  name,
  email
}: {
  snapshot: RepoSnapshot
  name: string
  email: string
}): React.JSX.Element {
  const key = email.toLowerCase()
  const commits = snapshot.commits.filter((c) => c.authorEmail.toLowerCase() === key)
  const dates = commits.map((c) => c.authorDate)
  const names = [...new Set(commits.map((c) => c.authorName))].filter((n) => n !== name)
  const you = !!snapshot.identity.email && snapshot.identity.email.toLowerCase() === key
  return (
    <>
      <div className="hover-head">
        <Avatar name={name} email={email} size={40} />
        <div className="hover-who">
          <div className="hover-name">
            {name}
            {you && <span className="hover-badge">you</span>}
          </div>
          <div className="muted hover-email">{email}</div>
        </div>
      </div>
      <div className="hover-facts">
        <div>
          <strong>{commits.length}</strong> commit{commits.length === 1 ? '' : 's'}{' '}
          {snapshot.truncated ? 'among the loaded ones' : 'in this repository'}
        </div>
        {dates.length > 0 && (
          <>
            <div>
              <span className="muted">Latest </span>
              {describeDate(Math.max(...dates))}
            </div>
            <div>
              <span className="muted">First </span>
              {describeDate(Math.min(...dates))}
            </div>
          </>
        )}
        {names.length > 0 && (
          <div>
            <span className="muted">Also as </span>
            {names.join(', ')}
          </div>
        )}
      </div>
    </>
  )
}

export function CommitCard({
  snapshot,
  commit
}: {
  snapshot: RepoSnapshot
  commit: Commit
}): React.JSX.Element {
  const preview = usePreview(snapshot.path, commit.hash)
  const body = preview && preview !== 'error' ? preview.body : ''
  return (
    <>
      <div className="hover-head">
        <Avatar name={commit.authorName} email={commit.authorEmail} size={28} />
        <div className="hover-who">
          <div className="hover-name">{commit.authorName}</div>
          <div className="muted">{describeDate(commit.authorDate)}</div>
        </div>
        <span className="mono muted hover-hash">{commit.hash.slice(0, 7)}</span>
      </div>
      <RefChips refs={snapshot.refs.filter((r) => r.hash === commit.hash)} />
      <div className="hover-subject">{commit.subject}</div>
      {body && <div className="hover-body">{body}</div>}
      {commit.parents.length > 1 && (
        <div className="hover-note">
          <GitMerge size={12} /> Merge commit: changes against its first parent
        </div>
      )}
      <FilesPreview preview={preview} />
    </>
  )
}

export function StashCard({
  snapshot,
  stash
}: {
  snapshot: RepoSnapshot
  stash: Stash
}): React.JSX.Element {
  const preview = usePreview(snapshot.path, stash.hash)
  const base = snapshot.commits.find((c) => c.hash === stash.base)
  return (
    <>
      <div className="hover-title">
        <Archive size={14} /> <span className="mono">{stash.selector}</span>
        <span className="muted hover-when">{describeDate(stash.date)}</span>
      </div>
      <div className="hover-subject">{stash.message}</div>
      <div className="hover-note">
        Made on <span className="mono">{stash.base.slice(0, 7)}</span>
        {base && ` ${base.subject}`}
      </div>
      <FilesPreview preview={preview} />
    </>
  )
}

const tags = new Map<string, Promise<Result<TagInfo | null>>>()

function useTagInfo(repo: string, name: string | null): TagInfo | null | undefined {
  const [info, setInfo] = useState<TagInfo | null | undefined>(undefined)
  useEffect(() => {
    if (!name) return
    // Tags can be recreated: cached only while the card is up
    const key = `${repo}\0${name}`
    const promise = tags.get(key) ?? window.api.op(repo, 'tagInfo', name)
    tags.set(key, promise)
    let cancelled = false
    void promise.then((result) => {
      tags.delete(key)
      if (!cancelled) setInfo(result.ok ? result.value : null)
    })
    return () => {
      cancelled = true
    }
  }, [repo, name])
  return info
}

const REF_KINDS = { local: 'Local branch', remote: 'Remote branch', tag: 'Tag' }

export function RefCard({
  snapshot,
  refInfo,
  hint
}: {
  snapshot: RepoSnapshot
  refInfo: Ref
  /** What the element does besides, e.g. "Double-click to check out" */
  hint?: string
}): React.JSX.Element {
  const tip = snapshot.commits.find((c) => c.hash === refInfo.hash)
  const tag = useTagInfo(snapshot.path, refInfo.type === 'tag' ? refInfo.name : null)
  const current = refInfo.type === 'local' && refInfo.name === snapshot.head.branch
  const Icon = REF_ICONS[refInfo.type]
  const { ahead = 0, behind = 0 } = refInfo

  return (
    <>
      <div className="hover-title">
        <Icon size={14} /> <span className="hover-name">{refInfo.name}</span>
        {current && (
          <span className="hover-badge">
            <Check size={11} /> checked out
          </span>
        )}
      </div>
      <div className="muted">{REF_KINDS[refInfo.type]}</div>
      {refInfo.type === 'local' && (
        <div className="hover-facts">
          {refInfo.upstream ? (
            <div>
              <span className="muted">Tracks </span>
              {refInfo.upstream}
              {' · '}
              {ahead || behind ? (
                <>
                  {ahead > 0 && <span className="hover-add">{ahead} to push</span>}
                  {ahead > 0 && behind > 0 && ', '}
                  {behind > 0 && <span className="hover-del">{behind} to pull</span>}
                </>
              ) : (
                'up to date'
              )}
            </div>
          ) : (
            <div className="muted">Not published: no upstream branch</div>
          )}
        </div>
      )}
      {tag && (
        <div className="hover-tag">
          <div className="hover-subject">{tag.subject}</div>
          {tag.body && <div className="hover-body">{tag.body}</div>}
          <div className="muted">
            {tag.tagger} · {describeDate(tag.date)}
          </div>
        </div>
      )}
      {tag === null && <div className="hover-note">Lightweight tag: no message</div>}
      <div className="hover-tip">
        {tip ? (
          <>
            <div className="hover-subject">{tip.subject}</div>
            <div className="muted">
              <span className="mono">{tip.hash.slice(0, 7)}</span> · {tip.authorName} ·{' '}
              {describeDate(tip.authorDate)}
            </div>
          </>
        ) : (
          <div className="muted">
            <span className="mono">{refInfo.hash.slice(0, 7)}</span>, not among the loaded commits
          </div>
        )}
      </div>
      {hint && <div className="hover-hint">{hint}</div>}
    </>
  )
}
