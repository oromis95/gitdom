// The animations of the tips: small drawn scenes of GitDom, in the colors of the theme, looping.
// Each scene is absolutely laid out on a 440×180 stage (tips/), with its timeline in
// assets/tips/, after the shared one of assets/tips/timeline.css.
import { BranchOverview, ConflictWatch, SoloBranch, Worktrees } from './tips/branches'
import {
  DragBranch,
  Fixup,
  HunkEdit,
  MoveCommits,
  Patches,
  Recovery,
  ReorderCommits,
  SplitCommit,
  Undo
} from './tips/commits'
import {
  Bisect,
  BlameBack,
  BrowseFiles,
  CodeSearch,
  Compare,
  LineHistory,
  Statistics
} from './tips/history'
import { Dashboard, MyWeek, Palette } from './tips/tools'

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
