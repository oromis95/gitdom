// Scenes of the tips about commits: undo, recovery, moving, fixing, splitting and reordering.
import { Cursor, Label, Lane, Menu, Row, Toast } from './primitives'
import { ROW, from, top } from './layout'

export function Undo(): React.JSX.Element {
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

export function Recovery(): React.JSX.Element {
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

export function MoveCommits(): React.JSX.Element {
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

export function Fixup(): React.JSX.Element {
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

export function SplitCommit(): React.JSX.Element {
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

export function ReorderCommits(): React.JSX.Element {
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

export function DragBranch(): React.JSX.Element {
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

export function HunkEdit(): React.JSX.Element {
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

export function Patches(): React.JSX.Element {
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
