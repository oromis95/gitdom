import type {
  Blame,
  CommitDetail,
  DiffSource,
  FileChange,
  FileDiff,
  FileRevision,
  RepoSnapshot,
  WorkingTreeStatus
} from './types'

/**
 * IPC results carry errors as values: Electron would otherwise mangle the message of thrown errors.
 * `details` holds the full git output (hook output, rejection hints) when available.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; details?: string }

export type PullMode = 'ff' | 'ff-only' | 'rebase'
/** Auto-stash around a checkout: none, tracked changes only, or untracked files too. */
export type StashMode = 'none' | 'tracked' | 'all'

export type MergeMode = 'ff' | 'no-ff' | 'ff-only' | 'squash'
export type ResetMode = 'soft' | 'mixed' | 'hard'

/** Result of operations that may stop on conflicts, leaving the repository mid-operation. */
export interface OpOutcome {
  conflicts: boolean
  /** git's output */
  output: string
}

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface RebaseStep {
  action: RebaseAction
  hash: string
  /** New message, for reword */
  message?: string
}

export interface RebaseCommit {
  hash: string
  subject: string
  message: string
  author: string
}

/** What changed on disk: `git` needs a full snapshot reload, `worktree` only the status. */
export type ChangeScope = 'git' | 'worktree'

/**
 * Operations on an open repository, invoked through a single IPC channel.
 * Signatures describe the renderer's view: each call resolves to a Result of the return type.
 */
export interface RepoOps {
  status(): WorkingTreeStatus
  diff(source: DiffSource, path: string, oldPath?: string): FileDiff
  commitDetail(hash: string): CommitDetail
  /** Commits that changed a file, newest first, following renames. */
  fileHistory(path: string): FileRevision[]
  /** Who last changed each line of a file, at a commit or in the working tree (null). */
  blame(path: string, rev: string | null): Blame

  stage(paths: string[]): void
  unstage(paths: string[]): void
  stageAll(): void
  unstageAll(): void
  /** Throws away working tree changes; untracked files are deleted. */
  discard(files: FileChange[]): void
  /** Applies a patch built with buildPatch, to the index (`cached`) or the working tree. */
  applyPatch(patch: string, cached: boolean, reverse: boolean): void
  /** Resolves conflicted files with one side, `ours` being HEAD, and stages them. */
  resolveConflict(paths: string[], side: 'ours' | 'theirs'): void
  /** Paths among the given ones that still contain conflict markers. */
  conflictMarkers(paths: string[]): string[]
  /** Returns git's output, including hook output. */
  commit(message: string, amend: boolean): string
  lastCommitMessage(): string
  /** Finishes the operation in progress once conflicts are resolved; a rebase may stop again. */
  continueOperation(): OpOutcome
  /** Cancels the operation in progress, restoring the state before it started. */
  abortOperation(): void
  /** Skips the commit that stopped a rebase, cherry-pick or revert. */
  skipOperation(): OpOutcome
  /** Opens the configured external merge tool (`merge.tool`) on a conflicted file. */
  openMergeTool(path: string): void
  /** Working tree content of a conflicted file, with its conflict markers. */
  readConflictFile(path: string): string
  /** Writes the resolved content of a conflicted file and stages it. */
  saveResolution(path: string, content: string): void

  /** Merges a branch, tag or commit into the current branch. */
  merge(ref: string, mode: MergeMode): OpOutcome
  /** Rebases the current branch onto a branch, tag or commit. */
  rebase(onto: string): OpOutcome
  /** Rewrites the commits after `base` (null: from the root) following the edited todo list. */
  rebaseInteractive(base: string | null, todo: RebaseStep[]): OpOutcome
  /**
   * Commits between `base` (exclusive) and HEAD, oldest first, for the interactive rebase editor;
   * `merges` counts the merge commits in the range, which the rebase flattens.
   */
  rebaseCommits(base: string | null): { commits: RebaseCommit[]; merges: number }
  /** Applies commits on top of HEAD, in the given order. */
  cherryPick(hashes: string[]): OpOutcome
  revert(hash: string): OpOutcome
  /** A hard reset first saves uncommitted changes in a stash: returns its hash, or null. */
  reset(hash: string, mode: ResetMode): string | null

  /** Undoes the last GitDom action; returns its label. */
  undo(): string
  redo(): string

