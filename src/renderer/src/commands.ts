// Everything the command palette can do, built from the current state when it opens.
import type { PullMode } from '../../shared/api'
import { useApp } from './store'
import { openPreferences, openRepoDialog } from './ui'
import { stepZoom, useSettings } from './settings'
import {
  setSplashEnabled,
  setTheme,
  splashEnabled,
  themeOptions,
  toggleDetail,
  toggleSidebarDrawer,
  useTheme
} from './theme'
import * as actions from './actions'
import { shortcutLabel } from './shortcuts'
import { createWorktree, folderName, openWorktree, samePath } from './worktrees'
import { openWorkspace, saveWorkspace, useWorkspaces } from './workspaces'
import { toggleTerminal, useTerminal } from './terminal'
import { toggleActivity, useActivity } from './activity'
import { checkForUpdates, showWhatsNew } from './updates'
import { showTip } from './tips'
import {
  adoptGlobalIdentity,
  applyProfile,
  describeIdentity,
  editIdentity,
  editSigning,
  loadProfiles
} from './identity'

export interface Command {
  title: string
  group: string
  /** Keyboard shortcut or extra information, shown on the right */
  hint?: string
  run(): void
}

const PULLS: { mode: PullMode; title: string }[] = [
  { mode: 'ff', title: 'Pull (fast-forward if possible)' },
  { mode: 'ff-only', title: 'Pull (fast-forward only)' },
  { mode: 'rebase', title: 'Pull (rebase)' }
]

