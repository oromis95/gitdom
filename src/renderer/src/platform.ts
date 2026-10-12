// Words that differ by system: where deleted files go, and the program that shows folders.

const platform = typeof window !== 'undefined' ? window.api?.platform : undefined

/** "Recycle Bin" on Windows, "Trash" elsewhere */
export const TRASH = platform === 'win32' || !platform ? 'Recycle Bin' : 'Trash'

/** "Explorer" on Windows, "Finder" on macOS, "File Manager" on Linux */
export const FILE_MANAGER =
  platform === 'darwin' ? 'Finder' : platform === 'win32' || !platform ? 'Explorer' : 'File Manager'

/** An example folder for the placeholders */
export const EXAMPLE_FOLDER =
  platform === 'win32' || !platform
    ? 'C:\\Users\\me\\Projects'
    : platform === 'darwin'
      ? '/Users/me/Projects'
      : '/home/me/Projects'
