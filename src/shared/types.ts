// Types shared between the main process (git layer) and the renderer.

export interface Commit {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  /** Unix timestamp in seconds */
  authorDate: number
  subject: string
}

export type RefType = 'local' | 'remote' | 'tag'

export interface Ref {
  /** Full ref name, e.g. refs/heads/feature/x */
  fullName: string
  /** Display name, e.g. feature/x or origin/feature/x */
  name: string
  type: RefType
  /** Commit the ref points to (peeled for annotated tags) */
  hash: string
  /** Remote name, only for remote refs */
  remote?: string
  /** Upstream short name, only for local branches */
  upstream?: string
  ahead?: number
  behind?: number
}

export interface Stash {
  hash: string
  /** e.g. stash@{0} */
  selector: string
  message: string
  /** Commit the stash was made on: its node hangs from it in the graph (STASH-03) */
  base: string
  /** Unix timestamp in seconds */
  date: number
}

/** A reflog entry (ADV-05): where a ref pointed after a command moved it. */
export interface ReflogEntry {
  hash: string
  /** Unix timestamp in seconds of the move */
  date: number
  /** What moved the ref, e.g. "checkout", "commit (amend)", "reset" */
  action: string
  /** git's description of the move, e.g. "moving from main to feature" */
  message: string
  /** Subject of the commit the ref pointed to */
  subject: string
}

/** Where branches pointed before an operation that rewrites or overwrites history (NFR-04). */
export interface Backup {
  id: string
  /** The operation, e.g. "Rebase onto main" */
  label: string
  /** Unix timestamp in milliseconds */
  date: number
  refs: BackupRef[]
}

export interface BackupRef {
  /** Full ref name, e.g. refs/heads/main or refs/remotes/origin/main */
  name: string
  /** Commit it pointed to when the backup was made */
  hash: string
  /** Commit it points to now, null once deleted */
  current: string | null
}

/** Branches left out of the graph (GRAPH-14), as full ref names */
export interface GraphFilter {
  /** Refs whose commits are hidden, unless another ref reaches them */
  hidden: string[]
  /** When set, only the commits of this ref are shown */
  solo: string | null
}

export interface Remote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type RepoOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export interface HeadInfo {
  /** Current branch short name, null when detached or unborn */
  branch: string | null
  /** Commit HEAD points to, null in an empty repository */
  hash: string | null
}

export type FileStatusCode = 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?' | 'T'

export interface FileChange {
  path: string
  /** Original path for renames/copies */
  oldPath?: string
  status: FileStatusCode
}

export interface WorkingTreeStatus {
  staged: FileChange[]
  unstaged: FileChange[]
}

export interface RepoSnapshot {
  path: string
  name: string
  head: HeadInfo
  commits: Commit[]
  refs: Ref[]
  stashes: Stash[]
  remotes: Remote[]
  status: WorkingTreeStatus
  /** Operation in progress (merge, rebase…), null when idle */
  operation: RepoOperation | null
  /** Labels of the actions GitDom can undo and redo */
  history: { undo: string | null; redo: string | null }
  /** True when the commit list was truncated to the load limit */
  truncated: boolean
  submodules: Submodule[]
  lfs: LfsInfo
  identity: Identity
  signing: Signing
}

export interface CommitDetail {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: number
  committerName: string
  committerDate: number
  subject: string
  body: string
  /** null when the commit isn't signed */
  signature: Signature | null
  files: FileChange[]
}

export type DiffLineType = 'context' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldNo?: number
  newNo?: number
  /** Followed by the "\ No newline at end of file" marker */
  noNewline?: boolean
}

export interface Hunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  binary: boolean
  /** Set when the whole file is created or deleted: only file-level staging applies */
  change?: 'added' | 'deleted'
  /** Unmerged file: compared with HEAD, so the conflict markers show as added lines */
  conflicted?: boolean
  hunks: Hunk[]
}

/** Which version of a file a diff compares. */
export type DiffSource =
  | { kind: 'unstaged' }
  | { kind: 'untracked' }
  | { kind: 'staged' }
  | { kind: 'commit'; hash: string }
  /** Any two revisions (commits, branches, tags), from `from` to `to` (DIFF-08) */
  | { kind: 'compare'; from: string; to: string }

/** How a diff is computed (DIFF-04, DIFF-05). */
export interface DiffOptions {
  ignoreWhitespace?: boolean
  /** Lines of context around changes; a huge value shows the whole file */
  context?: number
}

/** The two versions of an image, as data URLs; null where the file doesn't exist (DIFF-06). */
export interface ImagePair {
  before: string | null
  after: string | null
}

/** A commit in the history of a file, with the file's path in that commit (renames change it). */
export interface FileRevision extends Commit {
  path: string
  /** Path before a rename in this commit */
  oldPath?: string
  /** Undefined for merges, which git logs without a file list */
  status?: FileStatusCode
}

export interface BlameCommit {
  hash: string
  authorName: string
  authorEmail: string
  authorDate: number
  summary: string
  /** Path of the file in this commit */
  path: string
  /** The version before this commit changed the line: blaming it goes back in time */
  previous?: { hash: string; path: string }
  /** Not committed yet: the working tree version of the line */
  uncommitted: boolean
}

export interface BlameLine {
  hash: string
  /** Line number in the blamed version, starting at 1 */
  lineNo: number
  text: string
}

export interface Blame {
  path: string
  commits: Record<string, BlameCommit>
  lines: BlameLine[]
}

/**
 * uninitialized: not cloned yet; clean: at the commit the repository records;
 * moved: checked out at another commit; conflict: unmerged in a merge
 */
export type SubmoduleState = 'uninitialized' | 'clean' | 'moved' | 'conflict'

export interface Submodule {
  name: string
  path: string
  url: string
  /** Commit checked out, or recorded when not initialized */
  hash: string
  state: SubmoduleState
}

export interface LfsInfo {
  /** Whether the git-lfs extension is available */
  installed: boolean
  /** Patterns tracked in the root .gitattributes */
  patterns: string[]
}

/** Author identity for new commits, and the configuration level it comes from. */
export interface Identity {
  name: string | null
  email: string | null
  /** local when the repository overrides the global identity */
  scope: 'local' | 'global' | 'system' | null
}

/** How commits and tags are signed (COMMIT-09, ADV-09), from the git config. */
export interface Signing {
  /** gpg.format: openpgp (GPG), ssh or x509 */
  format: 'openpgp' | 'ssh' | 'x509'
  /** user.signingkey: a GPG key id, or an SSH public key or its path; null for the default */
  key: string | null
  /** commit.gpgsign: every commit is signed */
  commits: boolean
  /** tag.gpgsign: every annotated tag is signed */
  tags: boolean
}

/**
 * Verification of a commit signature (DETAIL-05): good, good but made with a key not known to be
 * trusted, bad (the commit was changed), expired, made with a revoked key, or not checkable (the
 * key is missing).
 */
export type SignatureStatus = 'good' | 'untrusted' | 'bad' | 'expired' | 'revoked' | 'unknown'

export interface Signature {
  status: SignatureStatus
  /** Who signed, when git could tell */
  signer: string
  /** Key id or fingerprint */
  key: string
}
