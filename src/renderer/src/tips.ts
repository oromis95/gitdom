// Tips: features explained with a small animation, one at startup and one now and then while
// working, right after doing something the tip builds on. Help > Tips lists them all.
import { create } from 'zustand'
import type { ShortcutId } from './keys'
import { updateSettings, useSettings } from './settings'
import { shortcutLabel } from './shortcuts'
import { useUpdates } from './updates'

export interface Tip {
  id: string
  title: string
  /** What the feature is for */
  text: string
  /** How to use it; {key:id} stands for the keys of a shortcut */
  steps: string[]
  /** Actions after which the tip is shown once, if it was never seen */
  after?: string[]
}

export const TIPS: Tip[] = [
  {
    id: 'palette',
    title: 'Every action is a few keys away',
    text: 'The command palette finds any action by name: checkout a branch, blame the open file, open a view, change a setting.',
    steps: [
      'Press {key:palette} (or Ctrl+P)',
      'Type a few letters of what you want to do',
      'Press Enter on the action'
    ]
  },
  {
    id: 'undo',
    title: 'Undo almost anything',
    text: 'A reset, a rebase, a merge or a commit gone wrong can be taken back: GitDom remembers the branches before each action and puts them back.',
    steps: [
      'Click Undo in the toolbar, or press {key:undo}',
      'Redo ({key:redo}) does it again',
      'Before a reset, a rebase or a force push GitDom also saves a backup of the branch'
    ],
    after: ['reset', 'rebase', 'rebaseInteractive']
  },
  {
    id: 'recovery',
    title: 'Nothing is really lost',
    text: 'Commits dropped by a reset or a rebase are still in the reflog, and GitDom keeps a backup of each branch it rewrites.',
    steps: [
      'Open View → Reflog, or View → Backups',
      'Find the commit or the backup from before the mistake',
      'Right-click it to create a branch there, or restore the backup'
    ],
    after: ['undo']
  },
  {
    id: 'moveCommits',
    title: 'Committed on the wrong branch?',
    text: 'Move the commits where they belong: the branch you were on goes back to before them.',
    steps: [
      'Right-click the first wrong commit in the graph',
      'Choose Move this and later commits to a new branch… or …to another branch…',
      'Undo puts everything back'
    ],
    after: ['cherryPick']
  },
  {
    id: 'fixup',
    title: 'Forgot something in a commit?',
    text: 'Add it to the right commit, even an older one, instead of making a new "fix" commit. The message stays the same.',
    steps: [
      'Stage the forgotten changes',
      'Right-click the commit in the graph',
      'Choose Add staged changes to this commit (fixup)…'
    ],
    after: ['commit']
  },
  {
    id: 'splitCommit',
    title: 'One commit doing two things?',
    text: 'Split it in two, file by file, each with its own message: the history reads better and each change can be reverted on its own.',
    steps: [
      'Right-click the commit in the graph and choose Split commit…',
      'Tick the files that go in the first commit, the others stay in the second',
      'Write the two messages; your files and uncommitted changes stay as they are'
    ],
    after: ['reword']
  },
  {
    id: 'reorderCommits',
    title: 'Put the commits in a better order',
    text: 'Drag a commit up or down the current branch, so that the changes that belong together sit side by side before you push.',
    steps: [
      'Drag a commit of the current branch in the graph',
      'A line shows where it will go: drop it there and confirm',
      'Commits can move back to the last merge; Undo puts the old order back'
    ],
    after: ['fixup', 'splitCommit']
  },
  {
    id: 'dragBranch',
    title: 'Drag a branch onto another',
    text: 'Merging, rebasing or fast-forwarding is a drag away, right in the graph.',
    steps: [
      'Drag a branch label in the graph',
      'Drop it on the label of another branch',
      'Pick fast-forward, merge or rebase from the menu'
    ],
    after: ['merge']
  },
  {
    id: 'lineHistory',
    title: 'The history of a few lines',
    text: 'See only the commits that changed some lines, or a function, with how those lines looked each time.',
    steps: [
      'Open the blame of a file',
      'Click a line number, then Shift+click another for a range',
      'Click History of these lines in the bar above the code',
      'Or click Function… in the header and type its name'
    ],
    after: ['history']
  },
  {
    id: 'blameBack',
    title: 'Blame back in time',
    text: 'The blame shows who last changed a line. The arrow beside it shows the file just before that commit, at the same line, so you can keep going back.',
    steps: [
      'Open the blame of a file',
      'Click the arrow beside the commit of a line',
      'Back returns to where you were'
    ],
    after: ['blame']
  },
  {
    id: 'codeSearch',
    title: 'Search the code, not only the messages',
    text: 'Find the commits where some text appeared or went away, or whose changed lines match a regular expression.',
    steps: [
      'Press {key:search} to search the graph',
      'Click Code beside the search box',
      'Type the text; turn on regex for a pattern'
    ],
    after: ['search']
  },
  {
    id: 'browseFiles',
    title: 'Every file of any commit',
    text: 'Not only the changed files: read any file as it was in a commit, and save it anywhere.',
    steps: [
      'Select a commit',
      'Click All files in the commit panel',
      'Open a file from the tree; Save as… keeps a copy'
    ],
    after: ['commitDiff']
  },
  {
    id: 'compare',
    title: 'What changed between two branches',
    text: 'See every file that differs between two branches or commits, and open each diff, without checking anything out.',
    steps: [
      'Right-click a branch label or a commit in the graph',
      'Choose Compare with … (your current branch)',
      'The detail panel lists the files: click one for its diff'
    ],
    after: ['checkout']
  },
  {
    id: 'soloBranch',
    title: 'Only the branches you care about',
    text: 'A busy graph gets quiet: show a single branch and its history, or hide the branches you are not working on.',
    steps: [
      'Right-click a branch label in the graph or in the sidebar',
      'Choose Show only this branch, or Hide in graph',
      'Show all branches brings the others back'
    ],
    after: ['createBranch']
  },
  {
    id: 'hunkEdit',
    title: 'Change a hunk before staging it',
    text: 'Stage a hunk without the debug line in it, or with a fix: you change the lines that go in the commit, the file on disk stays as it is.',
    steps: [
      'Open the diff of a changed file',
      'Click Edit… on the hunk and change its lines',
      'Stage it: the commit gets your version, the file keeps the original'
    ],
    after: ['stage']
  },
  {
    id: 'conflictWatch',
    title: 'Conflicts with main, before they happen',
    text: 'GitDom quietly tries merging the main branch into yours: when it would stop on conflicts, a warning shows up in the toolbar, while they are still small.',
    steps: [
      'Watch for "N conflicts with main" in the toolbar',
      'Click it to see the files that would conflict',
      'Merge main in, or rebase onto it, now rather than later'
    ],
    after: ['pull']
  },
  {
    id: 'worktrees',
    title: 'Two branches at once',
    text: 'Fix something on another branch without stashing or committing half-done work: a worktree checks the branch out in a second folder, in its own tab.',
    steps: [
      'Right-click a branch and choose Check out in a new worktree…',
      'It opens in a new tab; your current folder keeps its changes',
      'The sidebar lists the worktrees, to open or remove them'
    ],
    after: ['stashPush']
  },
  {
    id: 'bisect',
    title: 'Find the commit that broke it',
    text: "Something worked before and now it doesn't: mark a commit with the problem and one without, and GitDom checks out the commits between, halving them at each answer.",
    steps: [
      'Right-click a commit with the problem: Find where a problem started…',
      'Mark a commit where it still worked as good',
      'Answer Good or Bad on each commit it checks out, or Automate…'
    ],
    after: ['revert']
  },
  {
    id: 'patches',
    title: 'Commits as a patch file',
    text: 'Send commits to someone without pushing, or bring them into another repository: a patch file keeps the changes, the messages and the authors.',
    steps: [
      'Right-click a commit, or select several, and choose Save as patch… or Copy as patch',
      'In the other repository use File → Apply Patch…',
      'Or drop the .patch file on the GitDom window'
    ],
    after: ['cherryPick']
  },
  {
    id: 'branchOverview',
    title: 'Tidy up old branches',
    text: 'Every branch with its last commit, its age and how far it is from main: the merged ones can go in one go.',
    steps: [
      'Open View → Branches Overview',
      'Click Choose merged, or tick the branches yourself',
      'Delete them together; Undo brings them back'
    ],
    after: ['deleteBranch']
  },
  {
    id: 'dashboard',
    title: 'All your repositories in one view',
    text: 'The branch, the uncommitted changes and what is ahead or behind, for every repository GitDom knows: fetch them all and bring the ones behind up to date.',
    steps: [
      'Open View → Workspace Dashboard',
      'Click Fetch all',
      'Pull the ones behind (fast-forward only), or open any of them'
    ],
    after: ['fetch']
  },
  {
    id: 'myWeek',
    title: 'What did I do this week?',
    text: 'Your commits in every repository, day by day, ready for a standup or a report.',
    steps: [
      'Open View → What I Did',
      'Pick this week, last week, or the last 7 or 30 days',
      'Copy as text or as Markdown; click a commit to open it'
    ],
    after: ['push']
  },
  {
    id: 'statistics',
    title: 'Get to know the repository',
    text: 'Who works on it and when, how the code grew, its languages, the files changed most, and those only one person knows.',
    steps: [
      'Open View → Statistics',
      'Pick the current branch or all of them, and a period',
      'Hot files shows where the work happens'
    ]
  }
]

