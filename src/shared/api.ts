import type {
  Backup,
  Blame,
  CommitDetail,
  DiffOptions,
  DiffSource,
  FileChange,
  FileDiff,
  FileRevision,
  GraphFilter,
  ImagePair,
  ReflogEntry,
  RepoSnapshot,
  Signing,
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

/** How a commit is made (COMMIT-09); unset fields follow the git config. */
export interface CommitOptions {
  /** Skips the pre-commit and commit-msg hooks (--no-verify) */
  noVerify?: boolean
  /** Signs the commit, or not even when commit.gpgsign is set */
  sign?: boolean
  /** Someone else as the author, as "Name <email>"; the committer stays the identity */
  author?: string
}

/** What a stash saves besides the tracked changes (STASH-05). */
export interface StashOptions {
  /** Only the staged changes, leaving the others in the working tree */
  staged?: boolean
  /** Only these files */
  paths?: string[]
}

/** What changed on disk: `git` needs a full snapshot reload, `worktree` only the status. */
export type ChangeScope = 'git' | 'worktree'

/**
 * Operations on an open repository, invoked through a single IPC channel.
 * Signatures describe the renderer's view: each call resolves to a Result of the return type.
 */
export interface RepoOps {
  status(): WorkingTreeStatus
  diff(source: DiffSource, path: string, oldPath?: string, options?: DiffOptions): FileDiff
  /** Both versions of an image file compared by a diff. */
  imagePair(source: DiffSource, path: string, oldPath?: string): ImagePair
  /** Files that differ between two revisions (DIFF-08). */
  compareFiles(from: string, to: string): FileChange[]
  /**
   * Commits of the graph whose full message, or whose changed file paths, contain `text`
   * (GRAPH-17); author, subject and hash are matched in the renderer.
   */
  searchCommits(field: 'message' | 'file', text: string, filter?: GraphFilter): string[]
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
  commit(message: string, amend: boolean, options?: CommitOptions): string
  lastCommitMessage(): string
  /** Content of the commit message template (commit.template), null when none is set. */
  commitTemplate(): string | null
  /**
   * Changes the message of a commit of the current branch (DETAIL-04): the last one is amended,
   * older ones are rewritten with the commits after them.
   */
  reword(hash: string, message: string): OpOutcome
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

  /** Where HEAD, or a branch (full ref name), pointed over time, newest first (ADV-05). */
  reflog(ref: string): ReflogEntry[]
  /** Automatic backups made before resets, rebases and force pushes, newest first (NFR-04). */
  backups(): Backup[]
  /** Moves a local branch back to where a backup saw it; the checked out one keeps local changes. */
  restoreBackup(id: string, ref: string): void
  deleteBackup(id: string): void

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

  stashPush(message: string, includeUntracked: boolean, options?: StashOptions): void
  stashApply(selector: string): void
  stashPop(selector: string): void
  stashDrop(selector: string): void

  /** `sign` signs the tag, which makes it annotated; unset follows tag.gpgsign. */
  createTag(name: string, target: string, message: string | null, sign?: boolean): void
  deleteTag(name: string): void
  pushTag(remote: string, name: string): void
  deleteRemoteTag(remote: string, name: string): void

  /** Clones missing submodules and checks them out at the recorded commits; all when empty. */
  submoduleUpdate(paths: string[]): string
  /** Adds a pattern to the root .gitignore, and stops tracking the given files (COMMIT-11). */
  ignore(pattern: string, untrack: string[]): void
  /** Stores files matching the pattern with Git LFS, through the root .gitattributes. */
  lfsTrack(pattern: string): void
  lfsUntrack(pattern: string): void
  /** Sets the author identity in the repository (local) or for every repository (global). */
  setIdentity(name: string, email: string, scope: 'local' | 'global'): void
  /** Removes the repository's own identity, falling back to the global one. */
  clearLocalIdentity(): void
  /** Sets how commits and tags are signed, in the repository or for every repository. */
  setSigning(signing: Signing, scope: 'local' | 'global'): void
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

/** A git command GitDom ran, for the activity log (UI-09, NFR-07). */
export interface ActivityEntry {
  id: number
  /** Folder git ran in */
  repo: string
  /** The user action it belongs to, e.g. "Push"; null for background work (refreshes, reads) */
  action: string | null
  /** Groups the commands of one action */
  actionId: number | null
  /** git's arguments, with credentials written in URLs hidden */
  args: string[]
  /** Unix timestamp in milliseconds */
  start: number
  duration: number
  /** null when git couldn't be started or was cancelled */
  exitCode: number | null
  /** Succeeded: some commands also succeed with exit codes other than 0 */
  ok: boolean
  /** stdout then stderr, cut to a maximum length */
  output: string
  truncated: boolean
}

/** The activity log, kept in the main process for the whole session. */
export interface ActivityApi {
  list(): Promise<ActivityEntry[]>
  clear(): void
  /** Subscribes to commands as they complete; returns the unsubscribe function. */
  onEntry(listener: (entry: ActivityEntry) => void): () => void
}

/** A GitDom release published on GitHub. */
export interface ReleaseInfo {
  /** e.g. 0.6.0 */
  version: string
  /** Release page */
  url: string
  /** The portable exe, when attached */
  downloadUrl: string | null
  /** Release notes, in Markdown */
  notes: string
}

/** GitDom itself: updates and links. */
export interface AppApi {
  /** The latest release on GitHub. */
  latestRelease(): Promise<Result<ReleaseInfo>>
  /** Opens a page of GitDom's GitHub repository in the browser. */
  openRepoPage(url: string): void
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
  | 'open'
  | 'clone'
  | 'init'
  | 'preferences'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'activity'
  | 'reflog'
  | 'backups'
  | 'whatsNew'
  | 'checkUpdates'

/** API exposed by the preload script on `window.api`. */
export interface GitDomApi {
  /** Shows a folder picker; resolves null when cancelled. */
  pickRepository(): Promise<string | null>
  /** Resolves the repository root containing `path` and loads its snapshot. */
  openRepository(path: string, filter?: GraphFilter): Promise<Result<RepoSnapshot>>
  op<K extends OpName>(repoPath: string, name: K, ...args: OpArgs<K>): Promise<Result<OpResult<K>>>
  /** Replaces the set of repositories watched for changes on disk. */
  watch(repoPaths: string[]): void
  /** Subscribes to on-disk changes; returns the unsubscribe function. */
  onRepoChanged(listener: (repoPath: string, scope: ChangeScope) => void): () => void
  repos: ReposApi
  tools: ToolsApi
  terminal: TerminalApi
  menu: MenuApi
  activity: ActivityApi
  app: AppApi
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
  toolsShowInFolder: 'tools:show-in-folder',
  activityList: 'activity:list',
  activityClear: 'activity:clear',
  activityEntry: 'activity:entry',
  appLatestRelease: 'app:latest-release',
  appOpenRepoPage: 'app:open-repo-page'
} as const
