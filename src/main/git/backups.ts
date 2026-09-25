// Automatic backups of branches before operations that rewrite or overwrite history (NFR-04):
// resets, rebases and force pushes. A backup keeps its commits with refs under refs/gitdom/backups,
// which garbage collection respects, and is described in a file in the git directory.
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import type { Backup } from '../../shared/types'
import { runGit, tryGit } from './exec'

/** Kept out of the graph by logRevisions */
export const BACKUP_REFS = 'refs/gitdom/backups/'
const FILE = 'gitdom-backups.json'
const MAX_BACKUPS = 50

type Saved = Omit<Backup, 'refs'> & { refs: { name: string; hash: string }[] }

async function backupsFile(repo: string): Promise<string> {
  return resolve(repo, (await runGit(repo, ['rev-parse', '--git-path', FILE])).trim())
}

async function load(repo: string): Promise<Saved[]> {
  try {
    const saved = JSON.parse(await readFile(await backupsFile(repo), 'utf8'))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

async function save(repo: string, backups: Saved[]): Promise<void> {
  await writeFile(await backupsFile(repo), JSON.stringify(backups))
}

const backupRef = (id: string, index: number): string => `${BACKUP_REFS}${id}/${index}`

async function removeRefs(repo: string, backup: Saved): Promise<void> {
  for (const i of backup.refs.keys())
    await tryGit(repo, ['update-ref', '-d', backupRef(backup.id, i)])
}

let lastId = 0

/** Saves where the given refs point; skips missing ones, and returns null when none exists. */
export async function createBackup(
  repo: string,
  label: string,
  refs: string[]
): Promise<Saved | null> {
  const saved: Saved['refs'] = []
  for (const name of refs) {
    const hash = (await tryGit(repo, ['rev-parse', '-q', '--verify', `${name}^{commit}`]))?.trim()
    if (hash) saved.push({ name, hash })
  }
  if (!saved.length) return null

  // Ids are timestamps, bumped when two backups are made within the same millisecond
  lastId = Math.max(Date.now(), lastId + 1)
  const backup: Saved = { id: String(lastId), label, date: Date.now(), refs: saved }
  for (const [i, ref] of saved.entries()) {
    await runGit(repo, ['update-ref', backupRef(backup.id, i), ref.hash])
  }
  const backups = [...(await load(repo)), backup]
  for (const old of backups.splice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
    await removeRefs(repo, old)
  }
  await save(repo, backups)
  return backup
}

async function currentRefs(repo: string): Promise<Map<string, string>> {
  const output = await runGit(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])
  const refs = new Map<string, string>()
  for (const line of output.split('\n')) {
    const space = line.lastIndexOf(' ')
    if (space > 0) refs.set(line.slice(0, space), line.slice(space + 1))
  }
  return refs
}

/** Backups newest first, with where each ref points now. */
export async function listBackups(repo: string): Promise<Backup[]> {
  const [backups, refs] = await Promise.all([load(repo), currentRefs(repo)])
  return backups
    .filter((b) => b.refs.every((_, i) => refs.has(backupRef(b.id, i))))
    .reverse()
    .map((b) => ({ ...b, refs: b.refs.map((r) => ({ ...r, current: refs.get(r.name) ?? null })) }))
}

export async function deleteBackup(repo: string, id: string): Promise<void> {
  const backups = await load(repo)
  const backup = backups.find((b) => b.id === id)
  if (!backup) return
  await removeRefs(repo, backup)
  await save(
    repo,
    backups.filter((b) => b !== backup)
  )
}

/** Drops a backup whose operation changed none of its refs, e.g. a reset to the same commit. */
export async function dropIfUnchanged(repo: string, backup: Saved): Promise<void> {
  const refs = await currentRefs(repo)
  if (backup.refs.every((r) => refs.get(r.name) === r.hash)) await deleteBackup(repo, backup.id)
}

/** The commit a backup saved for a ref, checking the backup still holds it. */
export async function backedUpCommit(repo: string, id: string, ref: string): Promise<string> {
  const backup = (await load(repo)).find((b) => b.id === id)
  const index = backup?.refs.findIndex((r) => r.name === ref) ?? -1
  if (!backup || index < 0) throw new Error('This backup no longer exists')
  const hash = (await tryGit(repo, ['rev-parse', '-q', '--verify', backupRef(id, index)]))?.trim()
  if (hash !== backup.refs[index].hash) throw new Error('This backup no longer exists')
  return hash
}