const SEEN_KEY = 'gitdom.tipsSeen'
const LAST_KEY = 'gitdom.tipLast'
/** A tip waits for the action that brought it up to settle */
const TIP_DELAY = 2000
/** The startup tip lets the window and What's New show up first */
const STARTUP_DELAY = 1200

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** The text of a step, with the current keys of the shortcuts it mentions. */
export function withKeys(text: string): string {
  return text.replace(/\{key:(\w+)\}/g, (_, id: string) => {
    const label = shortcutLabel(id as ShortcutId)
    return label || 'its shortcut (Preferences → Keyboard)'
  })
}

interface TipsState {
  /** Index of the tip on screen, null when closed */
  open: number | null
}

export const useTips = create<TipsState>(() => ({ open: null }))

/** Shows a tip, the first one when none is given, and remembers it was seen. */
export function showTip(index = 0): void {
  const i = (index + TIPS.length) % TIPS.length
  const ids = seen().add(TIPS[i].id)
  localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]))
  localStorage.setItem(LAST_KEY, TIPS[i].id)
  useTips.setState({ open: i })
}

export const closeTips = (): void => useTips.setState({ open: null })

export const setShowTips = (showTips: boolean): void => updateSettings({ showTips })

const dialogOpen = (): boolean => !!document.querySelector('.modal, .palette, .menu')

let startupDone = false
let contextualShown = false

/** Once per run, when the startup screens are gone: the first tip not seen yet, or the next one. */
export function startupTip(): void {
  if (startupDone) return
  startupDone = true
  setTimeout(() => {
    if (!useSettings.getState().showTips || useUpdates.getState().whatsNew || dialogOpen()) return
    const done = seen()
    const fresh = TIPS.findIndex((t) => !done.has(t.id))
    const last = TIPS.findIndex((t) => t.id === localStorage.getItem(LAST_KEY))
    showTip(fresh >= 0 ? fresh : last + 1)
  }, STARTUP_DELAY)
}

/** After an action: a tip that builds on it, never seen, at most one per run. */
export function tipAfter(action: string): void {
  if (contextualShown || !useSettings.getState().showTips) return
  const done = seen()
  const index = TIPS.findIndex((t) => t.after?.includes(action) && !done.has(t.id))
  if (index < 0) return
  contextualShown = true
  setTimeout(() => {
    // Not over something the user is doing: another action may bring it up later
    if (dialogOpen() || useTips.getState().open !== null) contextualShown = false
    else showTip(index)
  }, TIP_DELAY)
}
