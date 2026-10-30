# Changelog

What's new in each GitDom version. GitDom shows this list after an update (**Help → What's New**), and each GitHub release uses its version's section as release notes.

## Unreleased

### Changed

- A push goes to the remote git would choose: the branch's `pushRemote`, then `remote.pushDefault`, then the remote of its upstream, the only remote, `origin`. With a `pushRemote` other than the upstream's remote (a fork), the branch goes there under its own name and keeps following its upstream
- With several remotes, none of them `origin`, the first push of a branch asks where to push it, also when creating a pull request, instead of picking the first remote
- A push follows `push.default` as git does. A branch following one with another name, like a branch created from `origin/main`, no longer pushes onto it: as git refuses, GitDom asks whether to push to a branch of its own name (proposed, and followed from then on) or to the upstream. With `push.default=upstream` it goes to the upstream, with `current` to a branch of the same name
- The Pull button follows git's settings (`pull.rebase`, `pull.ff`, the branch's `rebase`), merging when none is set: the new first choice of the Pull menu, **Pull (as set in git)**, and the default. A way picked in the menu or in Preferences still goes first, as an option of `git pull` would
- Rewording a commit runs the commit hooks, as git does: `commit-msg` can check the new message or complete it. If a hook refuses it, nothing is changed

## 1.16.0 — 2026-10-28

### Added

- Pull requests of Bitbucket Data Center (once Bitbucket Server), like the other services': in the sidebar, on the branches of the graph and in their own view, with their changes in GitDom's diff; create, merge, close and reopen them, ask for reviews, mark them as drafts, check them out, also from forks
- The repository is recognized by its address (`https://<server>/scm/<project>/<repository>.git`, or SSH on port 7999), with nothing to set; **Connect** uses the username and password (or token) Git Credential Manager keeps for the server, or an HTTP access token you paste
- The merge checks that keep a pull request from being merged (approvals, builds, tasks) say why in its view; merging offers the strategies the repository allows, and merging by itself where auto-merge is on
- A new pull request gets the repository's default reviewers too, as on Bitbucket's own page

## 1.15.1 — 2026-10-28

### Changed

- The startup animation tells a story: the cars come in all together, overtake one another and brake, with their brake lights on, until a light runs over the road and puts each one in its place. While a repository opens, new cars keep coming in and getting in a row
- With reduced motion asked by the system, the logo of the loading screen stands still

## 1.15.0 — 2026-10-28

### Added

- Create pull requests (merge requests on GitLab) on GitHub, GitLab, Bitbucket and Azure DevOps: from the **+** of the Pull Requests section, a branch's menu, the command palette, or the toast after pushing a branch without one. The target branch, the title, the repository's description template, reviewers, labels and draft are proposed, with the commits it brings; an unpublished branch is pushed first
- Merge a pull request with the methods the repository allows, a commit message, deleting the source branch, or merging by itself once it can; GitDom then offers to switch to the target branch, pull it, and delete the local branch
- Check out a pull request, or open it in a worktree: a branch following its branch, or from a fork the fork added as a remote, or its commits on a branch of their own
- Ask for reviews, edit the title and description, mark ready for review or back to draft, close and reopen, from the pull request's view
- The toasts can have a button, like **Create pull request** after a push

## 1.14.0 — 2026-10-28

### Added

- Pull requests of Bitbucket Cloud and Azure DevOps (also Azure DevOps Server), like GitHub's and GitLab's: in the sidebar, on the branches of the graph and in their own view, with their changes fetched from the source branch, also from a fork
- Azure DevOps: the reviewers' votes, the pull request's statuses and build policies as its checks, and the other policies (reviewers, comments, work items) as the reason it can't be merged yet; Git Credential Manager's token is used when it has one
- Bitbucket: approvals and changes requested, build statuses as checks, conflicts found in the pull request's view; connect with an API token and your Atlassian account's email, or Git Credential Manager's token when it can read pull requests

### Changed

- People whose login is an email (Azure DevOps) are shown by their name

## 1.13.0 — 2026-10-27

### Added

