// The bisect in progress (ADV-06): what git checked out to test, the buttons to say how it went,
// and the first bad commit once found. Shown above the panels, also for a bisect begun elsewhere.
import { Bug, Check, SkipForward, Terminal, X } from 'lucide-react'
import type { Commit, RepoSnapshot } from '../../../shared/types'
import { useApp } from '../store'
import { markBisect, runBisect, stopBisect } from '../actions'

const short = (hash: string): string => hash.slice(0, 7)

export default function BisectBar({
  snapshot,
  busy
}: {
  snapshot: RepoSnapshot
  busy: boolean
}): React.JSX.Element | null {
  const bisect = snapshot.bisect
  if (!bisect) return null
  const repo = snapshot.path
  const commit = (hash: string | null): Commit | undefined =>
    hash ? snapshot.commits.find((c) => c.hash === hash) : undefined
  const show = (hash: string): void => useApp.getState().select(hash, true)
  const original = bisect.original.replace(/^refs\/heads\//, '')
  const stop = (
    <button
      className="btn btn-small"
      disabled={busy}
      title={`End the bisect and go back to ${original}`}
      onClick={() => void stopBisect(repo)}
    >
      <X size={13} /> Stop
    </button>
  )

  let body: React.ReactNode
  if (bisect.culprit) {
    const found = commit(bisect.culprit)
    body = (
      <>
        <span className="bisect-text">
          <strong>Found it:</strong> the problem came in with{' '}
          <button className="bisect-link mono" onClick={() => show(bisect.culprit!)}>
            {short(bisect.culprit)}
          </button>{' '}
          {found && (
            <>
              “{found.subject}”, by {found.authorName}
            </>
          )}
        </span>
        <button className="btn btn-small" onClick={() => show(bisect.culprit!)}>
          Show the commit
        </button>
        <button
          className="btn btn-small btn-primary"
          disabled={busy}
          onClick={() => void stopBisect(repo)}
        >
          Done: back to {original}
        </button>
      </>
    )
  } else if (bisect.onlySkipped) {
    body = (
      <>
        <span className="bisect-text">
          Only skipped commits are left: the problem came in with one of the {bisect.candidates}{' '}
          commits after the last good one.
        </span>
        {stop}
      </>
    )
  } else if (bisect.bad && bisect.good.length && bisect.candidates === 0) {
    body = (
      <>
        <span className="bisect-text">
          <strong>Bisect:</strong> nothing to look through: the commit marked bad is marked good
          too, or comes before a good one. Stop and start again from a commit with the problem.
        </span>
        {stop}
      </>
    )
  } else if (!bisect.bad || !bisect.good.length) {
    const missing = bisect.bad ? 'good' : 'bad'
    body = (
      <>
        <span className="bisect-text">
          {bisect.bad ? (
            <>
              <strong>Bisect:</strong> {short(bisect.bad)} has the problem. Now right-click a commit
              where it wasn&apos;t there yet and choose <em>Bisect: mark as good</em>.
            </>
          ) : (
            <>
              <strong>Bisect:</strong> right-click a commit with the problem and choose{' '}
              <em>Bisect: mark as bad</em>.
            </>
          )}
        </span>
        {snapshot.head.hash && snapshot.head.hash !== bisect.bad && (
          <button
            className="btn btn-small"
            disabled={busy}
            onClick={() => void markBisect(repo, missing)}
          >
            The checked out one is {missing}
          </button>
        )}
        {stop}
      </>
    )
  } else {
    const head = snapshot.head.hash
    const testing = commit(head)
    const steps = Math.max(1, Math.ceil(Math.log2(bisect.candidates)))
    body = (
      <>
        <span className="bisect-text">
          <strong>Bisect:</strong> checked out{' '}
          {head && (
            <button className="bisect-link mono" onClick={() => show(head)}>
              {short(head)}
            </button>
          )}{' '}
          {testing && <>“{testing.subject}”</>} to test. Is the problem there?{' '}
          <span className="muted">
            About {steps} {steps === 1 ? 'step' : 'steps'} left, {bisect.candidates} commits to look
            through.
          </span>
        </span>
        <button
          className="btn btn-small bisect-good"
          disabled={busy}
          title="The problem isn't there"
          onClick={() => void markBisect(repo, 'good')}
        >
          <Check size={13} /> Good
        </button>
        <button
          className="btn btn-small bisect-bad"
          disabled={busy}
          title="The problem is there"
          onClick={() => void markBisect(repo, 'bad')}
        >
          <Bug size={13} /> Bad
        </button>
        <button
          className="btn btn-small"
          disabled={busy}
          title="It can't be tested, e.g. it doesn't build: git picks another one nearby"
          onClick={() => void markBisect(repo, 'skip')}
        >
          <SkipForward size={13} /> Skip
        </button>
        <button
          className="btn btn-small"
          disabled={busy}
          title="Let a command test each commit, such as the tests"
          onClick={() => void runBisect(repo)}
        >
          <Terminal size={13} /> Automate…
        </button>
        {stop}
      </>
    )
  }

  return <div className={`bisect-bar${bisect.culprit ? ' found' : ''}`}>{body}</div>
}
