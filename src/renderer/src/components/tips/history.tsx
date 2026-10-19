// Scenes of the tips about the history: lines, blame, code search, files, statistics, bisect.
import { Cursor, Label, Lane, Menu, Row, Swap } from './primitives'
import { from, top } from './layout'

const CODE = [
  'function total(items) {',
  '  let sum = 0',
  '  for (const i of items)',
  '    sum += i.price * i.qty',
  '  return round(sum)',
  '}'
]

export function LineHistory(): React.JSX.Element {
  return (
    <>
      <div className="ta-panel-title">Blame src/cart.ts</div>
      <div className="ta-pick-bar">
        <span className="ta-pick-hint">Click a line number, Shift+click another</span>
        <span className="ta-picked">
          <Swap a="Line 3 selected" b="Lines 3–5 selected" />
          <span className="ta-btn ta-lines-btn">History of these lines</span>
        </span>
      </div>
      {CODE.map((line, i) => (
        <div
          key={i}
          className={`ta-code ${i >= 2 && i <= 4 ? `ta-pick ta-pick-${i === 2 ? 'a' : 'b'}` : ''}`}
          style={{ top: 54 + i * 20 }}
        >
          <span className="ta-num">{i + 1}</span>
          {line}
        </div>
      ))}
      <div className="ta-result">
        <div className="ta-panel-title">History of lines 3–5</div>
        <div className="ta-rev">a1b2c3d Round the total</div>
        <div className="ta-del">- return sum</div>
        <div className="ta-add">+ return round(sum)</div>
        <div className="ta-rev">9f8e7d6 Count quantities</div>
        <div className="ta-del">- sum += i.price</div>
        <div className="ta-add">+ sum += i.price * i.qty</div>
      </div>
      <Cursor />
    </>
  )
}

export function BlameBack(): React.JSX.Element {
  return (
    <>
      <div className="ta-panel-title">
        Blame src/cart.ts <Swap a="at HEAD" b="before a1b2c3d" />
        <span className="ta-btn ta-back">↶ Back</span>
      </div>
      {CODE.slice(0, 5).map((line, i) => (
        <div
          key={i}
          className={`ta-code ta-blame ${i === 4 ? 'ta-target' : ''}`}
          style={{ top: 38 + i * 22 }}
        >
          <span className="ta-who">
            {i === 4 ? (
              <Swap a="a1b2c3d Ann" b="5e6f7a8 Bob" />
            ) : (
              `${['3c4d5e6', '3c4d5e6', '9f8e7d6', '9f8e7d6'][i]} ${i < 2 ? 'Bob' : 'Cid'}`
            )}
          </span>
          {i === 4 && <span className="ta-arrow">⟲</span>}
          {i === 4 ? <Swap a={line} b="  return sum" /> : line}
        </div>
      ))}
      <Cursor />
    </>
  )
}

export function CodeSearch(): React.JSX.Element {
  return (
    <>
      <div className="ta-search">
        <span className="ta-search-box">
          <span className="ta-typed">parseUser</span>
          <span className="ta-caret" />
        </span>
        <span className="ta-mode ta-mode-commit">Commit</span>
        <span className="ta-mode">File</span>
        <span className="ta-mode ta-mode-code">Code</span>
      </div>
      <Lane from={1} to={4} />
      <Row i={1} subject="speed up login" className="ta-miss" />
      <Row i={2} subject="split the user module" className="ta-match" />
      <Row i={3} subject="update docs" className="ta-miss" />
      <Row i={4} subject="add sign up" className="ta-match" />
      <Cursor />
    </>
  )
}

const BARS = [3, 5, 4, 7, 6, 9, 8, 11, 7, 10, 12, 9]
const HOT = [
  ['src/app.ts', 92],
  ['src/login.ts', 64],
  ['README.md', 38]
] as const

export function Statistics(): React.JSX.Element {
  return (
    <>
      <div className="ta-panel-title">Statistics · all branches · last year</div>
      <div className="ta-bars">
        {BARS.map((h, i) => (
          <span key={i} style={{ height: h * 7 }} />
        ))}
      </div>
      <div className="ta-calendar">
        {Array.from({ length: 70 }, (_, i) => (
          <span key={i} style={{ opacity: 0.15 + (((i * 7919) % 13) / 13) * 0.85 }} />
        ))}
      </div>
      <div className="ta-hot">
        {HOT.map(([file, width]) => (
          <div key={file}>
            <span>{file}</span>
            <i style={{ width }} />
          </div>
        ))}
      </div>
    </>
  )
}

export function Compare(): React.JSX.Element {
  return (
    <>
      <Lane from={0} to={3} />
      <Label i={0} name="feature" />
      <Label i={2} name="main" />
      {['add payments', 'cart totals', 'fix header', 'init'].map((s, i) => (
        <Row key={i} i={i} subject={s} />
      ))}
      <Menu
        className="ta-menu-open ta-menu-cmp"
        items={['Compare with feature', 'Checkout main']}
      />
      <div className={`ta-side-panel ${from(48)}`}>
        <div className="ta-side-title">main ↔ feature · 3 files</div>
        <div className={from(52)}>
          <b className="ta-m">M</b> src/cart.ts
        </div>
        <div className={from(56)}>
          <b className="ta-a">A</b> src/pay.ts
        </div>
        <div className={from(60)}>
          <b className="ta-m">M</b> README.md
        </div>
      </div>
      <Cursor
        path={[
          [390, 170],
          [36, 88],
          [80, 112]
        ]}
      />
    </>
  )
}

export function Bisect(): React.JSX.Element {
  return (
    <>
      <Lane from={0} to={4} />
      <Label i={0} name="main" />
      {['release 2.1', 'tweak the cache', 'new parser', 'update deps', 'release 2.0'].map(
        (s, i) => (
          <Row key={i} i={i} subject={s} className={i === 2 ? 'ta-bis-culprit' : ''} />
        )
      )}
      <span className={`ta-bis-tag ta-bis-bad ${from(10)}`} style={{ top: top(0) + 3 }}>
        bad
      </span>
      <span className={`ta-bis-tag ta-bis-good ${from(20)}`} style={{ top: top(4) + 3 }}>
        good
      </span>
      <span className="ta-bis-tag ta-bis-test">◀ testing</span>
      <span className={`ta-bis-tag ta-bis-bad ${from(40)}`} style={{ top: top(2) + 3 }}>
        bad
      </span>
      <span className={`ta-bis-tag ta-bis-good ${from(56)}`} style={{ top: top(3) + 3 }}>
        good
      </span>
      <span className={`ta-bis-tag ta-bis-first ${from(64)}`} style={{ top: top(2) + 3 }}>
        found: it came in here
      </span>
    </>
  )
}
