# Changelog

What's new in each GitDom version. GitDom shows this list after an update (**Help → What's New**), and each GitHub release uses its version's section as release notes.

## Unreleased

### Added

- **Commits made on the wrong branch**: right-click a commit of the current branch and choose **Move this and later commits to a new branch…** or **…to another branch…**
  - The dialog lists the commits that move, and warns when they are already pushed
  - To a new branch nothing is rewritten; onto an existing branch they are applied on top of it, and conflicts are resolved as for a cherry-pick
  - The current branch goes back to before them; a backup is made first, and **Undo** puts everything back, even after aborting on conflicts
- **Fixup**: forgot something in a commit? Stage it, right-click the commit and choose **Add staged changes to this commit (fixup)…**
  - The last commit is amended; an older one gets the changes and the commits after it are rewritten on top, keeping their messages
  - Unstaged changes are kept aside meanwhile, and **Undo** gives the changes back as staged
- **Split a commit**: right-click a commit of the current branch and choose **Split commit…**, tick the files that go in the first commit and write the two messages
  - The commits after it are recreated on top, merges included; files, staged and unstaged changes are left alone
  - A backup is made first, and **Undo** puts the commit back as it was
- **Reorder commits**: drag a commit of the current branch up or down in the graph; a line shows where it goes, and a confirmation says how many commits are replayed
  - Commits can move back to the last merge, which a rebase would flatten; uncommitted changes are kept aside meanwhile
  - Conflicts are resolved as in a rebase; a backup is made first, and **Undo** puts the old order back
- **Edit a hunk before staging**: **Edit…** in the header of an unstaged hunk opens its lines, to change them before they are staged
  - Leave out a debug line, fix a typo: what gets staged is the edited text, while the file on disk keeps all its changes
  - **Ctrl+Enter** stages, **Reset** starts over; Tab indents
- **Conflict preview**: know before merging or rebasing whether it will stop on conflicts
  - The merge and rebase dialogs say which files will conflict, or that none is expected
  - Beside the branch name, a warning shows when the current branch and main (or master, on the remote when there is one) changed the same lines; click it for the files, and to merge or rebase
  - Worked out with `git merge-tree` (git 2.38 or later), without touching your files
- **Checks before committing**: warnings in the commit panel about what is going to be committed; they never block the commit
  - Passwords, keys and tokens on the added lines (AWS, GitHub, GitLab, Slack, Google, Stripe and more), and files such as `.env` or SSH keys
  - Big files, and binaries over 512 KB that are not stored with Git LFS
  - `console.log`, `debugger` and TODOs left in the changes
  - The message: a summary with a period at the end or too vague, long description lines, and a missing `feat:`/`fix:` type when the recent commits use Conventional Commits
  - Click a file to see its staged changes; dismiss a warning, or turn off its kind from the warning itself or in **Preferences → Git**
- **Tips**: the features that are easy to miss, one at a time, each with a small animation showing how it works and the steps to use it
  - One at startup, and now and then one right after doing something it builds on, such as blaming back in time after opening a blame
  - **Help → Tips** (or "Tips" in the command palette) lists them all; turn them off with the checkbox in the dialog or in **Preferences**

## 1.2.0 — 2026-09-30

### Added

