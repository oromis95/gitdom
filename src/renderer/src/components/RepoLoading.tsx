// Shown while a repository is read for the first time: big histories take a few seconds, and an
// empty window would look stuck.
import { HighwayLogo } from './Splash'

/** Widths of the placeholder commit rows, as a share of the graph */
const ROWS = [0.82, 0.64, 0.74, 0.5, 0.68]

export default function RepoLoading({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="repo-loading" role="status">
      <HighwayLogo size={200} animated loop />
      <div className="repo-loading-title">Opening {name}…</div>
      <div className="repo-loading-rows" aria-hidden>
        {ROWS.map((width, i) => (
          <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 90}ms` }}>
            <span className="skeleton-dot" />
            <span className="skeleton-bar" style={{ width: `${width * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}
