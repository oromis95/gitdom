// The animations of the tips: small drawn scenes of GitDom, in the colors of the theme, looping.
// Each scene is absolutely laid out on a 440×180 stage; its timeline is in tips.css.
import { useShortcutLabel } from '../shortcuts'

const ROW = 30
const top = (i: number): number => 20 + i * ROW

/**
 * The pointer. With a path it follows the shared timeline of tips.css: it shows up at the first
 * point, clicks the second and the third, and with `three` the fourth.
 */
function Cursor({
  path,
  three = false
}: {
  path?: [number, number][]
  three?: boolean
}): React.JSX.Element {
  const style = Object.fromEntries(
    (path ?? []).flatMap(([x, y], i) => [
      [`--x${i}`, `${x}px`],
      [`--y${i}`, `${y}px`]
    ])
  ) as React.CSSProperties
  const timeline = path ? (three ? 'ta-cur3' : 'ta-cur2') : ''
  return (
    <svg
      className={`ta-cursor ${timeline}`}
      style={style}
      width="14"
      height="19"
      viewBox="0 0 14 19"
      aria-hidden
    >
      <path d="M1 1 L1 15 L4.5 11.5 L7.5 18 L10 17 L7 10.5 L12 10.5 Z" />
    </svg>
  )
}

function Row({
  i,
  subject,
  className = ''
}: {
  i: number
  subject: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={`ta-row ${className}`} style={{ top: top(i) }}>
      <span className="ta-dot" />
      <span className="ta-subject">{subject}</span>
    </div>
  )
}

function Lane({ from, to }: { from: number; to: number }): React.JSX.Element {
  return <div className="ta-lane" style={{ top: top(from) + 11, height: (to - from) * ROW }} />
}

function Label({
  i,
  name,
  className = ''
}: {
  i: number
  name: string
  className?: string
}): React.JSX.Element {
  return (
    <span className={`ta-label ${className}`} style={{ top: top(i) + 3 }}>
      {name}
    </span>
  )
}

function Menu({ items, className }: { items: string[]; className: string }): React.JSX.Element {
  return (
    <div className={`ta-menu ${className}`}>
      {items.map((item, i) => (
        <div key={i} className={i === 0 ? 'ta-hit' : ''}>
          {item}
        </div>
      ))}
    </div>
  )
}

function Toast({ text }: { text: string }): React.JSX.Element {
  return <div className="ta-toast">{text}</div>
}

