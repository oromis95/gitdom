// Picking reviewers: what's typed is searched among the people of the repository on the service,
// and those chosen show as chips.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Candidate } from '../../../../shared/forge'
import { Avatar } from './PullBits'
import { who } from './pullText'

export default function ReviewerPicker({
  repo,
  chosen,
  onChange,
  exclude = []
}: {
  repo: string
  chosen: Candidate[]
  onChange(chosen: Candidate[]): void
  /** Logins not to offer: the author, those already asked */
  exclude?: string[]
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; people: Candidate[]; error?: string } | null>(
    null
  )
  const [open, setOpen] = useState(false)

  // Asked a moment after the last key, not at every one
  useEffect(() => {
    if (!open) return
    let alive = true
    const timer = setTimeout(() => {
      void window.api.forge.candidates(repo, query).then((result) => {
        if (!alive) return
        setFound(
          result.ok ? { query, people: result.value } : { query, people: [], error: result.error }
        )
      })
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [repo, query, open])

  const taken = new Set(
    [...exclude, ...chosen.map((c) => c.user.login)].map((l) => l.toLowerCase())
  )
  const offered = (found?.people ?? []).filter((c) => !taken.has(c.user.login.toLowerCase()))

  return (
    <div className="reviewer-picker">
      <div className="reviewer-chips">
        {chosen.map((c) => (
          <span key={c.id} className="reviewer-chip">
            <Avatar user={c.user} size={16} />
            {who(c.user)}
            <button
              type="button"
              aria-label={`Remove ${who(c.user)}`}
              onClick={() => onChange(chosen.filter((x) => x.id !== c.id))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={query}
          placeholder={chosen.length ? '' : 'Search people'}
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && offered[0]) {
              e.preventDefault()
              onChange([...chosen, offered[0]])
              setQuery('')
              setOpen(false)
            } else if (e.key === 'Backspace' && !query && chosen.length) {
              onChange(chosen.slice(0, -1))
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
      </div>
      {open && (
        <div className="reviewer-results">
          {!found ? (
            <div className="muted">Searching…</div>
          ) : found.error ? (
            <div className="muted">{found.error}</div>
          ) : offered.length === 0 ? (
            <div className="muted">{query ? 'Nobody matches' : 'Type a name'}</div>
          ) : (
            offered.map((c) => (
              <button
                type="button"
                key={c.id}
                className="reviewer-result"
                // Before the input's blur closes the list
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange([...chosen, c])
                  setQuery('')
                  setOpen(false)
                }}
              >
                <Avatar user={c.user} size={18} />
                <span>{c.user.name ?? c.user.login}</span>
                {c.user.name && <span className="muted">{c.user.login}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
