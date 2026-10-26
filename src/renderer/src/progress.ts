// Words and thresholds for the progress git reports of long operations (push).
import type { OpProgress } from '../../shared/api'

/** Past this, a push has sent everything: the remote is checking and storing it */
export const SENT = 90

/** The status bar's words for an operation and its progress, e.g. "Pushing… Writing objects 45%". */
export function busyText(busy: string, progress?: OpProgress): string {
  if (!progress) return `${busy}…`
  if (progress.percent !== null && progress.percent >= SENT && busy === 'Pushing')
    return `${busy}… waiting for the remote`
  const percent = progress.percent === null ? '' : ` ${progress.percent}%`
  const transfer = progress.transfer ? ` · ${progress.transfer}` : ''
  return `${busy}… ${progress.phase}${percent}${transfer}`
}