  /** Local changes are stashed before and restored after the checkout, unless `stash` is none. */
  checkout(branch: string, stash: StashMode): void
  checkoutRemote(remoteBranch: string, localName: string, stash: StashMode): void
  checkoutCommit(hash: string, stash: StashMode): void
  createBranch(name: string, startPoint: string | null, checkout: boolean): void
  renameBranch(oldName: string, newName: string): void
  deleteBranch(name: string, force: boolean): void
  /** Moves a branch forward to `to`, refusing when it has commits `to` doesn't contain. */
  fastForwardBranch(branch: string, to: string): void
  /** Whether `ancestor` is reachable from `descendant` (a commit is its own ancestor). */
  isAncestor(ancestor: string, descendant: string): boolean
  deleteRemoteBranch(remote: string, branch: string): void
  setUpstream(branch: string, upstream: string | null): void

  fetch(): void
  /** Local changes are stashed around the pull. */
  pull(mode: PullMode): OpOutcome
  /** Pushes the current branch, setting the upstream on the first push. */
  push(forceWithLease: boolean): string

  addRemote(name: string, url: string): void
  removeRemote(name: string): void
  renameRemote(oldName: string, newName: string): void
  setRemoteUrl(name: string, url: string): void

  stashPush(message: string, includeUntracked: boolean): void
  stashApply(selector: string): void
  stashPop(selector: string): void
  stashDrop(selector: string): void

  createTag(name: string, target: string, message: string | null): void
  deleteTag(name: string): void
  pushTag(remote: string, name: string): void
  deleteRemoteTag(remote: string, name: string): void

  /** Clones missing submodules and checks them out at the recorded commits; all when empty. */
  submoduleUpdate(paths: string[]): string
  /** Stores files matching the pattern with Git LFS, through the root .gitattributes. */
  lfsTrack(pattern: string): void
  lfsUntrack(pattern: string): void
  /** Sets the author identity in the repository (local) or for every repository (global). */
  setIdentity(name: string, email: string, scope: 'local' | 'global'): void
  /** Removes the repository's own identity, falling back to the global one. */
  clearLocalIdentity(): void
}

export type OpName = keyof RepoOps
export type OpArgs<K extends OpName> = Parameters<RepoOps[K]>
export type OpResult<K extends OpName> = ReturnType<RepoOps[K]>

/** A shell the integrated terminal can run. */
export interface ShellInfo {
  id: string
  name: string
}

/** Integrated terminal sessions, running in the main process; they end with the window. */
export interface TerminalApi {
  /** Shells found on this machine, the default first. */
  shells(): Promise<ShellInfo[]>
  /** Starts a shell in `cwd`; resolves the session id. */
  open(cwd: string, shell: string, cols: number, rows: number): Promise<Result<number>>
  write(id: number, data: string): void
  resize(id: number, cols: number, rows: number): void
  close(id: number): void
  onData(listener: (id: number, data: string) => void): () => void
  onExit(listener: (id: number, exitCode: number) => void): () => void
}

export interface CloneOptions {
  url: string
  /** Folder the repository is cloned into, as a new subfolder */
  parent: string
  /** Name of the new subfolder */
  name: string
  /** Branch to check out instead of the remote's default */
  branch?: string
  /** Only the last N commits (shallow clone) */
  depth?: number
  /** Also clone the submodules, recursively */
  recursive: boolean
}

export interface CloneProgress {
  /** git's current phase, e.g. "Receiving objects" */
  phase: string
  /** Overall progress from 0 to 100, null while git hasn't reported any */
  percent: number | null
}

export interface InitOptions {
  /** Folder the repository is created in, as a new subfolder */
  parent: string
  name: string
  defaultBranch: string
  /** Id of a .gitignore template, from GITIGNORE_TEMPLATES */
  gitignore: string | null
  /** Id of a license, from LICENSE_TEMPLATES */
  license: string | null
  readme: boolean
}

export interface InitOutcome {
  path: string
  /** Whether the starter files were committed; it fails without an author identity */
  committed: boolean
}

/** Getting repositories onto the machine: cloning and creating them. */
export interface ReposApi {
  /** Shows a folder picker; resolves null when cancelled. */
  pickFolder(title: string): Promise<string | null>
  /** Clones into parent/name; resolves the path of the new repository. `id` identifies the clone. */
  clone(id: number, options: CloneOptions): Promise<Result<string>>
  /** Stops a clone and deletes what it downloaded; the clone then resolves with an error. */
  cancelClone(id: number): void
  onCloneProgress(listener: (id: number, progress: CloneProgress) => void): () => void
  init(options: InitOptions): Promise<Result<InitOutcome>>
}

