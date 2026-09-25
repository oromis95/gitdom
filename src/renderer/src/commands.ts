// Everything the command palette can do, built from the current state when it opens.
import type { PullMode } from '../../shared/api'
import { useApp } from './store'
import { openPreferences, openRepoDialog } from './ui'
import { stepZoom, useSettings } from './settings'
import {
  setSplashEnabled,
  setTheme,
  splashEnabled,
  toggleDetail,
  useTheme,
  type ThemeChoice
} from './theme'
import * as actions from './actions'
import { toggleTerminal, useTerminal } from './terminal'
import {
  adoptGlobalIdentity,
  applyProfile,
  describeIdentity,
  editIdentity,
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

const THEMES: { theme: ThemeChoice; title: string }[] = [
  { theme: 'dark', title: 'Theme: dark' },
  { theme: 'light', title: 'Theme: light' },
  { theme: 'studio', title: 'Theme: Studio (different layout)' },
  { theme: 'system', title: 'Theme: follow the system' }
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
      add('History', `Undo "${history.undo}"`, () => void actions.undo(repo), 'Ctrl+Z')
    }
    if (history.redo && !operation) {
      add('History', `Redo "${history.redo}"`, () => void actions.redo(repo), 'Ctrl+Y')
    }

    if (snapshot.remotes.length) {
      add('Remote', 'Fetch all', () => void actions.fetchAll(repo))
      for (const { mode, title } of PULLS) add('Remote', title, () => void actions.pull(repo, mode))
      if (current) add('Remote', 'Push', () => void actions.push(repo))
    }
    add('Remote', 'Add remote…', () => void actions.addRemote(repo))

    const changes = snapshot.status.staged.length + snapshot.status.unstaged.length
    if (changes) add('Stash', 'Stash changes', () => void actions.stash(repo))
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
    for (const sub of snapshot.submodules) {
      if (sub.state !== 'uninitialized') {
        add('Submodule', `Open submodule ${sub.path}`, () => {
          void app.openRepo(actions.submodulePath(repo, sub))
        })
      }
    }
    if (snapshot.lfs.installed) {
      add('LFS', 'Track files with LFS…', () => void actions.lfsTrack(repo))
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

    add('Repository', 'Refresh', () => void app.refresh())
    add('Repository', 'Open repository in editor', () => void actions.openInEditor(repo, null))
    add('Repository', 'Show repository in Explorer', () => actions.showInFolder(repo, null))
  }

  add('Repository', 'Open repository…', () => void app.pickAndOpen(), 'Ctrl+O')
  add('Repository', 'Clone repository…', () => openRepoDialog('clone'))
  add('Repository', 'New repository…', () => openRepoDialog('init'))
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
    add('View', shown ? 'Hide terminal' : 'Open terminal', () => toggleTerminal(), 'Ctrl+`')
  }
  const { theme, studio, detailHidden } = useTheme.getState()
  for (const t of THEMES) {
    add('View', t.title, () => setTheme(t.theme), t.theme === theme ? 'current' : undefined)
  }
  if (snapshot && studio) {
    add('View', detailHidden ? 'Show the detail panel' : 'Hide the detail panel', () =>
      toggleDetail()
    )
  }
  const zoom = Math.round(useSettings.getState().zoom * 100)
  add('View', 'Zoom in', () => stepZoom(1), `Ctrl+=  (${zoom}%)`)
  add('View', 'Zoom out', () => stepZoom(-1), 'Ctrl+-')
  add('View', 'Reset zoom', () => stepZoom(0), 'Ctrl+0')
  add('Preferences', 'Preferences…', () => openPreferences(), 'Ctrl+,')
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