- **Repository statistics** (**View → Statistics**, or "Statistics" in the command palette), shown in place of the graph
  - Commits, authors, active days, lines added and deleted, files and the span of the history
  - An activity calendar for each year, commits per month with the growth of the code, and the hours and days commits are made (in each author's own time zone)
  - Authors with their share of the commits, and the languages of the current version (generated and vendored files don't count)
  - **Hot files**: those changed most, and most recently, where bugs and conflicts tend to be; click one to see its history
  - **Files only one person knows**, and the bus factor: how many people are the main authors of half the files; click a file to see its blame
  - For the current branch or all of them, over all time or the last year, 6 months, 3 months or 30 days
  - Reading a long history can be stopped; results stay until GitDom closes, and a button offers to refresh them when the repository changes
- **History of some lines, or of a function**: in the blame, click the line numbers (Shift+click for a range) and choose **History of these lines**, or use **Function…** and type a function's name
  - Each commit that changed those lines, newest first, with just the part of the diff that touches them; the lines follow the file through edits and renames
  - Long runs of unchanged lines are folded, and open with a click
  - Click a commit to show it, or right-click to see the blame at that commit
- **Search the code**: **Code** beside the graph search finds the commits that added or removed some text, such as when a function was introduced or the last call to it went away
  - With the regex button, the commits whose added or removed lines match a regular expression
  - Case doesn't matter; a search stops as soon as you type something else or clear it
- **Browse the files of a commit**: **All files** in the commit panel shows the whole project as it was then, as a folder tree with sizes and a filter
  - Click a file to read it in the new **File** mode of the file view, with syntax highlighting; images are shown, binary and very large files can be saved
  - **Save as…** writes a file as it was at that commit anywhere on disk; **Latest** switches to the working tree version
  - Right-click a file for its history or its blame at that commit
- **Blame back in time**: the arrow beside a commit in the blame shows the file as it was just before that commit, at the same line, so you can see what was there and who wrote it
  - Go further back as many times as you like; **Back** returns one step at a time, to the line you left
  - **Blame at this commit** also keeps the line in view

## 1.1.0 — 2026-09-29

### Added

- **Update from the app**: when a new version is out, **Update** downloads it in the background with a progress bar, and checks it against the SHA-256 published with the release
  - It's installed when you close GitDom, or right away with **Restart now**
  - The exe keeps its name and folder, so shortcuts and pins keep working; the previous version is removed at the next start
  - If the download fails or GitDom's folder isn't writable, **Download** still opens the release page
  - This version has to be downloaded by hand one last time: from 1.1.0 on, updates come from the app

### Improved

- Every change to GitDom is now checked automatically on GitHub (formatting, lint, types, tests and a build), and a release is published only when the checks pass

## 1.0.0 — 2026-09-28

### Added

- **Themes**: Nord, Dracula, Tokyo Night, Catppuccin Mocha and Latte, Gruvbox Dark, Monokai, Solarized Dark and Light, and high-contrast dark and light, in a gallery in **Preferences → Themes**
- **Your own themes**: start from any theme and change its colors; GitDom checks that text stays readable (WCAG contrast) and warns you when it doesn't. Export and import themes as text through the clipboard
- **Custom shortcuts**: **Preferences → Keyboard** lists every shortcut; give it other keys, remove them, or reset them
- **Full keyboard navigation**
  - `Ctrl+1`, `Ctrl+2` and `Ctrl+3` move between the sidebar, the graph and the details
  - The arrow keys move through the sidebar and the file lists; Enter checks out a branch or opens a diff, `Space` stages or unstages a file
  - `Alt+Down` / `Alt+Up` (or `F7` / `Shift+F7`) jump between the changes of a diff
  - The menu key or `Shift+F10` opens the right-click menu of the selected item
- **Git config editor** (**Preferences → Git config**): see, change, add and remove your global git settings and those of the open repository
- **External diff tool**: open a change in WinMerge, Beyond Compare, VS Code or any tool git knows, from the diff view or the file's menu (choose it in **Preferences → External tools**)
- **Check out a tag** from its menu or with a double-click, to look at that version
- **Discard all changes** button above the unstaged files
- **Submodules**: add one, and sync their URLs from `.gitmodules`
- **Git LFS**: download (`git lfs pull`) and upload (`git lfs push`) the LFS files
- The sidebar shows branches as folders or as a flat list (the button beside the filter); `Ctrl+Alt+F` jumps to the filter
- `Ctrl+P` also opens the command palette

### Improved

- The zoom level is always in the status bar, 100% included
- Keyboard focus is clearly outlined everywhere

## 0.9.0 — 2026-09-28

### Added

- **Histories of any size**: the graph loads the latest 10,000 commits, and older ones as you scroll down, instead of stopping there
  - The status bar shows how many commits are loaded
  - A refresh keeps the commits already loaded

### Improved

- **Big repositories open much faster**: GitDom writes git's commit-graph file when a big repository lacks one, in the background; a repository with a million commits then opens in about a second instead of five
- **Every repository opens faster**: GitDom starts half as many git processes to read a repository, which matters where starting a program is slow (antivirus). Restored tabs load the one on screen first
- **Faster startup**: the diff view, the terminal, the interactive rebase editor and the preferences load the first time they're opened

## 0.8.0 — 2026-09-28

### Added

- **Worktrees**: check out another branch in its own folder and work on both at once, without stashing
  - **Check out in a new worktree…** on a local or remote branch, and **Create worktree here…** on a commit (detached, or on a new branch)
  - A **Worktrees** section in the sidebar, once there's more than one: branch, locked or missing folder, and a hover card; double-click opens it in a tab
  - Lock, unlock, remove (the tab is closed first, and GitDom asks before throwing away changes), and forget the ones whose folder is gone
  - Checking out a branch that another worktree has offers to open that worktree instead
  - Commits made from a terminal in a worktree show up right away
- **Repository switcher**: click the repository name in the toolbar to jump to an open tab, a favorite or a recent repository, with search and the keyboard
- **Workspaces**: save the open tabs under a name and reopen them together, alongside the open tabs or in their place (from the switcher or the command palette)

## 0.7.2 — 2026-09-28

### Added

- **Hover cards**: rest the mouse on something in the graph or the sidebar to see its details (they can be turned off in Preferences)
  - **Authors** (the graph node, the author column, the commit details): picture, name, email, how many commits they made, and when
  - **Commits** (the message): the full message, the branches and tags on it, and the changed files with added and removed lines
  - **Branches and tags**: the upstream branch with the commits to push or pull, the latest commit, and the message of annotated tags
  - **Stashes**: message, date, the commit they were made on, and their files
- Resting the mouse on a date shows how long ago it was

## 0.7.1 — 2026-09-25

### Added

- The changed files of a commit can be shown as a folder tree, like the local changes (the buttons beside "changed files")

### Fixed

- Selecting two commits with Ctrl+click now compares them and lists every changed file, instead of showing only the last commit clicked

## 0.7.0 — 2026-09-25

### Added

- **Commit options** (the sliders button above the message): skip the hooks (`--no-verify`), sign or not, and commit on behalf of another author
- **Signed commits and tags** with GPG, SSH or X.509 keys: set the key and sign by default from the identity menu in the status bar (**Commit signing…**)
  - The commit details show whether the signature is verified, valid with an untrusted key, or bad
  - Annotated tags can be signed from the tag form
- **Edit a commit message** from the commit details (the pencil beside the title), also for older commits on the current branch; the branch is backed up and the change can be undone
- **Commit template**: the message starts from `commit.template`, with its comment lines as a hint; a button reuses the message of a recent commit
- **Add to .gitignore** from a file's right-click menu: that file, every file with its extension, or its folder; tracked files are also removed from the index
- **Stash only some changes**: only the staged ones, or a single file from its right-click menu
- **Stash automatically on checkout**: a preference to carry the local changes to the other branch without asking; merges now carry them across too, like pull and rebase

### Fixed

- File names starting or ending with a dot (like `.gitignore`) were shown with the dot on the wrong side

## 0.6.0 — 2026-09-25

### Added

- **Activity log** (View → Activity Log, Ctrl+Shift+L): every git command GitDom runs, with its duration, exit code and output
  - Commands are grouped by the action that ran them (push, rebase, checkout…); background refreshes are hidden unless you ask for them
  - Passwords and tokens written in URLs are hidden
- **Automatic backups** before a reset, a rebase or a force push (View → Backups)
  - Restore a branch to where it was with one click, or create a new branch from the backup
  - Restoring can itself be undone
- **Reflog** (View → Reflog): where HEAD and each branch pointed over time, to find commits lost after a reset or a rebase
  - Select an entry to see the commit, then create a branch there, check it out or reset to it
- **Update notice**: at startup GitDom checks GitHub for a newer version and shows a link to download it (can be turned off in Preferences)
- **What's New**: this changelog, shown once after an update and from the Help menu

## 0.5.0 — 2026-09-25

### Added

- Search the graph by message, author, SHA or changed file (Ctrl+F), with matches highlighted, Enter to step through them, and an option to list only the matches
- Hide a branch from the graph, or show only one branch, from its right-click menu
- Resizable columns, an optional SHA column, and a menu to hide columns
- Author pictures from Gravatar (or GitHub for its noreply addresses)
- Stashes drawn as nodes on the commits they were made on
- Hover a branch label to highlight its line; a minimap beside the graph marks HEAD, the selection and the search matches

## 0.4.0 — 2026-09-25

### Added

- Unified or split diff view, with the changed words highlighted inside each line
- Diff options: whole file, context lines, ignore whitespace, wrap long lines
- Compare two commits picked in the graph, or a branch or tag with the current branch
- Images compared side by side, overlaid with an opacity slider, or with a swipe

## 0.3.0 — 2026-09-25

### Added

- Preferences window (File → Preferences, Ctrl+,): theme, fonts, text size, zoom, background fetch interval, default pull strategy, git executable, external editor and merge tool
- Zoom with Ctrl+= / Ctrl+- / Ctrl+0 or Ctrl+wheel, shown in the status bar
- Sidebar and detail panel resizable by dragging their edge
- Open a file or the repository in your editor, or show it in Explorer

## 0.2.0 — 2026-09-25

### Added

- Clone from an HTTPS or SSH URL with progress and cancel; options for branch, shallow depth and submodules
- New repository with a `.gitignore` template, a README and a license in a first commit
- Favorite repositories on the start screen

## 0.1.0 — 2026-09-25

First version: commit graph, staging of files, hunks and lines, commit, branches, tags, stashes, merge, rebase and interactive rebase, conflict resolution, cherry-pick, revert, reset, undo and redo, blame and file history, command palette, integrated terminal, tabs, submodules and Git LFS.
