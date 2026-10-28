// Context menus of branches, tags, stashes, remotes, commits and submodules.
import type { Ref, RepoSnapshot, Stash, Submodule } from '../../../shared/types'
import { NO_GRAPH_FILTER, useApp } from '../store'
import type { MenuItem } from '../ui'
import { PULL_NOUN } from '../../../shared/forge'
import { canOpenPull, isReady, openCreatePull, pullLabel, pullsByRef, useForge } from '../forge'
import { checkoutInWorktree, createWorktree, worktreeOf } from '../worktrees'
import { copy, run } from './core'
import {
  checkoutBranch,
  checkoutCommit,
  checkoutRemoteBranch,
  createBranch,
  createTag,
  deleteBranch,
  deleteRemoteBranch,
  deleteRemoteTag,
  deleteTag,
  pushTag,
  renameBranch,
  setUpstream
} from './refs'
import {
  editRemote,
  fetchAll,
  pull,
  push,
  removeRemote,
  savedPullMode,
  submodulePath,
  syncSubmodules,
  updateSubmodules
} from './remote'
import { stashDrop, stashPop } from './workingTree'
import { fixup, splitCommit } from './commits'
import {
  RESET_HELP,
  cherryPick,
  interactiveRebase,
  merge,
  moveCommits,
  rebase,
  reset,
  revert
} from './merge'
import {
  copyPatch,
  markBisect,
  saveCommitsPatch,
  showReleaseNotes,
  startBisect,
  stopBisect
} from './tools'

// --- Context menus --------------------------------------------------------------------------

/** Merge and rebase items for a branch other than the current one. */
function integrationItems(snapshot: RepoSnapshot, name: string): MenuItem[] {
  const repo = snapshot.path
  const current = snapshot.head.branch
  return [
    {
      label: `Merge ${name} into ${current ?? 'HEAD'}…`,
      disabled: !snapshot.head.hash,
      onClick: () => void merge(repo, snapshot, name)
    },
    {
      label: `Rebase ${current ?? 'HEAD'} onto ${name}`,
      disabled: !current,
      onClick: () => void rebase(repo, snapshot, name)
    }
  ]
}

/** Shows the files changed between two revisions in the detail panel (DIFF-08). */
function compareItem(label: string, from: string, to: string, disabled = false): MenuItem {
  return { label, disabled, onClick: () => useApp.getState().compare({ from, to }) }
}

/** Compares the current branch with a branch or tag: what `ref` has that HEAD doesn't. */
function compareWithHead(snapshot: RepoSnapshot, ref: string): MenuItem {
  const current = snapshot.head.branch ?? 'HEAD'
  return compareItem(`Compare with ${current}`, current, ref, ref === snapshot.head.branch)
}

/** Hides a branch from the graph, or shows it alone (GRAPH-14). */
function graphItems(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const { graphFilters, setGraphFilter } = useApp.getState()
  const repo = snapshot.path
  const filter = graphFilters[repo] ?? NO_GRAPH_FILTER
  const hidden = filter.hidden.includes(ref.fullName)
  // The graph always includes HEAD, so the current branch can't be hidden
  const isCurrent = ref.type === 'local' && ref.name === snapshot.head.branch
  return [
    hidden
      ? {
          label: 'Show in graph',
          onClick: () =>
            setGraphFilter(repo, {
              ...filter,
              hidden: filter.hidden.filter((name) => name !== ref.fullName)
            })
        }
      : {
          label: 'Hide in graph',
          disabled: isCurrent || filter.solo !== null,
          onClick: () =>
            setGraphFilter(repo, { ...filter, hidden: [...filter.hidden, ref.fullName] })
        },
    filter.solo === ref.fullName
      ? {
          label: 'Show all branches',
          onClick: () => setGraphFilter(repo, { ...filter, solo: null })
        }
      : {
          label: 'Show only this branch',
          onClick: () => setGraphFilter(repo, { ...filter, solo: ref.fullName })
        }
  ]
}

export function localBranchMenu(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const repo = snapshot.path
  const isCurrent = ref.name === snapshot.head.branch
  return [
    {
      label: `Checkout ${ref.name}`,
      disabled: isCurrent,
      onClick: () => void checkoutBranch(repo, ref.name)
    },
    ...(isCurrent
      ? [
          { label: 'Pull', onClick: () => void pull(repo, savedPullMode()) },
          { label: 'Push', onClick: () => void push(repo) }
        ]
      : integrationItems(snapshot, ref.name)),
    'separator',
    { label: `Create branch here`, onClick: () => void createBranch(repo, ref.name, ref.name) },
    { label: 'Create tag here', onClick: () => void createTag(repo, ref.hash, ref.name) },
    {
      label: worktreeOf(snapshot, ref.name) ? 'Open its worktree' : 'Check out in a new worktree…',
      disabled: isCurrent,
      onClick: () => void checkoutInWorktree(snapshot, ref)
    },
    { label: 'Set upstream…', onClick: () => void setUpstream(repo, snapshot, ref) },
    compareWithHead(snapshot, ref.name),
    'separator',
    { label: 'Rename…', onClick: () => void renameBranch(repo, ref.name) },
    {
      label: `Delete ${ref.name}`,
      danger: true,
      disabled: isCurrent,
      onClick: () => void deleteBranch(repo, ref.name)
    },
    'separator',
    ...graphItems(snapshot, ref),
    'separator',
    { label: 'Copy branch name', onClick: () => copy(ref.name) }
  ]
}