- Pull requests of GitHub and GitLab (merge requests), also on GitHub Enterprise and self-managed GitLab: **Connect** in the new **Pull Requests** section of the sidebar uses the token Git Credential Manager already keeps for the host, or a token you paste, kept encrypted
- The sidebar lists the open pull requests in **Mine**, **Review requested** and **Others**, with their checks, comments and your review, and keeps them up to date
- The branch of a pull request shows a badge on the graph with its number, its state and its checks; resting the mouse on it shows the reviewers, the failing checks and whether it can be merged
- Open a pull request to read its description, conversation, reviewers, checks and commits in place of the graph; its changes are fetched and listed in the detail panel, to read in GitDom's diff
- **Preferences → Accounts**: the connected accounts, the badges on or off, and servers of your own

## 1.12.0 — 2026-10-26

### Added

- Right-click a tab to close it, **Close others**, **Close tabs to the right**, **Close tabs to the left** or **Close all**, or to copy its path or show it in its folder; **Close other tabs** and **Close all tabs** are in the command palette too
- A repository opens in a new tab at once, with an animation while its history is read, instead of nothing happening for a few seconds
- Push shows its progress: a bar under the toolbar fills as git counts, compresses and sends the objects, the status bar shows the phase, the amount sent and the speed, and the Push button the percentage. Fetch, pull and the other long operations show a moving bar

### Changed

- Statistics: in **Hot files** and **Files only one person knows**, each file shows its name in full, with its folder beneath, and both lists take the whole width
- **Split commit**, **Repository Health**, **Ignored Files** and **Clean Up** show each file's name in full too, above its folder, instead of cutting long paths before the name
- The commit panel lists the changed files under **Changed Files**, as a list or a folder tree, without the tabs above them

### Fixed

- **Ignored Files** lists the files of a folder ignored by a rule like `*.log`: it counted them but showed nothing

### Removed

- **All files** in the commit panel, and its tip: a file as it was at a commit is still in the file inspector (**File**, beside History and Blame), with **Save as…**

## 1.11.1 — 2026-10-19

Version 1.11.0 was never published: this release also brings everything listed under it.

### Fixed

- In a narrow window, the bars above a diff, the merge tool and the time-lapse go on two lines instead of hiding their last buttons, such as Close, under the detail panel

## 1.11.0 — 2026-10-19

### Added

- **Export and import your settings** (**File → Export Settings…** and **Import Settings…**, or the command palette): themes, shortcuts, profiles, workspaces and preferences in one file, to keep or to take to another computer

### Changed

- Settings are saved in a file, `settings.json` in GitDom's folder (`%APPDATA%\GitDom` on Windows), instead of the browser storage of the interface; the first start of this version moves them over by itself, and an older GitDom still finds its own
- The time-lapse and the statistics are computed in a thread of their own: while a long history is read, GitDom keeps answering, instead of freezing until it's done
- Under the hood: smaller interface files (the graph, the file inspector, the statistics, the tips) and styles in one file per feature, without changing how anything looks; end-to-end tests for staging lines and hunks, stashing one file, cherry-picking, interactive rebase, reordering commits by dragging, the merge tool and merging by dragging a branch

## 1.10.0 — 2026-10-13

### Added

