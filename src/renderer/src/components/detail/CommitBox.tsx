import { useEffect, useState } from 'react'
import { History, SlidersHorizontal } from 'lucide-react'
import type { CommitOptions } from '../../../../shared/api'
import type { RepoSnapshot } from '../../../../shared/types'
import { EMPTY_DRAFT, useActiveTab, useApp } from '../../store'
import { notify, openMenu } from '../../ui'
import { displayCombo } from '../../keys'
import { matches } from '../../shortcuts'
import CommitWarnings from '../CommitWarnings'
import { runValue } from '../../actions'

const SUMMARY_LIMIT = 72

/** A commit message template (COMMIT-10): its text, and its comment lines as a hint. */
interface Template {
  summary: string
  description: string
  hint: string
}

function splitTemplate(template: string): Template {
  const lines = template.replace(/\r/g, '').split('\n')
  const comment = (line: string): boolean => line.startsWith('#')
  const hint = lines
    .filter(comment)
    .map((l) => l.replace(/^#\s?/, ''))
    .join('\n')
    .trim()
  const [summary = '', ...rest] = lines
    .filter((l) => !comment(l))
    .join('\n')
    // Keep the spaces ending the summary, e.g. "feat: " to type after
    .replace(/^\s*\n|\n\s*$/g, '')
    .split('\n')
  return { summary, description: rest.join('\n').trim(), hint }
}

// Repositories whose template has filled the message box once: clearing it keeps it clear
const templated = new Set<string>()

/** The commit template of a repository, null while loading or when it has none. */
function useTemplate(repo: string): Template | null {
  const [loaded, setLoaded] = useState<{ repo: string; template: Template | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'commitTemplate').then((result) => {
      if (cancelled) return
      setLoaded({ repo, template: result.ok && result.value ? splitTemplate(result.value) : null })
    })
    return () => {
      cancelled = true
    }
  }, [repo])
  return loaded?.repo === repo ? loaded.template : null
}

const SUGGESTIONS = 12

/** Latest distinct subjects of the identity's commits, to reuse one (COMMIT-10). */
function recentSubjects(snapshot: RepoSnapshot): string[] {
  const email = snapshot.identity.email?.toLowerCase()
  const subjects = new Set<string>()
  for (const c of snapshot.commits) {
    if (subjects.size >= SUGGESTIONS) break
    if (c.parents.length > 1 || (email && c.authorEmail.toLowerCase() !== email)) continue
    subjects.add(c.subject)
  }
  return [...subjects]
}