export function remoteBranchMenu(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const repo = snapshot.path
  return [
    {
      label: `Checkout ${ref.name}`,
      onClick: () => void checkoutRemoteBranch(repo, snapshot, ref)
    },
    ...integrationItems(snapshot, ref.name),
    { label: 'Create branch here', onClick: () => void createBranch(repo, ref.name, ref.name) },
    {
      label: 'Check out in a new worktree…',
      onClick: () => void checkoutInWorktree(snapshot, ref)
    },
    compareWithHead(snapshot, ref.name),
    'separator',
    {
      label: `Delete from ${ref.remote}`,
      danger: true,
      onClick: () => void deleteRemoteBranch(repo, ref)
    },
    'separator',
    ...graphItems(snapshot, ref),
    'separator',
    { label: 'Copy branch name', onClick: () => copy(ref.name) }
  ]
}

export function tagMenu(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const repo = snapshot.path
  return [
    {
      label: `Checkout ${ref.name} (detached)`,
      disabled: snapshot.head.hash === ref.hash && !snapshot.head.branch,
      onClick: () => void checkoutCommit(repo, ref.hash)
    },
    compareWithHead(snapshot, ref.name),
    { label: 'Release notes…', onClick: () => showReleaseNotes(repo, ref.name) },
    'separator',
    ...snapshot.remotes.map((r): MenuItem => ({
      label: `Push to ${r.name}`,
      onClick: () => void pushTag(repo, r.name, ref.name)
    })),
    'separator',
    { label: `Delete ${ref.name}`, danger: true, onClick: () => void deleteTag(repo, ref.name) },
    ...snapshot.remotes.map((r): MenuItem => ({
      label: `Delete from ${r.name}`,
      danger: true,
      onClick: () => void deleteRemoteTag(repo, r.name, ref.name)
    })),
    'separator',
    { label: 'Copy tag name', onClick: () => copy(ref.name) }
  ]
}

export function refMenu(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  if (ref.type === 'local') return [...pullItems(snapshot, ref), ...localBranchMenu(snapshot, ref)]
  if (ref.type === 'remote')
    return [...pullItems(snapshot, ref), ...remoteBranchMenu(snapshot, ref)]
  return tagMenu(snapshot, ref)
}

/** The branch's pull request to open, or one to create from a local branch without one. */
function pullItems(snapshot: RepoSnapshot, ref: Ref): MenuItem[] {
  const status = useForge.getState().byRepo[snapshot.path]
  if (!isReady(status)) return []
  const pull = pullsByRef(status, snapshot).get(ref.fullName)
  const { kind } = status.repo
  if (pull)
    return [
      {
        label: `Open ${pullLabel(kind, pull.number)} ${pull.title}`,
        onClick: () => useApp.getState().openPullRequest(pull.number)
      },
      'separator'
    ]
  if (ref.type === 'local' && canOpenPull(snapshot.path, ref.name))
    return [
      {
        label: `Create ${PULL_NOUN[kind].name}…`,
        onClick: () => openCreatePull(snapshot.path, ref.name)
      },
      'separator'
    ]
  return []
}

export function stashMenu(snapshot: RepoSnapshot, entry: Stash): MenuItem[] {
  const repo = snapshot.path
  return [
    { label: 'Apply stash', onClick: () => void run(repo, 'stashApply', entry.selector) },
    { label: 'Pop stash', onClick: () => void stashPop(repo, entry) },
    'separator',
    { label: 'Delete stash', danger: true, onClick: () => void stashDrop(repo, entry) }
  ]
}

export function remoteMenu(snapshot: RepoSnapshot, name: string): MenuItem[] {
  const repo = snapshot.path
  const remote = snapshot.remotes.find((r) => r.name === name)
  return [
    { label: 'Fetch', onClick: () => void fetchAll(repo) },
    { label: 'Edit remote…', onClick: () => void editRemote(repo, snapshot, name) },
    ...(remote ? [{ label: 'Copy URL', onClick: () => copy(remote.fetchUrl) }] : []),
    'separator',
    { label: `Remove ${name}`, danger: true, onClick: () => void removeRemote(repo, name) }
  ]
}