/** Settings the main process needs; the renderer owns and saves them, and sends them at startup. */
export interface ToolSettings {
  /** git executable; empty for the one on the PATH (SET-04) */
  gitPath: string
  /** Command line of the external editor, the file path is appended; empty for the system default (DIFF-12) */
  editor: string
  /** Merge tool name for `git mergetool --tool`; empty to use merge.tool from git config (MERGE-08) */
  mergeTool: string
}

export interface MergeToolInfo {
  name: string
  /** git's description, e.g. "Use Visual Studio Code" */
  label: string
  /** Found on this machine */
  available: boolean
}

/** External programs: git itself, the editor, the file manager. */
export interface ToolsApi {
  configure(settings: ToolSettings): void
  /** Runs `git --version` with the given executable (empty: from the PATH). */
  checkGit(gitPath: string): Promise<Result<string>>
  /** Merge tools git knows, for `git mergetool --tool`; terminal-only tools are left out. */
  mergeTools(): Promise<MergeToolInfo[]>
  /** Opens a file of the repository, or the repository folder when `path` is null, in the editor. */
  openInEditor(repo: string, path: string | null): Promise<Result<void>>
  /** Shows a file, or the repository folder, in the system file manager. */
  showInFolder(repo: string, path: string | null): void
  /** Zoom factor of the window, 1 for 100%. */
  setZoom(factor: number): void
}

/** Themes offered in the app and in the Window menu; 'system' follows Windows' light or dark setting. */
export type ThemeChoice = 'dark' | 'light' | 'system' | 'studio'

/** The native menu bar, built in the main process. */
export interface MenuApi {
  /** Tells the menu which theme is applied, to check it in Window > Theme. */
  setTheme(theme: ThemeChoice): void
  /** Subscribes to themes picked from the menu; returns the unsubscribe function. */
  onTheme(listener: (theme: ThemeChoice) => void): () => void
  /** Subscribes to File menu commands; returns the unsubscribe function. */
  onCommand(listener: (command: MenuCommand) => void): () => void
}

/** File menu entries handled by the renderer. */
export type MenuCommand =
  'open' | 'clone' | 'init' | 'preferences' | 'zoomIn' | 'zoomOut' | 'zoomReset'

/** API exposed by the preload script on `window.api`. */
export interface GitDomApi {
  /** Shows a folder picker; resolves null when cancelled. */
  pickRepository(): Promise<string | null>
  /** Resolves the repository root containing `path` and loads its snapshot. */
  openRepository(path: string): Promise<Result<RepoSnapshot>>
  op<K extends OpName>(repoPath: string, name: K, ...args: OpArgs<K>): Promise<Result<OpResult<K>>>
  /** Replaces the set of repositories watched for changes on disk. */
  watch(repoPaths: string[]): void
  /** Subscribes to on-disk changes; returns the unsubscribe function. */
  onRepoChanged(listener: (repoPath: string, scope: ChangeScope) => void): () => void
  repos: ReposApi
  tools: ToolsApi
  terminal: TerminalApi
  menu: MenuApi
}

export const IPC = {
  pickRepository: 'repo:pick',
  openRepository: 'repo:open',
  op: 'repo:op',
  watch: 'repo:watch',
  changed: 'repo:changed',
  terminalShells: 'term:shells',
  terminalOpen: 'term:open',
  terminalWrite: 'term:write',
  terminalResize: 'term:resize',
  terminalClose: 'term:close',
  terminalData: 'term:data',
  terminalExit: 'term:exit',
  menuSetTheme: 'menu:set-theme',
  menuTheme: 'menu:theme',
  menuCommand: 'menu:command',
  pickFolder: 'repos:pick-folder',
  clone: 'repos:clone',
  cloneCancel: 'repos:clone-cancel',
  cloneProgress: 'repos:clone-progress',
  init: 'repos:init',
  toolsConfigure: 'tools:configure',
  toolsCheckGit: 'tools:check-git',
  toolsMergeTools: 'tools:merge-tools',
  toolsOpenInEditor: 'tools:open-in-editor',
  toolsShowInFolder: 'tools:show-in-folder'
} as const
