// The animations of the tips: small drawn scenes of GitDom, in the colors of the theme, looping.
// Each scene is absolutely laid out on a 440×180 stage; its timeline is in tips.css.
import { useShortcutLabel } from '../shortcuts'

const ROW = 30
const top = (i: number): number => 20 + i * ROW

function Cursor(): React.JSX.Element {
  return (
    <svg className="ta-cursor" width="14" height="19" viewBox="0 0 14 19" aria-hidden>
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
      {CODE.map((line, i) => (
        <div
          key={i}
          className={`ta-code ${i >= 2 && i <= 4 ? `ta-pick ta-pick-${i === 2 ? 'a' : 'b'}` : ''}`}
          style={{ top: 34 + i * 20 }}
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
  statistics: Statistics
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
