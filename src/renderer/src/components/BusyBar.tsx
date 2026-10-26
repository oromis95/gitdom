// The operation a repository is busy with, as a thin bar under the toolbar: it fills as git reports
// progress (push), and sweeps while there is nothing to report (connecting, fetch, merge…).
import type { OpProgress } from '../../../shared/api'
import { SENT, busyText } from '../progress'

export default function BusyBar({
  busy,
  progress
}: {
  busy: string
  progress?: OpProgress
}): React.JSX.Element {
  const percent = progress?.percent ?? null
  return (
    <div className="busy-bar" role="progressbar" aria-label={busyText(busy, progress)}>
      {percent === null ? (
        <div className="busy-bar-sweep" />
      ) : (
        <div
          className={`busy-bar-fill${percent >= SENT ? ' settling' : ''}`}
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  )
}
