/**
 * Quotes one argument for the shell that runs the editor command: cmd.exe on Windows, /bin/sh
 * elsewhere. The argument is a file name from the repository, so nothing in it may run.
 */
export function shellQuote(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    // `"` can't be in a Windows file name. cmd expands %NAME% even inside quotes: stepping out of
    // the quotes for each % breaks the name, and the caret that keeps it literal goes away
    return `"${arg.replace(/%/g, '"^%"')}"`
  }
  // Inside single quotes sh expands nothing; a quote itself is closed, escaped and reopened
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
