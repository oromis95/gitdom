import type {
  Backup,
  Blame,
  Commit,
  CommitDetail,
  CommitPreview,
  DiffOptions,
  DiffSource,
  FileChange,
  FileContent,
  FileDiff,
  FileRevision,
  LineRevision,
  GraphFilter,
  ImagePair,
  ReflogEntry,
  RepoSnapshot,
  RepoStatistics,
  Signing,
  StatisticsOptions,
  StatisticsProgress,
  TagInfo,
  TreeFile,
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
export interface CommitsToMove {
  branch: string
  /** Where the branch goes back to: the parent of the first commit moved */
  base: string
  commits: { hash: string; subject: string }[]
  /** Merge commits among them, which only a new branch can take */
  merges: number
}

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
   * (GRAPH-17); author, subject and hash are matched in the renderer. `code` finds the commits
   * that add or remove `text`, `regex` those whose changed lines match it: both ignore case, and
   * a newer search in the changes stops the running one.
   */
  searchCommits(
    field: 'message' | 'file' | 'code' | 'regex',
    text: string,
    filter?: GraphFilter
  ): string[]
  /** Stops the running search in the changes, if any. */
  cancelSearch(): void
  /** The next page of the graph's commits, from `skip` on (GRAPH-08). */
  moreCommits(skip: number, filter?: GraphFilter): { commits: Commit[]; more: boolean }
  commitDetail(hash: string): CommitDetail
  /** Message body and changed files with line counts, for the hover cards (UI-13). */
  commitPreview(hash: string): CommitPreview
  /** Message and tagger of an annotated tag, null for a lightweight one. */
  tagInfo(name: string): TagInfo | null
  /** Commits that changed a file, newest first, following renames. */
  fileHistory(path: string): FileRevision[]
  /**
   * Commits that changed some lines of a file, newest first, with the changes (`git log -L`).
   * `range` is "start,end" or ":function"; line numbers are those of `rev`, or of HEAD when null.
   */
  lineHistory(path: string, range: string, rev: string | null): LineRevision[]
  /** Who last changed each line of a file, at a commit or in the working tree (null). */
  blame(path: string, rev: string | null): Blame
  /**
   * Where a line of a file at a commit was in the version before it (a blame
   * commit's `previous`), to blame that version at the same place.
   */
  lineBefore(
    hash: string,
    path: string,
    previous: { hash: string; path: string },
    line: number
  ): number
  /** Every file of a commit's tree. */
  treeFiles(rev: string): TreeFile[]
  /** A file as stored at a revision, or in the working tree (null), to show it. */
  fileAt(rev: string | null, path: string): FileContent
  /** Writes a file as stored at a revision to `dest`, an absolute path picked by the user. */
  saveFileAt(rev: string, path: string, dest: string): void

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
  /** Shows a file's changes in the external diff tool (DIFF-12); resolves when it closes. */
  openDiffTool(source: DiffSource, path: string, oldPath?: string): void
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
  /**
   * The commits of the current branch from `from` to HEAD, oldest first, that moving
   * them to another branch would take away, and where the branch would go back to.
   */
  commitsToMove(from: string): CommitsToMove
  /**
   * Moves the commits from `from` to HEAD to another branch and takes the current branch
   * back before them. A new branch is created on them (checked out if asked); on an
   * existing one they are cherry-picked, which may stop on conflicts.
   */
  moveCommits(from: string, target: string, create: boolean, checkout: boolean): OpOutcome
  /**
   * Adds the staged changes to a commit of the current branch: the last one is amended,
   * an older one gets a fixup commit squashed into it by an interactive rebase.
   */
  fixup(hash: string): OpOutcome
  /**
   * Splits a commit of the current branch in two: the first gets the given files as the commit
   * changed them, the second the rest. The commits after it are recreated on top, merges
   * included; files, index and working tree are left as they are. Returns the two new commits.
   */
  splitCommit(
    hash: string,
    paths: string[],
    firstMessage: string,
    secondMessage: string
  ): { first: string; second: string }
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
  /** Adds the repository at `url` as a submodule in the folder `path` (ADV-02). */
  submoduleAdd(url: string, path: string): string
  /** Copies the submodule URLs from .gitmodules to the configuration; all when empty. */
  submoduleSync(paths: string[]): string
  /** Adds a pattern to the root .gitignore, and stops tracking the given files (COMMIT-11). */
  ignore(pattern: string, untrack: string[]): void
  /** Stores files matching the pattern with Git LFS, through the root .gitattributes. */
  /**
   * Adds a working tree at `path` (REPO-09): checking out `branch`, creating `newBranch` from
   * `start`, or detached at `start` when neither is given. Resolves the path git used.
   */
  worktreeAdd(options: WorktreeAddOptions): string
  /** Removes a working tree and its folder; `force` also discards its changes. */
  worktreeRemove(path: string, force: boolean): void
  /** Forgets the working trees whose folder is gone. */
  worktreePrune(): void
  /** Locks a working tree against pruning and removal, or unlocks it. */
  worktreeLock(path: string, locked: boolean): void
  lfsTrack(pattern: string): void
  lfsUntrack(pattern: string): void
  /** Downloads the LFS files of the checked-out commit (ADV-03). */
  lfsPull(): string
  /** Uploads every local LFS file the remote lacks. */
  lfsPush(remote: string): string
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

export interface WorktreeAddOptions {
  /** Folder of the new working tree; it must not exist or be empty */
  path: string
  /** Existing branch to check out; a remote branch name creates a local tracking branch */
  branch?: string
  newBranch?: string
  /** Where `newBranch`, or the detached HEAD, starts; HEAD when omitted */
  start?: string
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
  /** Diff tool name for `git difftool --tool`; empty to use diff.tool from git config (DIFF-12) */
  diffTool: string
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
  /** Shows a save dialog for a file named `name`; resolves the chosen path, or null. */
  pickSavePath(title: string, name: string): Promise<string | null>
  /** Zoom factor of the window, 1 for 100%. */
  setZoom(factor: number): void
  /** Entries of the user's (global) or a repository's (local) git configuration (SET-03). */
  configList(scope: ConfigScope, repo: string | null): Promise<Result<ConfigEntry[]>>
  /** Adds an entry (`old` null) or replaces the value `old` of a key. */
  configSet(
    scope: ConfigScope,
    repo: string | null,
    key: string,
    value: string,
    old: string | null
  ): Promise<Result<void>>
  /** Removes one value of a key (a key may have several). */
  configUnset(
    scope: ConfigScope,
    repo: string | null,
    key: string,
    value: string
  ): Promise<Result<void>>
}

export type ConfigScope = 'global' | 'local'

export interface ConfigEntry {
  key: string
  value: string
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
  /** Its SHA-256 (sha256sum format), which the in-app update requires */
  checksumUrl: string | null
  /** Release notes, in Markdown */
  notes: string
  /** Already downloaded and checked in this session: installed at a restart */
  readyToInstall: boolean
}

/** Bytes of the update downloaded so far; `total` is null when GitHub doesn't say. */
export interface UpdateProgress {
  received: number
  total: number | null
}

/** GitDom itself: updates and links. */
export interface AppApi {
  /** The latest release on GitHub. */
  latestRelease(): Promise<Result<ReleaseInfo>>
  /** Opens a page of GitDom's GitHub repository in the browser. */
  openRepoPage(url: string): void
  /** Whether this copy can replace itself: only the portable exe can. */
  canSelfUpdate(): Promise<boolean>
  /** Downloads and checks the release latestRelease() returned; resolves when it's ready. */
  downloadUpdate(): Promise<Result<void>>
  cancelUpdate(): void
  onUpdateProgress(listener: (progress: UpdateProgress) => void): () => void
  /** Puts the downloaded exe in place and restarts GitDom. */
  installUpdate(): Promise<Result<void>>
}

/** Repository statistics, computed in the main process from the whole history. */
export interface StatisticsApi {
  /** Reads the history; a new request for the same repository stops the previous one. */
  load(repo: string, options: StatisticsOptions): Promise<Result<RepoStatistics>>
  /** Stops the statistics being read; load() then resolves with an error. */
  cancel(repo: string): void
  onProgress(listener: (progress: StatisticsProgress) => void): () => void
}

/**
 * A theme offered in the app and in the Window menu: 'dark', 'light', 'studio', 'system' (Windows'
 * light or dark setting), a built-in palette such as 'nord', or one of the user's ('custom-...').
 */
export type ThemeChoice = string

/** An entry of Window > Theme. */
export interface ThemeOption {
  id: ThemeChoice
  label: string
}

/** Keys the menu shows next to its items (Electron accelerators); the renderer handles them. */
export interface MenuShortcuts {
  open: string | null
  preferences: string | null
  zoomIn: string | null
  zoomOut: string | null
  zoomReset: string | null
  activity: string | null
}

/** The native menu bar, built in the main process. */
export interface MenuApi {
  /** Tells the menu the themes to list in Window > Theme, and the one to check. */
  setTheme(theme: ThemeChoice, themes: ThemeOption[]): void
  /** Tells the menu the keys to show, after the user changes them. */
  setShortcuts(shortcuts: MenuShortcuts): void
  /** Subscribes to themes picked from the menu; returns the unsubscribe function. */
  onTheme(listener: (theme: ThemeChoice) => void): () => void
  /** Subscribes to File menu commands; returns the unsubscribe function. */
  onCommand(listener: (command: MenuCommand) => void): () => void
}

/** File menu entries handled by the renderer. */
export type MenuCommand =
  | 'tips'
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
  | 'statistics'
  | 'whatsNew'
  | 'checkUpdates'

/** API exposed by the preload script on `window.api`. */
export interface GitDomApi {
  /** Shows a folder picker; resolves null when cancelled. */
  pickRepository(): Promise<string | null>
  /**
   * Resolves the repository root containing `path` and loads its snapshot, with at least `limit`
   * commits when the graph has loaded more pages.
   */
  openRepository(path: string, filter?: GraphFilter, limit?: number): Promise<Result<RepoSnapshot>>
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
  statistics: StatisticsApi
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
  menuSetShortcuts: 'menu:set-shortcuts',
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
  toolsPickSavePath: 'tools:pick-save-path',
  toolsConfigList: 'tools:config-list',
  toolsConfigSet: 'tools:config-set',
  toolsConfigUnset: 'tools:config-unset',
  activityList: 'activity:list',
  activityClear: 'activity:clear',
  activityEntry: 'activity:entry',
  appLatestRelease: 'app:latest-release',
  appOpenRepoPage: 'app:open-repo-page',
  appCanSelfUpdate: 'app:can-self-update',
  appDownloadUpdate: 'app:download-update',
  appCancelUpdate: 'app:cancel-update',
  appUpdateProgress: 'app:update-progress',
  appInstallUpdate: 'app:install-update',
  statsLoad: 'stats:load',
  statsCancel: 'stats:cancel',
  statsProgress: 'stats:progress'
} as const
