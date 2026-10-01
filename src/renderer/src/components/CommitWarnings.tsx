import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BellOff, X } from 'lucide-react'
import { checkMessage, type CommitWarning } from '../../../shared/commitChecks'
import type { RepoSnapshot } from '../../../shared/types'
import { useApp } from '../store'
import { COMMIT_CHECKS, updateSettings, useSettings } from '../settings'
import { notify } from '../ui'

const RECENT = 20
/** Staging often comes in bursts: the checks wait for it to settle */
const SETTLE_MS = 400

const ORDER = COMMIT_CHECKS.map((c) => c.kind)

const keyOf = (w: CommitWarning): string => `${w.kind}:${w.path ?? ''}:${w.line ?? ''}:${w.text}`

/** Subjects of the latest commits that aren't merges, to tell the style of the repository. */
function recentSubjects(snapshot: RepoSnapshot): string[] {
  const subjects: string[] = []
  for (const c of snapshot.commits) {
    if (subjects.length >= RECENT) break
    if (c.parents.length <= 1) subjects.push(c.subject)
  }
  return subjects
}

/**
 * Warnings about what is going to be committed: secrets, big files, leftover debug code and the
 * message. They never stop the commit; each one can be dismissed, each kind turned off.
 */
export default function CommitWarnings({
  snapshot,
  summary,
  description
}: {
  snapshot: RepoSnapshot
  summary: string
  description: string
}): React.JSX.Element | null {
  const repo = snapshot.path
  const openDiff = useApp((s) => s.openDiff)
  const secrets = useSettings((s) => s.checkSecrets)
  const largeFiles = useSettings((s) => s.checkLargeFiles)
  const debugCode = useSettings((s) => s.checkDebugCode)
  const messageOn = useSettings((s) => s.checkMessage)
  const [staged, setStaged] = useState<{ repo: string; warnings: CommitWarning[] } | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const enabled = { secrets, largeFiles, debugCode, message: messageOn }
  const stagedCount = snapshot.status.staged.length
  const scan = stagedCount > 0 && (secrets || largeFiles || debugCode)

  // Every refresh is a new snapshot: staged content may have changed even with the same files
  useEffect(() => {
    if (!scan) return
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api
        .op(repo, 'commitChecks', { secrets, largeFiles, debugCode })
        .then((result) => {
          if (!cancelled && result.ok) setStaged({ repo, warnings: result.value })
        })
    }, SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [repo, snapshot, scan, secrets, largeFiles, debugCode])

  const subjectsKey = recentSubjects(snapshot).join('\n')
  const messageWarnings = useMemo(
    () => (messageOn ? checkMessage(summary, description, subjectsKey.split('\n')) : []),
    [messageOn, summary, description, subjectsKey]
  )

  const warnings = [...(scan && staged?.repo === repo ? staged.warnings : []), ...messageWarnings]
    .filter((w) => enabled[w.kind] && !dismissed.has(keyOf(w)))
    // Secrets first: they are the hardest to take back once pushed
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  if (!warnings.length) return null

  const turnOff = (w: CommitWarning): void => {
    const check = COMMIT_CHECKS.find((c) => c.kind === w.kind)!
    updateSettings({ [check.key]: false })
    notify('info', `Check turned off: ${check.label}`, 'Turn it on again in Preferences')
  }

  return (
    <div className="commit-warnings" role="status">
      {warnings.map((w) => {
        const check = COMMIT_CHECKS.find((c) => c.kind === w.kind)!
        const where = w.path ? `${w.path}${w.line ? `:${w.line}` : ''}` : null
        return (
          <div key={keyOf(w)} className={`commit-warning ${w.kind}`}>
            <AlertTriangle size={13} className="commit-warning-icon" />
            <span className="commit-warning-text">
              {w.text}
              {where && (
                <button
                  className="commit-warning-file mono"
                  title="Show the staged changes of the file"
                  onClick={() => openDiff({ source: { kind: 'staged' }, path: w.path! })}
                >
                  {where}
                </button>
              )}
            </span>
            <button
              className="commit-warning-tool"
              title="Dismiss this warning"
              onClick={() => setDismissed(new Set(dismissed).add(keyOf(w)))}
            >
              <X size={12} />
            </button>
            <button
              className="commit-warning-tool"
              title={`Turn off this check: ${check.label}`}
              onClick={() => turnOff(w)}
            >
              <BellOff size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