export function commitMenu(snapshot: RepoSnapshot, hash: string, subject: string): MenuItem[] {
  const repo = snapshot.path
  const short = hash.slice(0, 7)
  const isHead = hash === snapshot.head.hash
  const branch = snapshot.head.branch ?? 'HEAD'
  return [
    { label: 'Checkout this commit (detached)', onClick: () => void checkoutCommit(repo, hash) },
    { label: 'Create branch here', onClick: () => void createBranch(repo, hash, short) },
    { label: 'Create tag here', onClick: () => void createTag(repo, hash, short) },
    { label: 'Create worktree here…', onClick: () => void createWorktree(snapshot, hash, short) },
    'separator',
    { label: 'Cherry-pick commit', disabled: isHead, onClick: () => void cherryPick(repo, [hash]) },
    {
      label: `Move ${isHead ? 'this commit' : 'this and later commits'} to a new branch…`,
      disabled: !snapshot.head.branch,
      onClick: () => void moveCommits(snapshot, hash, true)
    },
    {
      label: `Move ${isHead ? 'this commit' : 'this and later commits'} to another branch…`,
      disabled: !snapshot.head.branch,
      onClick: () => void moveCommits(snapshot, hash, false)
    },
    {
      label: 'Add staged changes to this commit (fixup)…',
      disabled: !snapshot.head.branch || !snapshot.status.staged.length,
      onClick: () => void fixup(snapshot, hash)
    },
    {
      label: 'Split commit…',
      disabled: !snapshot.head.branch,
      onClick: () => void splitCommit(snapshot, hash)
    },
    { label: 'Revert commit', onClick: () => void revert(repo, hash) },
    {
      label: `Interactive rebase ${branch} from here…`,
      disabled: isHead || !snapshot.head.branch,
      onClick: () => void interactiveRebase(repo, hash)
    },
    compareItem(`Compare with ${branch}`, hash, branch, isHead),
    'separator',
    ...bisectItems(snapshot, hash),
    'separator',
    ...(['soft', 'mixed', 'hard'] as const).map((mode): MenuItem => ({
      label: `Reset ${branch} here: ${mode} (${RESET_HELP[mode]})`,
      danger: mode === 'hard',
      disabled: isHead && mode !== 'hard',
      onClick: () => void reset(repo, snapshot, hash, mode)
    })),
    'separator',
    { label: 'Save as patch…', onClick: () => void saveCommitsPatch(snapshot, [hash]) },
    { label: 'Copy as patch', onClick: () => void copyPatch(repo, { commits: [hash] }) },
    { label: 'Copy commit hash', onClick: () => copy(hash) },
    { label: 'Copy commit message', onClick: () => copy(subject) }
  ]
}

/** The bisect items of a commit's menu. */
function bisectItems(snapshot: RepoSnapshot, hash: string): MenuItem[] {
  const repo = snapshot.path
  if (!snapshot.bisect)
    return [
      {
        label: 'Find where a problem started (bisect): it is here…',
        disabled: !!snapshot.operation,
        onClick: () => void startBisect(snapshot, hash)
      }
    ]
  return [
    { label: 'Bisect: mark as good', onClick: () => void markBisect(repo, 'good', hash) },
    { label: 'Bisect: mark as bad', onClick: () => void markBisect(repo, 'bad', hash) },
    { label: "Bisect: skip (can't be tested)", onClick: () => void markBisect(repo, 'skip', hash) },
    { label: 'Stop bisect', onClick: () => void stopBisect(repo) }
  ]
}

/** Menu for several commits selected with Ctrl+click. */
export function commitsMenu(
  snapshot: RepoSnapshot,
  hashes: string[],
  clear: () => void
): MenuItem[] {
  return [
    ...(hashes.length === 2
      ? [
          compareItem(
            `Compare ${hashes[0].slice(0, 7)} with ${hashes[1].slice(0, 7)}`,
            hashes[0],
            hashes[1]
          )
        ]
      : []),
    {
      label: `Cherry-pick ${hashes.length} commits`,
      onClick: () => {
        clear()
        void cherryPick(snapshot.path, hashes)
      }
    },
    {
      label: `Save ${hashes.length} commits as a patch…`,
      onClick: () => void saveCommitsPatch(snapshot, hashes)
    },
    'separator',
    { label: 'Clear selection', onClick: clear }
  ]
}

export function submoduleMenu(snapshot: RepoSnapshot, sub: Submodule): MenuItem[] {
  const repo = snapshot.path
  const initialized = sub.state !== 'uninitialized'
  return [
    {
      label: 'Open submodule',
      disabled: !initialized,
      onClick: () => void useApp.getState().openRepo(submodulePath(repo, sub))
    },
    {
      label: initialized ? 'Update to the recorded commit' : 'Initialize',
      disabled: sub.state === 'clean',
      onClick: () => void updateSubmodules(repo, [sub.path])
    },
    {
      label: 'Sync the URL from .gitmodules',
      disabled: !initialized,
      onClick: () => void syncSubmodules(repo, [sub.path])
    },
    'separator',
    { label: 'Copy path', onClick: () => copy(sub.path) },
    ...(sub.url ? [{ label: 'Copy URL', onClick: () => copy(sub.url) }] : [])
  ]
}