/** Commands, most useful first: the palette keeps this order for equal matches. */
export function buildCommands(): Command[] {
  const app = useApp.getState()
  const tab = app.tabs[app.active]
  const snapshot = tab?.snapshot
  const commands: Command[] = []
  const add = (group: string, title: string, run: () => void, hint?: string): void => {
    commands.push({ group, title, run, hint })
  }

  if (snapshot) {
    const repo = snapshot.path
    const { head, operation, history } = snapshot
    const current = head.branch

    if (operation) {
      add(
        'Operation',
        `Continue ${operation}`,
        () => void actions.continueOperation(repo, operation)
      )
      add('Operation', `Abort ${operation}`, () => void actions.abortOperation(repo, operation))
      if (operation !== 'merge') {
        add('Operation', 'Skip commit', () => void actions.skipOperation(repo, operation))
      }
    }
    if (history.undo && !operation) {
      add('History', `Undo "${history.undo}"`, () => void actions.undo(repo), shortcutLabel('undo'))
    }
    if (history.redo && !operation) {
      add('History', `Redo "${history.redo}"`, () => void actions.redo(repo), shortcutLabel('redo'))
    }

    if (snapshot.remotes.length) {
      add('Remote', 'Fetch all', () => void actions.fetchAll(repo), shortcutLabel('fetch'))
      for (const { mode, title } of PULLS) add('Remote', title, () => void actions.pull(repo, mode))
      if (current) add('Remote', 'Push', () => void actions.push(repo), shortcutLabel('push'))
    }
    add('Remote', 'Add remote…', () => void actions.addRemote(repo))

    const changes = snapshot.status.staged.length + snapshot.status.unstaged.length
    if (changes)
      add('Stash', 'Stash changes', () => void actions.stash(repo), shortcutLabel('stash'))
    for (const entry of snapshot.stashes) {
      add('Stash', `Pop stash: ${entry.message}`, () => void actions.stashPop(repo, entry))
    }

    if (head.hash) {
      add('Branch', 'Create branch…', () => void actions.createBranch(repo, null))
      add('Tag', 'Create tag…', () => void actions.createTag(repo, head.hash!, 'HEAD'))
    }
    const locals = snapshot.refs.filter((r) => r.type === 'local')
    const remotes = snapshot.refs.filter((r) => r.type === 'remote' && !r.name.endsWith('/HEAD'))
    for (const ref of locals) {
      if (ref.name !== current) {
        add('Branch', `Checkout ${ref.name}`, () => void actions.checkoutBranch(repo, ref.name))
      }
    }
    for (const ref of remotes) {
      add('Branch', `Checkout ${ref.name}`, () => {
        void actions.checkoutRemoteBranch(repo, snapshot, ref)
      })
    }
    if (head.hash) {
      for (const ref of [...locals, ...remotes]) {
        if (ref.name === current) continue
        add('Branch', `Merge ${ref.name} into ${current ?? 'HEAD'}…`, () => {
          void actions.merge(repo, snapshot, ref.name)
        })
        if (current) {
          add('Branch', `Rebase ${current} onto ${ref.name}`, () => {
            void actions.rebase(repo, snapshot, ref.name)
          })
        }
      }
    }

    // The file on screen, from a diff or the inspector
    const file = tab.diff?.source.kind !== 'untracked' ? tab.diff?.path : undefined
    const inspected = file ?? tab.inspect?.path
    if (inspected) {
      const rev =
        tab.diff?.source.kind === 'commit' ? tab.diff.source.hash : (tab.inspect?.rev ?? null)
      add('File', `History of ${inspected}`, () =>
        app.inspectFile({ path: inspected, mode: 'history', rev: null })
      )
      add('File', `Blame ${inspected}`, () =>
        app.inspectFile({
          path: inspected,
          mode: 'blame',
          rev,
          revPath: file ? undefined : tab.inspect?.revPath
        })
      )
    }

    const pending = snapshot.submodules.filter(
      (s) => s.state === 'uninitialized' || s.state === 'moved'
    )
    if (pending.length) {
      add(
        'Submodule',
        'Initialize and update submodules',
        () => void actions.updateSubmodules(repo)
      )
    }
    add('Submodule', 'Add submodule…', () => void actions.addSubmodule(repo))
    if (snapshot.submodules.length > 0) {
      add('Submodule', 'Update all submodules', () => void actions.updateSubmodules(repo))
      add('Submodule', 'Sync submodule URLs from .gitmodules', () => {
        void actions.syncSubmodules(repo)
      })
    }
    for (const sub of snapshot.submodules) {
      if (sub.state !== 'uninitialized') {
        add('Submodule', `Open submodule ${sub.path}`, () => {
          void app.openRepo(actions.submodulePath(repo, sub))
        })
      }
    }
    if (head.hash) add('Worktree', 'New worktree…', () => void createWorktree(snapshot, null))
    for (const wt of snapshot.worktrees) {
      if (!samePath(wt.path, repo) && wt.prunable === null) {
        const on = wt.branch ?? 'detached'
        add('Worktree', `Open worktree ${folderName(wt.path)} (${on})`, () => {
          void openWorktree(wt.path)
        })
      }
    }
    if (snapshot.lfs.installed) {
      add('LFS', 'Track files with LFS…', () => void actions.lfsTrack(repo))
      add('LFS', 'Download the LFS files (git lfs pull)', () => void actions.lfsPull(repo))
      for (const remote of snapshot.remotes) {
        add('LFS', `Upload the LFS files to ${remote.name}`, () => {
          void actions.lfsPush(repo, remote.name)
        })
      }
      for (const pattern of snapshot.lfs.patterns) {
        add(
          'LFS',
          `Stop tracking ${pattern} with LFS`,
          () => void actions.lfsUntrack(repo, pattern)
        )
      }
    }

    for (const profile of loadProfiles()) {
      add('Identity', `Use ${describeIdentity(profile)} in this repository`, () => {
        void applyProfile(repo, profile)
      })
    }
    add('Identity', 'Edit identity for this repository…', () => {
      void editIdentity(repo, snapshot.identity, 'local')
    })
    if (snapshot.identity.scope === 'local') {
      add('Identity', 'Use the global identity in this repository', () => {
        void adoptGlobalIdentity(repo)
      })
    }
    add('Identity', 'Commit signing: GPG or SSH key…', () => void editSigning(snapshot))

    add('Recovery', 'Reflog: where HEAD and the branches have been', () =>
      app.openRecovery('reflog')
    )
    add('Recovery', 'Backups saved before resets, rebases and force pushes', () =>
      app.openRecovery('backups')
    )
    add(
      'Repository',
      'Branches overview: age, ahead and behind main, merged; delete old ones',
      () => actions.showBranchOverview(repo)
    )
    add('Repository', 'Repository health: size, heaviest files, compress (gc) and check', () =>
      actions.showRepoHealth(repo)
    )
    add('Repository', 'Hooks: see, write, turn off and on, and try the git hooks', () =>
      actions.showHooks(repo)
    )
    add('Repository', 'Statistics: authors, activity, languages and hot files', () =>
      app.openStatistics(true)
    )
    add('Repository', 'Ignored files: why a file is ignored, and by which rule', () =>
      actions.showIgnoredFiles(repo, '')
    )
    add('Repository', 'Clean up untracked or ignored files, to the Recycle Bin', () =>
      actions.showCleanUp(repo)
    )
    add('Repository', 'Release notes: the commits since the last tag, grouped by type', () =>
      actions.showReleaseNotes(repo, 'HEAD')
    )
    add('Repository', 'Refresh', () => void app.refresh(), shortcutLabel('refresh'))
    add('Repository', 'Open repository in editor', () => void actions.openInEditor(repo, null))
    add('Repository', 'Show repository in Explorer', () => actions.showInFolder(repo, null))
  }

  add('Repository', 'Open repository…', () => void app.pickAndOpen(), shortcutLabel('openRepo'))
  add('Repository', 'Clone repository…', () => openRepoDialog('clone'))
  add('Repository', 'New repository…', () => openRepoDialog('init'))
  for (const workspace of useWorkspaces.getState().list) {
    const names = workspace.paths.map((p) => p.split(/[\\/]/).pop()).join(', ')
    add(
      'Workspace',
      `Open workspace ${workspace.name}`,
      () => openWorkspace(workspace, false),
      names
    )
    add('Workspace', `Switch to workspace ${workspace.name} (closes the other tabs)`, () => {
      openWorkspace(workspace, true)
    })
  }
  if (app.tabs.length) add('Workspace', 'Save open tabs as workspace…', () => void saveWorkspace())
  app.tabs.forEach((t, i) => {
    if (i !== app.active) add('Tabs', `Switch to ${t.name}`, () => app.setActive(i), t.path)
  })
  if (tab) add('Tabs', `Close ${tab.name}`, () => app.closeTab(app.active))
  // Favorites first, then the other recent repositories
  const known = [...app.favorites, ...app.recent.filter((p) => !app.favorites.includes(p))]
  for (const path of known) {
    if (!app.tabs.some((t) => t.path === path)) {
      const star = app.favorites.includes(path) ? '★ ' : ''
      add(
        'Repository',
        `Open ${star}${path.split(/[\\/]/).pop()}`,
        () => void app.openRepo(path),
        path
      )
    }
  }

  if (snapshot) {
    const shown = useTerminal.getState().shown
    add(
      'View',
      shown ? 'Hide terminal' : 'Open terminal',
      () => toggleTerminal(),
      shortcutLabel('terminal')
    )
  }
  const activity = useActivity.getState().shown
  add(
    'View',
    activity ? 'Hide the activity log' : 'Show the activity log (git commands run)',
    () => toggleActivity(),
    shortcutLabel('activity')
  )
  const { theme, layout, detailHidden, sidebarOpen } = useTheme.getState()
  for (const t of themeOptions())
    add('View', `Theme: ${t.label}`, () => setTheme(t.id), t.id === theme ? 'current' : undefined)
  if (snapshot && layout === 'studio') {
    add('View', detailHidden ? 'Show the detail panel' : 'Hide the detail panel', () =>
      toggleDetail()
    )
  }
  if (snapshot && layout === 'focus') {
    add('View', sidebarOpen ? 'Hide the branches' : 'Show the branches', () =>
      toggleSidebarDrawer()
    )
  }
  const zoom = Math.round(useSettings.getState().zoom * 100)
  add('View', 'Zoom in', () => stepZoom(1), `${shortcutLabel('zoomIn')}  (${zoom}%)`.trim())
  add('View', 'Zoom out', () => stepZoom(-1), shortcutLabel('zoomOut'))
  add('View', 'Reset zoom', () => stepZoom(0), shortcutLabel('zoomReset'))
  add('Preferences', 'Preferences…', () => openPreferences(), shortcutLabel('preferences'))
  add('Help', 'Tips: what GitDom can do', () => showTip())
  add('Help', "What's new in GitDom", () => showWhatsNew())
  add('Help', 'Check for updates', () => void checkForUpdates(true))
  const splash = splashEnabled()
  add('View', splash ? 'Turn off the startup animation' : 'Turn on the startup animation', () =>
    setSplashEnabled(!splash)
  )

  // Commits last: there are many, and they only show up when typing
  if (snapshot) {
    for (const c of snapshot.commits) {
      commands.push({
        group: 'Commit',
        title: c.subject,
        hint: c.hash.slice(0, 7),
        run: () => {
          app.openDiff(null)
          app.select(c.hash, true)
        }
      })
    }
  }
  return commands
}
