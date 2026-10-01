import { useEffect, useState } from 'react'
import { FileText, Folder } from 'lucide-react'
import { isNegation, type IgnoreRule } from '../../../shared/ignore'
import { useUi, type IgnoredSession } from '../ui'
import { openInEditor, run, showCleanUp } from '../actions'

/** Typing settles before the path is checked */
const SETTLE_MS = 250

type Verdict = { path: string; rule: IgnoreRule | null; tracked: boolean }

/** Where a rule is written, as a link to open the file when it's inside the repository. */
function RuleSource({ repo, rule }: { repo: string; rule: IgnoreRule }): React.JSX.Element {
  const label = `${rule.source}:${rule.line}`
  // The global excludes file is outside the repository: the editor can't be pointed at it from here
  const inside = !/^(?:[a-z]:|[\\/~])/i.test(rule.source)
  return inside ? (
    <button
      className="ignored-source mono"
      title={`Open ${rule.source}`}
      onClick={(e) => {
        e.stopPropagation()
        void openInEditor(repo, rule.source)
      }}
    >
      {label}
    </button>
  ) : (
    <span className="ignored-source mono" title="The global excludes file (core.excludesFile)">
      {label}
    </span>
  )
}

function Explanation({
  repo,
  verdict,
  onChange
}: {
  repo: string
  verdict: Verdict
  onChange(): void
}): React.JSX.Element {
  const { rule, tracked } = verdict
  if (!rule) {
    return (
      <div className="ignored-verdict">
        <strong>Not ignored</strong>: no rule matches it.
        {tracked ? '' : ' If it doesn’t show among the changes, it may not exist.'}
      </div>
    )
  }
  const pattern = <code className="mono">{rule.pattern}</code>
  if (isNegation(rule)) {
    return (
      <div className="ignored-verdict">
        <strong>Not ignored</strong>: {pattern} in <RuleSource repo={repo} rule={rule} /> brings it
        back after an earlier rule. A ! pattern can&apos;t bring back a file whose folder is
        ignored.
      </div>
    )
  }
  return (
    <div className="ignored-verdict ignored">
      <strong>Ignored</strong> by {pattern} in <RuleSource repo={repo} rule={rule} />.
      {tracked && (
        <div className="ignored-tracked">
          But it is tracked: rules only apply to files not yet in the repository, so its changes
          still show. Stop tracking it to let the rule apply; the file stays on disk.
          <button
            className="btn btn-small"
            onClick={async () => {
              if (await run(repo, 'ignore', rule.pattern, [verdict.path])) onChange()
            }}
          >
            Stop tracking
          </button>
        </div>
      )}
    </div>
  )
}

function Dialog({ session }: { session: IgnoredSession }): React.JSX.Element {
  const { repo } = session
  const close = (): void => useUi.setState({ ignored: null })
  const [query, setQuery] = useState(session.path)
  const [verdict, setVerdict] = useState<(Verdict & { checked: number }) | null>(null)
  // Bumped to check again after a change, such as no longer tracking the file
  const [checks, setChecks] = useState(0)
  const [listed, setListed] = useState<{ rules: IgnoreRule[]; total: number } | null>(null)
  const path = query.trim().replace(/\\/g, '/').replace(/^\.\//, '')

  // On the window: after Stop tracking its button is gone and the focus is no longer in the dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'ignoredFiles').then((result) => {
      if (!cancelled) setListed(result.ok ? result.value : { rules: [], total: 0 })
    })
    return () => {
      cancelled = true
    }
  }, [repo])

  useEffect(() => {
    if (!path) return
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.op(repo, 'ignoreRule', path).then((result) => {
        if (!cancelled && result.ok) setVerdict({ path, checked: checks, ...result.value })
      })
    }, SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [repo, path, checks])

  const needle = path.toLowerCase()
  const shown = (listed?.rules ?? []).filter((r) => r.path.toLowerCase().includes(needle))

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal ignored-files" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Ignored files</div>
        <div className="modal-message">
          Type a path to see which rule decides whether it is ignored, from the .gitignore files,
          .git/info/exclude or your global excludes file.
        </div>
        <input
          className="ignored-query mono"
          placeholder="Path in the repository, e.g. build/output.log"
          value={query}
          autoFocus
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        {path && verdict?.path === path && verdict.checked === checks && (
          <Explanation repo={repo} verdict={verdict} onChange={() => setChecks(checks + 1)} />
        )}
        <div className="ignored-heading">
          {!listed
            ? 'Looking for ignored files…'
            : listed.total === 0
              ? 'Nothing in the working tree is ignored'
              : `${listed.total} ignored ${listed.total === 1 ? 'entry' : 'entries'}${
                  listed.total > listed.rules.length
                    ? `, the first ${listed.rules.length} shown`
                    : ''
                }; an ignored folder is listed once, not its contents`}
        </div>
        {shown.length > 0 && (
          <div className="ignored-list">
            {shown.map((r) => (
              <div
                key={r.path}
                className="ignored-row"
                title="Show why"
                onClick={() => setQuery(r.path)}
              >
                {r.path.endsWith('/') ? <Folder size={13} /> : <FileText size={13} />}
                <span className="ignored-path mono">{r.path}</span>
                <code className="ignored-pattern mono">{r.pattern}</code>
                <RuleSource repo={repo} rule={r} />
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          {listed && listed.total > 0 && (
            <button
              type="button"
              className="btn"
              title="Remove ignored files such as build output, to the Recycle Bin"
              onClick={() => {
                close()
                showCleanUp(repo, 'ignored')
              }}
            >
              Clean up…
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function IgnoredFiles(): React.JSX.Element | null {
  const session = useUi((s) => s.ignored)
  return session ? <Dialog key={session.repo} session={session} /> : null
}
