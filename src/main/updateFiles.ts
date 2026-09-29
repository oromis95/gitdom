// The file side of the in-app update: checksums, and swapping the portable exe for the new one.
// Windows can't overwrite or delete a running exe, but it can rename it: the old one steps aside
// as "<exe>.old", the download takes its name, and the next start removes the old one.
import { existsSync, renameSync, rmSync } from 'fs'

export const oldPathOf = (exe: string): string => `${exe}.old`
export const downloadPathOf = (exe: string): string => `${exe}.download`

/** The hash for `fileName` in a sha256sum listing ("<hash>  <name>" lines), lowercase. */
export function checksumFor(listing: string, fileName: string): string | null {
  for (const line of listing.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (match && match[2] === fileName) return match[1].toLowerCase()
  }
  // A lone hash, without the file name
  const lone = /^\s*([0-9a-fA-F]{64})\s*$/.exec(listing)
  return lone ? lone[1].toLowerCase() : null
}

/**
 * Puts the downloaded exe in place of the running one. If the second rename fails, the first is
 * undone, so the user never ends up without an exe.
 */
export function swapExecutable(exe: string, downloaded: string): void {
  const old = oldPathOf(exe)
  rmSync(old, { force: true })
  renameSync(exe, old)
  try {
    renameSync(downloaded, exe)
  } catch (e) {
    renameSync(old, exe)
    throw e
  }
}

/**
 * Removes what an update leaves behind: the previous exe, once the new one runs, and a download
 * that was interrupted. The previous exe may still be closing: a few attempts, a second apart.
 */
export async function cleanUpAfterUpdate(exe: string, attempts = 30, delay = 1000): Promise<void> {
  try {
    rmSync(downloadPathOf(exe), { force: true })
  } catch {
    // Another GitDom window is downloading it right now
  }
  const old = oldPathOf(exe)
  for (let i = 0; i < attempts && existsSync(old); i++) {
    try {
      rmSync(old, { force: true })
    } catch {
      await new Promise((done) => setTimeout(done, delay))
    }
  }
}
