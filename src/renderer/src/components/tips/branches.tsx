// Scenes of the tips about branches: one branch alone, conflicts with main, worktrees, overview.
import { Cursor, Label, Lane, Menu, Row, Toast } from './primitives'
import { from, until } from './layout'

const SOLO: [lane: number, subject: string][] = [
  [0, 'a: add the form'],
  [1, 'b: try an idea'],
  [0, 'a: validate it'],
  [2, 'fix a typo'],
  [1, 'b: spike'],
  [0, 'init']
]
const LANE_COLORS = ['var(--accent)', 'var(--purple)', 'var(--orange)']
const soloTop = (i: number): number => 14 + i * 26

export function SoloBranch(): React.JSX.Element {
  const lane = (n: number, a: number, b: number): React.JSX.Element => (
    <div
      className={`ta-lane ${n ? until(48) : ''}`}
      style={{
        left: 110 + n * 18,
        top: soloTop(a) + 11,
        height: (b - a) * 26,
        background: LANE_COLORS[n]
      }}
    />
  )
  return (
    <>
      {lane(0, 0, 5)}
      {lane(1, 1, 4)}
      {lane(2, 3, 5)}
      <span className="ta-label" style={{ top: soloTop(0) + 3 }}>
        feature/a
      </span>
      <span className={`ta-label ${until(48)}`} style={{ top: soloTop(1) + 3 }}>
        feature/b
      </span>
      <span className={`ta-label ${until(48)}`} style={{ top: soloTop(3) + 3 }}>
        main
      </span>
      {SOLO.map(([n, subject], i) => (
        <div key={i} className={`ta-row ${n ? until(48) : ''}`} style={{ top: soloTop(i) }}>
          <span className="ta-dot" style={{ marginLeft: n * 18, background: LANE_COLORS[n] }} />
          <span className="ta-subject">{subject}</span>
        </div>
      ))}
      <Menu
        className="ta-menu-open ta-menu-solo"
        items={['Show only this branch', 'Hide in graph']}
      />
      <div className={`ta-banner ${from(52)}`}>Only feature/a · Show all branches</div>
      <Cursor
        path={[
          [390, 170],
          [40, 22],
          [90, 48]
        ]}
      />
    </>
  )
}

export function ConflictWatch(): React.JSX.Element {
  return (
    <>
      <div className="ta-toolbar">
        <span className="ta-cw-branch">feature</span>
        <span className={`ta-cw-badge ${from(14)}`}>⚠ 2 conflicts with main</span>
        <span className="ta-btn">Pull</span>
        <span className="ta-btn">Push</span>
      </div>
      <Lane from={1} to={4} />
      <Label i={1} name="feature" />
      <Label i={3} name="main" />
      {['cart: new totals', 'pay: refactor', 'main: cart rewrite', 'init'].map((s, i) => (
        <Row key={i} i={i + 1} subject={s} />
      ))}
      <div className="ta-cw-menu">
        <div className="ta-cw-file">src/cart.ts</div>
        <div className="ta-cw-file">src/pay.ts</div>
        <div className="ta-cw-sep" />
        <div className="ta-cw-hit">Merge main into feature…</div>
        <div>Rebase feature onto main…</div>
      </div>
      <Cursor
        path={[
          [390, 170],
          [318, 16],
          [300, 88]
        ]}
      />
    </>
  )
}

export function Worktrees(): React.JSX.Element {
  return (
    <>
      <div className="ta-wt-tabs">
        <span className="ta-wt-tab ta-wt-old">shop</span>
        <span className={`ta-wt-tab ta-wt-new ${from(50)}`}>shop · feature/cart</span>
      </div>
      <div className="ta-wt-side">
        <div className="ta-dim">LOCAL</div>
        <div>✓ main</div>
        <div>feature/cart</div>
        <div className={`ta-dim ${from(52)}`}>WORKTREES</div>
        <div className={from(54)}>shop-cart</div>
      </div>
      <div className={`ta-wt-card ${until(48)}`}>
        <b>main</b> · 2 files changed, not committed
        <div className="ta-wt-files">M cart.ts · M pay.ts</div>
      </div>
      <div className={`ta-wt-card ${from(52)}`}>
        <b>feature/cart</b> · in ../shop-cart
        <div className="ta-wt-files">main keeps its 2 changed files</div>
      </div>
      <Menu
        className="ta-menu-open ta-menu-wt"
        items={['Check out in a new worktree…', 'Checkout feature/cart']}
      />
      <Cursor
        path={[
          [390, 170],
          [50, 82],
          [100, 106]
        ]}
      />
    </>
  )
}

const OLD_BRANCHES = [
  ['fix/typo', '8 months', 'merged'],
  ['feature/old-ui', '1 year', 'merged'],
  ['feature/cart', '2 days', '3 ahead'],
  ['spike/test', '5 months', 'merged']
]

export function BranchOverview(): React.JSX.Element {
  return (
    <>
      <div className="ta-panel-title">Branches</div>
      {OLD_BRANCHES.map(([name, age, status], i) => {
        const merged = status === 'merged'
        return (
          <div
            key={name}
            className={`ta-bo-row ${merged ? 'ta-bo-gone' : 'ta-bo-stays'}`}
            style={{ top: 34 + i * 24 }}
          >
            <span className="ta-bo-check">{merged && <i className={from(28)}>✓</i>}</span>
            <span className="ta-bo-name">{name}</span>
            <span className="ta-bo-age">{age}</span>
            <span className={merged ? 'ta-bo-merged' : 'ta-bo-ahead'}>{status}</span>
          </div>
        )
      })}
      <span className="ta-btn ta-bo-choose">Choose merged</span>
      <span className="ta-btn ta-bo-delete">Delete 3 branches</span>
      <div className={from(56)}>
        <Toast text="Deleted 3 branches" />
      </div>
      <Cursor
        path={[
          [390, 120],
          [56, 160],
          [372, 160]
        ]}
      />
    </>
  )
}