export function CommitBox({ snapshot }: { snapshot: RepoSnapshot }): React.JSX.Element {
  const tab = useActiveTab()!
  const setDraft = useApp((s) => s.setDraft)
  const repo = snapshot.path
  const { summary, description, amend, noVerify, sign, author } = tab.draft
  const [committing, setCommitting] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const template = useTemplate(repo)
  const staged = snapshot.status.staged.length
  const remaining = SUMMARY_LIMIT - summary.length
  const canCommit = !committing && summary.trim() !== '' && (staged > 0 || amend)
  const signed = sign ?? snapshot.signing.commits
  const identity = snapshot.identity.name
    ? `${snapshot.identity.name} <${snapshot.identity.email ?? ''}>`
    : 'Name <email>'

  // The template starts the first message, as git does when it opens the editor
  useEffect(() => {
    if (!template || templated.has(repo)) return
    templated.add(repo)
    const draft = useApp.getState().tabs.find((t) => t.path === repo)?.draft
    if (draft && !draft.summary && !draft.description && !draft.amend) {
      setDraft(repo, { summary: template.summary, description: template.description })
    }
  }, [repo, template, setDraft])

  const toggleAmend = async (checked: boolean): Promise<void> => {
    setDraft(repo, { amend: checked })
    // Start from the previous message, as `git commit --amend` does
    const untouched =
      (!summary.trim() && !description.trim()) ||
      (template && summary === template.summary && description === template.description)
    if (checked && untouched) {
      const result = await window.api.op(repo, 'lastCommitMessage')
      if (result.ok) {
        const [first, ...rest] = result.value.split('\n')
        setDraft(repo, { summary: first, description: rest.join('\n').trim() })
      }
    }
  }

  const commit = async (): Promise<void> => {
    if (!canCommit) return
    setCommitting(true)
    const message = description.trim()
      ? `${summary.trim()}\n\n${description.trim()}`
      : summary.trim()
    const options: CommitOptions = {
      noVerify: noVerify || undefined,
      sign: sign ?? undefined,
      author: author.trim() || undefined
    }
    const output = await runValue(repo, 'commit', message, amend, options)
    setCommitting(false)
    if (output !== undefined) {
      // Options apply to one commit: the next one starts over, from the template if any
      setDraft(repo, {
        ...EMPTY_DRAFT,
        summary: template?.summary ?? '',
        description: template?.description ?? ''
      })
      notify('success', amend ? 'Commit amended' : 'Committed', output)
    }
  }

  const suggest = (e: React.MouseEvent): void => {
    const subjects = recentSubjects(snapshot)
    openMenu(
      e,
      subjects.length
        ? subjects.map((s) => ({
            label: s.length > 70 ? s.slice(0, 69) + '…' : s,
            onClick: () => setDraft(repo, { summary: s })
          }))
        : [{ label: 'No commits of yours yet', disabled: true, onClick: () => undefined }]
    )
  }

  const chips = [
    ...(noVerify ? ['Hooks skipped'] : []),
    ...(signed ? ['Signed'] : []),
    ...(author.trim() ? [`Author: ${author.trim()}`] : [])
  ]
  const overrides = Number(noVerify) + Number(sign !== null) + Number(!!author.trim())

  const label = committing
    ? 'Committing…'
    : amend
      ? 'Amend previous commit'
      : staged > 0
        ? `Commit changes to ${staged} file${staged === 1 ? '' : 's'}`
        : 'Stage changes to commit'

  return (
    <div
      className="commit-box"
      onKeyDown={(e) => {
        if (matches(e, 'commit')) {
          e.preventDefault()
          void commit()
        }
      }}
    >
      <div className="commit-box-row">
        <label className="modal-check">
          <input
            type="checkbox"
            checked={amend}
            disabled={!snapshot.head.hash}
            onChange={(e) => void toggleAmend(e.target.checked)}
          />
          Amend previous commit
        </label>
        <span className="toolbar-spacer" />
        <button className="commit-box-tool" title="Reuse a recent message" onClick={suggest}>
          <History size={14} />
        </button>
        <button
          className={`commit-box-tool${showOptions ? ' on' : ''}`}
          title="Commit options: hooks, signature, author"
          onClick={() => setShowOptions(!showOptions)}
        >
          <SlidersHorizontal size={14} />
          {overrides > 0 && <span className="commit-box-count">{overrides}</span>}
        </button>
        <span className={`summary-counter${remaining < 0 ? ' over' : ''}`}>{remaining}</span>
      </div>
      {showOptions ? (
        <div className="commit-options">
          <label className="modal-check">
            <input
              type="checkbox"
              checked={noVerify}
              onChange={(e) => setDraft(repo, { noVerify: e.target.checked })}
            />
            Skip hooks (--no-verify)
          </label>
          <label className="modal-check">
            <input
              type="checkbox"
              checked={signed}
              onChange={(e) =>
                setDraft(repo, {
                  sign: e.target.checked === snapshot.signing.commits ? null : e.target.checked
                })
              }
            />
            Sign the commit
            {snapshot.signing.commits && <span className="muted"> (on by default)</span>}
          </label>
          <input
            placeholder={`Author: ${identity}`}
            title="Commit on behalf of someone else, as Name <email>: you stay the committer"
            value={author}
            onChange={(e) => setDraft(repo, { author: e.target.value })}
          />
        </div>
      ) : (
        chips.length > 0 && (
          <div className="commit-chips">
            {chips.map((c) => (
              <span key={c} className="commit-chip">
                {c}
              </span>
            ))}
          </div>
        )
      )}
      <input
        placeholder="Commit summary"
        value={summary}
        onChange={(e) => setDraft(repo, { summary: e.target.value })}
      />
      <textarea
        placeholder={template?.hint || 'Description'}
        rows={4}
        value={description}
        onChange={(e) => setDraft(repo, { description: e.target.value })}
      />
      <CommitWarnings snapshot={snapshot} summary={summary} description={description} />
      <button
        className="primary"
        disabled={!canCommit}
        onClick={() => void commit()}
        title={displayCombo('Ctrl+Enter')}
      >
        {label}
      </button>
    </div>
  )
}
