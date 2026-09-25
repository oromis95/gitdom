// Author identity of each repository, and saved profiles to switch between (e.g. work and personal).
import type { Identity, RepoSnapshot } from '../../shared/types'
import { run } from './actions'
import { useApp } from './store'
import { notify, showForm, type MenuItem } from './ui'

const PROFILES_KEY = 'gitdom.profiles'
const blank: Identity = { name: null, email: null, scope: null }

export interface Profile {
  name: string
  email: string
}

export function loadProfiles(): Profile[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((p) => p?.name && p?.email) : []
  } catch {
    return []
  }
}

const storeProfiles = (profiles: Profile[]): void =>
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))

const sameProfile = (a: Profile, b: Profile): boolean => a.name === b.name && a.email === b.email

export const describeIdentity = (i: Profile): string => `${i.name} <${i.email}>`

function saveProfile(profile: Profile): void {
  const profiles = loadProfiles()
  if (profiles.some((p) => sameProfile(p, profile))) return
  storeProfiles([...profiles, profile])
  notify('success', `Saved profile ${describeIdentity(profile)}`)
}

/** The global identity applies to every repository without its own: all open tabs refresh. */
function refreshAll(): void {
  const { tabs, refreshPath } = useApp.getState()
  for (const tab of tabs) void refreshPath(tab.path)
}

export async function editIdentity(
  repo: string,
  identity: Identity,
  scope: 'local' | 'global'
): Promise<void> {
  const values = await showForm({
    title: scope === 'local' ? 'Identity for this repository' : 'Global identity',
    message:
      scope === 'local'
        ? 'Used for the commits of this repository only.'
        : 'Used for the commits of every repository without its own identity.',
    fields: [
      { key: 'name', label: 'Name', initial: identity.name ?? '' },
      { key: 'email', label: 'Email', initial: identity.email ?? '' }
    ],
    checks: [{ key: 'save', label: 'Save as profile' }],
    confirmLabel: 'Save'
  })
  if (!values) return
  const profile = { name: String(values.name).trim(), email: String(values.email).trim() }
  if (!(await run(repo, 'setIdentity', profile.name, profile.email, scope))) return
  if (values.save) saveProfile(profile)
  if (scope === 'global') refreshAll()
  notify('success', `Committing as ${describeIdentity(profile)}`)
}

export async function applyProfile(repo: string, profile: Profile): Promise<void> {
  if (await run(repo, 'setIdentity', profile.name, profile.email, 'local')) {
    notify('success', `Committing as ${describeIdentity(profile)} in this repository`)
  }
}

export async function adoptGlobalIdentity(repo: string): Promise<void> {
  if (await run(repo, 'clearLocalIdentity')) notify('info', 'Using the global identity')
}

export async function removeProfile(): Promise<void> {
  const profiles = loadProfiles()
  if (!profiles.length) return
  const values = await showForm({
    title: 'Remove profile',
    fields: [
      {
        key: 'profile',
        label: 'Profile',
        initial: '0',
        options: profiles.map((p, i) => ({ value: String(i), label: describeIdentity(p) }))
      }
    ],
    confirmLabel: 'Remove',
    danger: true
  })
  if (!values) return
  storeProfiles(profiles.filter((_, i) => i !== Number(values.profile)))
}

export function identityMenu(snapshot: RepoSnapshot): MenuItem[] {
  const repo = snapshot.path
  const { identity } = snapshot
  const current =
    identity.name && identity.email ? { name: identity.name, email: identity.email } : null
  const profiles = loadProfiles()
  return [
    ...profiles.map((p) => ({
      label: `Use ${describeIdentity(p)} in this repository`,
      disabled: identity.scope === 'local' && current !== null && sameProfile(p, current),
      onClick: () => void applyProfile(repo, p)
    })),
    ...(profiles.length ? ['separator' as const] : []),
    {
      label: 'Edit identity for this repository…',
      onClick: () => void editIdentity(repo, identity, 'local')
    },
    {
      label: 'Edit global identity…',
      onClick: () =>
        void editIdentity(repo, identity.scope === 'global' ? identity : blank, 'global')
    },
    ...(identity.scope === 'local'
      ? [{ label: 'Use the global identity here', onClick: () => void adoptGlobalIdentity(repo) }]
      : []),
    'separator',
    {
      label: 'Save current identity as profile',
      disabled: !current || profiles.some((p) => sameProfile(p, current)),
      onClick: () => current && saveProfile(current)
    },
    { label: 'Remove profile…', disabled: !profiles.length, onClick: () => void removeProfile() }
  ]
}