function Palette(): React.JSX.Element {
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

function Undo(): React.JSX.Element {
  return (
    <>
      <div className="ta-toolbar">
        <span className="ta-btn ta-undo-btn">↶ Undo</span>
        <span className="ta-btn">↷ Redo</span>
      </div>
      <Lane from={1} to={3} />
      <Label i={1} name="main" />
      <Row i={1} subject="add login" className="ta-gone" />
      <Row i={2} subject="update docs" className="ta-gone" />
      <Row i={3} subject="init" />
      <div className="ta-badge">reset --hard HEAD~2</div>
      <Toast text="Undone: Reset main" />
      <Cursor />
    </>
  )
}

function Recovery(): React.JSX.Element {
  return (
    <>
      <div className="ta-panel-title">Reflog of main</div>
      <div className="ta-list" style={{ top: 40 }}>
        reset: moving to HEAD~2
      </div>
      <div className="ta-list ta-target" style={{ top: 66 }}>
        commit: add login
        <span className="ta-label ta-new">rescued</span>
      </div>
      <div className="ta-list" style={{ top: 92 }}>
        commit: update docs
      </div>
      <Menu className="ta-menu-rec" items={['Create branch here…', 'Copy commit hash']} />
      <Toast text="Created branch rescued" />
      <Cursor />
    </>
  )
}

function MoveCommits(): React.JSX.Element {
  return (
    <>
      <Lane from={0} to={3} />
      <Label i={0} name="main" className="ta-main" />
      <Label i={0} name="fix/wrong" className="ta-new" />
      <Row i={0} subject="wrong two" className="ta-moved" />
      <Row i={1} subject="wrong one" className="ta-moved" />
      <Row i={2} subject="yesterday's work" />
      <Row i={3} subject="init" />
      <Menu
        className="ta-menu-move"
        items={['Move this and later commits to a new branch…', '…to another branch…']}
      />
      <Cursor />
    </>
  )
}

function Fixup(): React.JSX.Element {
  return (
    <>
      <Lane from={0} to={2} />
      <Label i={0} name="main" />
      <Row i={0} subject="add c" />
      <Row i={1} subject="add b" className="ta-fixed" />
      <Row i={2} subject="init" />
      <div className="ta-staged">
        <div className="ta-staged-title">Staged</div>
        <span className="ta-chip ta-chip-home">forgot.txt</span>
      </div>
      <span className="ta-chip ta-chip-fly">forgot.txt</span>
      <Menu className="ta-menu-fix" items={['Add staged changes to this commit (fixup)…']} />
      <Cursor />
    </>
  )
}

function SplitCommit(): React.JSX.Element {
  return (
    <>
      <Lane from={0} to={2} />
      <div className="ta-lane ta-split-lane" style={{ top: top(2) + 11, height: ROW }} />
      <Label i={0} name="main" />
      <Row i={0} subject="later work" />
      <Row i={1} subject="login, tests and docs" className="ta-split-old" />
      <Row i={1} subject="Update docs" className="ta-split-new" />
      <Row i={2} subject="Add login and tests" className="ta-split-new" />
      <Row i={2} subject="init" className="ta-split-down" />
      <Menu className="ta-menu-split" items={['Split commit…', 'Revert commit']} />
      <div className="ta-split-dialog">
        <div className="ta-split-title">Split commit</div>
        {['login.ts', 'login.test.ts', 'README.md'].map((file, i) => (
          <div key={file} className="ta-split-file" style={{ top: 30 + i * 18 }}>
            <span className={`ta-check ${i < 2 ? `ta-check-${i}` : ''}`} />
            {file}
          </div>
        ))}
        <div className="ta-split-msg" style={{ top: 88 }}>
          Add login and tests
        </div>
        <div className="ta-split-msg" style={{ top: 108 }}>
          Update docs
        </div>
        <span className="ta-btn ta-split-go">Split commit</span>
      </div>
      <Cursor />
    </>
  )
}

function ReorderCommits(): React.JSX.Element {
  return (
    <>
      <Lane from={0} to={3} />
      <Label i={0} name="main" />
      <Row i={0} subject="add login tests" />
      <Row i={1} subject="fix typo in README" className="ta-reorder-moved" />
      <Row i={2} subject="add login" className="ta-reorder-up" />
      <Row i={3} subject="init" />
      <div className="ta-reorder-line" style={{ top: top(3) - 5 }} />
      <Row i={1} subject="fix typo in README" className="ta-reorder-ghost" />
      <Toast text="Commits reordered" />
      <Cursor />
    </>
  )
}

function DragBranch(): React.JSX.Element {
  return (
    <>
      <Lane from={0} to={2} />
      <Label i={0} name="feature" />
      <Label i={1} name="main" className="ta-drop" />
      <span className="ta-label ta-ghost">feature</span>
      <Row i={0} subject="new feature" />
      <Row i={1} subject="bug fix" />
      <Row i={2} subject="init" />
      <Menu
        className="ta-menu-drag"
        items={['Merge feature into main', 'Rebase feature onto main', 'Fast-forward main']}
      />
      <Toast text="Merged feature into main" />
      <Cursor />
    </>
  )
}

const CODE = [
  'function total(items) {',
  '  let sum = 0',
  '  for (const i of items)',
  '    sum += i.price * i.qty',
  '  return round(sum)',
  '}'
]

function LineHistory(): React.JSX.Element {
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

/** Two texts in the same place, the second replacing the first for a while */
function Swap({ a, b }: { a: string; b: string }): React.JSX.Element {
  return (
    <span className="ta-swap">
      <span className="ta-swap-a">{a}</span>
      <span className="ta-swap-b">{b}</span>
    </span>
  )
}

function BlameBack(): React.JSX.Element {
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

function CodeSearch(): React.JSX.Element {
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

function BrowseFiles(): React.JSX.Element {
  return (
    <>
      <div className="ta-panel-title">a1b2c3d Fix login</div>
      <div className="ta-tabs">
        <span className="ta-tab ta-tab-changes">Changes</span>
        <span className="ta-tab ta-tab-all">All files</span>
      </div>
      <div className="ta-changes">
        <div>
          <b className="ta-m">M</b> src/login.ts
        </div>
      </div>
      <div className="ta-tree">
        <div>▾ src</div>
        <div className="ta-indent">app.ts</div>
        <div className="ta-indent">login.ts</div>
        <div className="ta-readme">README.md</div>
      </div>
      <div className="ta-file">
        <div className="ta-file-title">
          README.md <span className="ta-btn ta-save">Save as…</span>
        </div>
        <div className="ta-md"># GitDom</div>
        <div>A Git client for Windows.</div>
        <div className="ta-dim">## Install</div>
      </div>
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

function Statistics(): React.JSX.Element {
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

/** Shown from a moment of the loop on (ta-from-N), or until one (ta-until-N): see tips.css */
const from = (n: number): string => `ta-from-${n}`
const until = (n: number): string => `ta-until-${n}`

function Compare(): React.JSX.Element {
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

function SoloBranch(): React.JSX.Element {
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

function HunkEdit(): React.JSX.Element {
  return (
    <>
      <div className="ta-panel-title">src/limits.ts · unstaged</div>
      <div className="ta-he-head">
        @@ -4,2 +4,3 @@
        <span className="ta-he-gap" />
        <span className="ta-btn ta-he-edit">Edit…</span>
        <span className="ta-btn ta-he-stage">Stage hunk</span>
      </div>
      <div className="ta-he-box" />
      <div className="ta-code" style={{ top: 60 }}>
        {'  const max = read()'}
      </div>
      <div className="ta-code ta-del" style={{ top: 80 }}>
        {'- const limit = 10'}
      </div>
      <div className="ta-code ta-add" style={{ top: 100 }}>
        {'+ const limit = 50'}
      </div>
      <div className="ta-code ta-add ta-he-debug" style={{ top: 120 }}>
        {"+ console.log('limit', limit)"}
      </div>
      <div className={from(62)}>
        <Toast text="Staged without the debug line; the file still has it" />
      </div>
      <Cursor
        three
        path={[
          [390, 170],
          [334, 44],
          [300, 130],
          [392, 44]
        ]}
      />
    </>
  )
}

function ConflictWatch(): React.JSX.Element {
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

function Worktrees(): React.JSX.Element {
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

function Bisect(): React.JSX.Element {
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

function Patches(): React.JSX.Element {
  return (
    <>
      <Lane from={0} to={3} />
      <Label i={0} name="main" />
      {['update docs', 'fix login', 'add tests', 'init'].map((s, i) => (
        <Row key={i} i={i} subject={s} />
      ))}
      <Menu className="ta-menu-open ta-menu-patch" items={['Save as patch…', 'Copy as patch']} />
      <div className="ta-patch-repo">
        <div className="ta-side-title">other-repo</div>
        <div className={`ta-patch-new ${from(70)}`}>
          <span className="ta-dot" /> fix login
        </div>
      </div>
      <div className="ta-patch-file">fix-login.patch</div>
      <Cursor
        path={[
          [390, 170],
          [150, 62],
          [200, 86]
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

function BranchOverview(): React.JSX.Element {
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

function Dashboard(): React.JSX.Element {
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

function MyWeek(): React.JSX.Element {
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

const SCENES: Record<string, () => React.JSX.Element> = {
  palette: Palette,
  undo: Undo,
  recovery: Recovery,
  moveCommits: MoveCommits,
  fixup: Fixup,
  splitCommit: SplitCommit,
  reorderCommits: ReorderCommits,
  dragBranch: DragBranch,
  lineHistory: LineHistory,
  blameBack: BlameBack,
  codeSearch: CodeSearch,
  browseFiles: BrowseFiles,
  statistics: Statistics,
  compare: Compare,
  soloBranch: SoloBranch,
  hunkEdit: HunkEdit,
  conflictWatch: ConflictWatch,
  worktrees: Worktrees,
  bisect: Bisect,
  patches: Patches,
  branchOverview: BranchOverview,
  dashboard: Dashboard,
  myWeek: MyWeek
}

export default function TipAnimation({ id }: { id: string }): React.JSX.Element {
  const Scene = SCENES[id]
  return (
    <div className="ta-frame" aria-hidden>
      {/* The key restarts the loop when another tip is shown */}
      <div key={id} className={`ta-stage ta-${id}`}>
        {Scene && <Scene />}
      </div>
    </div>
  )
}