- **Time-lapse of a file**: drag a timeline under the code and watch the file change version by version, with who changed each line and when (**Time-lapse** in the file inspector, on a file's right-click menu, beside a diff, or in the command palette)
  - Every version is read at once, so moving along the timeline is instant; ← and → step one commit (Shift for ten), Home and End go to the first and the last
  - Recent changes stand out and fade as the timeline moves on; the lines a commit removed stay in sight, in red, where they were
  - Click a line to anchor it: it stays in place on screen while you scrub, and the timeline marks the versions that have it
  - Search the history of the file as you type: the timeline marks the commits that add or remove lines with the text, or whose message, author or hash has it; Enter and F3 go to the next one
  - Tags on the timeline; bookmark a version (M), jump back and forth with ', and open the bookmark and the version shown in your diff tool
  - The uncommitted changes are the last step, and the commit detail follows the timeline

## 1.9.1 — 2026-10-12

Version 1.9.0 was never published: this release also brings everything listed under it.

### Fixed

- On Linux and macOS, git and the other tools on your shell's `PATH` are found even when your shell is a plain `sh`, such as Debian and Ubuntu's dash

## 1.9.0 — 2026-10-12

### Added

- **Credentials in GitDom**: when git needs a username with a password or token, the passphrase of an SSH key, or asks whether to trust a server seen for the first time, GitDom asks in a dialog instead of failing
  - The username and the password are asked together, once
  - Your credential helper keeps them, if you have one; GitDom stores nothing
  - The periodic fetch never asks: when it needs credentials it says so once, and **Fetch all** asks
- **macOS and Linux** versions on the Releases page: a disk image for Apple Silicon and one for Intel Macs, an AppImage and a deb for Linux
  - On macOS the shortcuts use ⌘ and show as ⌘⇧P, GitDom has its app menu, and ⌘+click picks several commits
  - Git, Git LFS, GPG and editors installed with Homebrew or on your shell's `PATH` are found
  - The terminal offers zsh, bash and fish; Control+C and Control+V go to the shell, ⌘C and ⌘V copy and paste
  - Hooks without the executable bit, which git skips, are marked, with a button to make them executable
  - Trash and Finder (or File Manager) where Windows says Recycle Bin and Explorer
  - When a new version is out, **Download** gets the file for your system
- Ten more **tips**, each with its animation, for the less obvious features: comparing two branches, showing only one branch, editing a hunk before staging it, the conflicts-with-main warning, worktrees, bisect, patches, the branches overview, the workspace dashboard and What I did
  - Each shows up once by itself, right after something it builds on (a checkout, a fetch, a push…), or from **Help → Tips**

### Changed

- Safer: the interface runs in Chromium's sandbox and can't be navigated away from GitDom, and the name of a file opened in the external editor is quoted, so nothing in it can run as a command
- Tests at every push now run on Windows, Linux and macOS, and include end-to-end tests that drive the app
- The tip on the history of a few lines, and the hint above the blame, now tell you to click **History of these lines** once the lines are picked

## 1.8.0 — 2026-10-05

### Added

- **Windows installer** (`GitDom-<version>-setup.exe`) next to the portable exe on the Releases page
  - Installs for your user only, without administrator rights, with Start menu and desktop shortcuts
  - Starts quicker than the portable exe, which unpacks itself at every start
  - Updates itself like the portable exe: the new installer runs silently when you close GitDom, or right away with **Restart now**
  - Settings, tabs and themes are the same as the portable exe's

### Changed

- Faster start
  - The graph of the tab on screen shows up in about half the time
  - Tabs from the last session load one at a time, when GitDom is idle, or as soon as you open them
  - Fewer git processes before the first graph; the terminal's helpers load only when you open it
  - The portable exe is smaller, so it has less to unpack at every start

### Removed

- Five built-in themes that looked like others; if you used one, GitDom switches you to the closest:
  - Tokyo Night and Catppuccin Mocha → Dark
  - Catppuccin Latte → Light
  - Dracula → Studio
  - Monokai → Nord

## 1.7.0 — 2026-10-02

### Added

- **What I did** (**View → What I Did**, or the command palette): your commits in every repository GitDom knows, day by day
  - This week, last week, or the last 7 or 30 days; on any branch, merges and stashes left out
  - Yours are those with the repository's author email or the address of one of your identity profiles, so work and personal addresses both count
  - **Copy as text** or **Copy as Markdown** for a standup or a report; click a commit to open it in the graph

## 1.6.1 — 2026-10-02

Version 1.6.0 was never published: this release also brings everything listed under it.

### Added

- **Workspace dashboard** (**View → Workspace Dashboard**, the command palette, or **Dashboard** on the welcome screen): all your repositories in one look
  - The open tabs, saved workspaces, favorites and recent ones, each with its branch, commits ahead and behind, changes, stashes and its last commit; a merge or rebase in progress, conflicts and folders that are gone stand out
  - **Fetch all**, a few repositories at a time; **Pull** fast-forwards a branch that is only behind, with nothing local to lose
  - Show one workspace or the open tabs only, or only the repositories that need attention; click one to open it

### Fixed

- Checking for updates no longer fails with "403 rate limit exceeded" when many people share one internet address, as in an office: GitDom then reads the latest release from the GitHub website instead of its API

## 1.6.0 — 2026-10-02

### Added

- **Find where a problem started (bisect)**: right-click a commit with the problem and choose **Find where a problem started**, then mark one where it wasn't there yet as good
  - A bar above the graph says which commit is checked out to test and how many steps are left; answer **Good**, **Bad** or **Skip** until GitDom names the commit that brought the problem in, then go back to the branch with one click
  - **Automate…** lets a command test each commit, such as `npm test`: exit code 0 is good, 125 skips the commit, any other is bad
  - The marked commits are labelled in the graph, and a bisect started in the terminal shows up too
- **Patches**: save commits or uncommitted changes as a `.patch` file, and apply patch files
  - **Save as patch…** and **Copy as patch** in a commit's menu; several commits picked with `Ctrl`+click make one numbered patch; the uncommitted or staged changes from the command palette
  - **File → Apply Patch…**, or drop a `.patch` file on the window: its commits, files and whether it still applies are shown first
  - Apply it **as commits**, keeping their authors and messages (`git am`, three-way, undoable), **to the working tree**, or **staged**; conflicts are resolved like those of a rebase
- **Two new themes that restyle the controls too**
  - **Retro 2000**: grey raised buttons, sunken white fields, navy title bars on the dialogs, property-sheet tabs, Tahoma and the old scroll bars
  - **Matrix**: green on black, monospaced, glowing text and monitor lines, green graph lanes and falling code on the welcome screen

## 1.5.0 — 2026-10-01

### Added

- **Three new layout themes**, which change where the panels go and not just the colors (**Preferences → Themes**, **Window → Theme** or the command palette)
  - **Focus**: just the graph, with one slim bar of icons; the branches slide in from the left and the detail opens beside the graph when you select a commit
  - **Mail**: three columns on a light background: the branches as folders, the commits as a list, and a wide reading pane where diffs open too
  - **IDE**: the graph on top, and a resizable panel at the bottom with the detail and the diff side by side, in the colors of a code editor
- The theme previews show how each layout theme arranges its panels
- **Hooks** (**View → Hooks**): every git hook of the repository, with when git runs it and whether it is on
  - Read and edit the scripts, start from the example git ships, turn a hook off without losing it and back on, or delete it
  - **Run** tries a hook that needs no arguments, such as pre-commit, and shows whether git would carry on and what it printed
  - A warning when a tool such as Husky or Lefthook writes the hooks, or when `core.hooksPath` points elsewhere

## 1.4.0 — 2026-10-01

### Added

- **Branches overview** (**View → Branches Overview**, or the list button on the Local section): every local branch with its last commit, age, and how many commits it is ahead and behind main
  - Branches merged into main are marked, even when they landed as a squash or a rebase; those not touched for 90 days and those whose upstream is gone have their own filters
  - Compare with any other branch, sort by name, age, ahead or behind, and click a row to show the branch in the graph
  - **Choose merged**, then delete the ticked branches at once: the current branch, main and those checked out in a worktree are kept, a backup is made first and **Undo** brings them back
- **Repository health** (**View → Repository Health**): how much the history takes on disk, packed and loose, LFS included, and the number of commits
  - The heaviest files in the history, with whether each is in the last commit, an older version, or a deleted file that still takes space
  - **Compress** (`git gc`) is suggested when there are many loose objects or packs, and says what it packed and freed; **Prune** removes unreachable objects older than two weeks
  - **Check** (`git fsck`) lists missing or damaged objects, if any

### Fixed

- Release notes list the commits in the order of the history, also when some were made in the same second

## 1.3.0 — 2026-10-01

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
- **Release notes**: right-click a tag and choose **Release notes…**, or "Release notes" in the command palette for what changed since the last tag
  - The commits between two tags, merges and fixups left out, grouped as breaking changes, features, fixes, performance, refactoring, documentation and so on
  - Grouped by the Conventional Commits prefix (`feat:`, `fix(scope):`, `!` and `BREAKING CHANGE`) when there is one, by the first word of the summary otherwise ("Add…", "Fix…")
  - The range starts from the previous tag and can be changed; add the hashes and the authors if you like, then copy the Markdown
- **Why is this file ignored?**: **View → Ignored Files**, or "Ignored files" in the command palette
  - Type a path to see the rule that decides it: the pattern, and the file and line it comes from (a `.gitignore`, `.git/info/exclude` or the global excludes file); click the file to open it
  - A `!` rule that brings the file back is shown too, and a file that matches a rule but is still tracked can stop being tracked from there, staying on disk
  - Below, every ignored file and folder of the working tree with its rule; click one to see why
- **Clean up the working tree**: **View → Clean Up Untracked Files…**, the eraser beside the unstaged files, or "Clean up" in the command palette
  - Untracked files, ignored ones (build output, dependencies, logs) or both, listed with their size before anything is removed; untick what to keep, or filter by name
  - They go to the Recycle Bin by default, where they can be restored; deleting for good asks once more
  - Repositories inside the working tree are left alone, and so are the ignored files in a folder when cleaning only the untracked ones
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
