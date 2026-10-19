// Scenes of the tips about the tools around the graph: the palette, the dashboard, what I did.
import { useShortcutLabel } from '../../shortcuts'
import { Cursor, Lane, Row, Toast } from './primitives'
import { from, until } from './layout'

export function Palette(): React.JSX.Element {
  const keys = useShortcutLabel('palette') || 'Ctrl+P'
  return (
    <>
      <Lane from={0} to={4} />
      {['add login', 'update docs', 'fix typo', 'init', 'first'].map((s, i) => (
        <Row key={i} i={i} subject={s} className="ta-behind" />
      ))}
      <div className="ta-keys">{keys}</div>
      <div className="ta-pal">
        <div className="ta-pal-input">
          <span className="ta-typed">blame</span>
          <span className="ta-caret" />
        </div>
        <div className="ta-pal-item ta-pal-other">Checkout main</div>
        <div className="ta-pal-item ta-pal-hit">Blame src/app.ts</div>
        <div className="ta-pal-item ta-pal-other">Push feature</div>
      </div>
    </>
  )
}

export function Dashboard(): React.JSX.Element {
  const ok = <span className="ta-db-ok">✓ up to date</span>
  return (
    <>
      <div className="ta-panel-title">
        Workspace Dashboard
        <span className="ta-he-gap" />
        <span className="ta-btn ta-db-fetch">Fetch all</span>
      </div>
      <div className="ta-db-row" style={{ top: 36 }}>
        <b>shop</b>
        <span className="ta-db-branch">main</span>
        <span className="ta-db-status">
          <span className="ta-db-shop-ok">{ok}</span>
          <span className="ta-db-behind ta-db-shop-behind">↓ 3 behind</span>
        </span>
        <span className="ta-btn ta-db-pull ta-db-shop-pull">Pull</span>
      </div>
      <div className="ta-db-row" style={{ top: 62 }}>
        <b>blog</b>
        <span className="ta-db-branch">drafts</span>
        <span className="ta-db-status ta-db-changes">2 changes</span>
      </div>
      <div className="ta-db-row" style={{ top: 88 }}>
        <b>api</b>
        <span className="ta-db-branch">main</span>
        <span className="ta-db-status">{ok}</span>
      </div>
      <div className="ta-db-row" style={{ top: 114 }}>
        <b>docs</b>
        <span className="ta-db-branch">main</span>
        <span className="ta-db-status">
          <span className={until(28)}>{ok}</span>
          <span className={`ta-db-behind ${from(30)}`}>↓ 1 behind</span>
        </span>
        <span className={`ta-btn ta-db-pull ${from(30)}`}>Pull</span>
      </div>
      <Cursor
        path={[
          [300, 170],
          [394, 14],
          [404, 47]
        ]}
      />
    </>
  )
}

const WEEK: [string, string, number][] = [
  ['Monday', '', 14],
  ['shop', 'Add the cart', 20],
  ['blog', 'Fix a typo in the about page', 26],
  ['Tuesday', '', 32],
  ['api', 'Speed up the login', 38]
]

export function MyWeek(): React.JSX.Element {
  return (
    <>
      <div className="ta-panel-title">What I did</div>
      <div className="ta-mw-tabs">
        <span className="ta-mw-on">This week</span>
        <span>Last week</span>
        <span>The last 30 days</span>
      </div>
      {WEEK.map(([what, subject, at], i) => (
        <div
          key={i}
          className={`ta-mw-line ${subject ? '' : 'ta-mw-day'} ${from(at)}`}
          style={{ top: 58 + i * 19 }}
        >
          {subject ? (
            <>
              <span className="ta-mw-repo">{what}</span> {subject}
            </>
          ) : (
            what
          )}
        </div>
      ))}
      <span className="ta-btn ta-mw-copy">Copy as Markdown</span>
      <div className={from(64)}>
        <Toast text="Copied as Markdown" />
      </div>
      <Cursor
        path={[
          [250, 170],
          [372, 162],
          [372, 162]
        ]}
      />
    </>
  )
}
