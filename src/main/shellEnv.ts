// Apps started from the Dock, Finder or a desktop launcher get a minimal PATH (/usr/bin:/bin...),
// without Homebrew's or the user's folders: git, git-lfs, gpg and `code` would not be found. The
// login shell knows the real one; on Windows the PATH is already the user's.
import { execFile } from 'child_process'

const MARK = '__GITDOM_ENV__'

/** The PATH the user's login shell sets up, or null when it can't be read in time. */
export function loginShellPath(shell: string, timeout = 5000): Promise<string | null> {
  return new Promise((done) => {
    // `env` prints the same way in sh, bash, zsh and fish; the marks fence off what the shell's
    // startup files print themselves
    execFile(
      shell,
      ['-ilc', `echo ${MARK}; env; echo ${MARK}`],
      { timeout, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (error, stdout) => {
        const fenced = stdout?.split(MARK)[1]
        const line = fenced?.split('\n').find((l) => l.startsWith('PATH='))
        done(error && !line ? null : (line?.slice(5).trim() ?? null))
      }
    )
  })
}

/** The shell's folders first, then those GitDom already had, each once. */
export function mergePaths(shellPath: string, current: string | undefined): string {
  const folders = [...shellPath.split(':'), ...(current ?? '').split(':')].filter(Boolean)
  return [...new Set(folders)].join(':')
}

/** Gives GitDom, and the git it runs, the user's PATH and a UTF-8 locale. */
export async function adoptShellEnv(): Promise<void> {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const path = await loginShellPath(shell)
  if (path) process.env.PATH = mergePaths(path, process.env.PATH)
  // Without a locale, file names and the terminal lose their accents
  if (!process.env.LANG && !process.env.LC_ALL) process.env.LANG = 'en_US.UTF-8'
}
