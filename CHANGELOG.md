# Changelog

What's new in each GitDom version. GitDom shows this list after an update (**Help → What's New**), and each GitHub release uses its version's section as release notes.

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
