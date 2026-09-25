// Author identity of each repository, and saved profiles to switch between (e.g. work and personal).
import type { Identity, RepoSnapshot, Signing } from '../../shared/types'
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

const SIGNING_FORMATS: { value: Signing['format']; label: string }[] = [
  { value: 'openpgp', label: 'GPG (OpenPGP)' },
  { value: 'ssh', label: 'SSH key' },
  { value: 'x509', label: 'X.509 certificate (gpgsm)' }
]

/** Sets how commits and tags are signed (COMMIT-09, ADV-09). */
export async function editSigning(snapshot: RepoSnapshot): Promise<void> {
  const { signing } = snapshot
  const values = await showForm({
    title: 'Commit signing',
    message:
      'Signed commits and tags prove they come from you. The key is a GPG key id, or for SSH the path of a public key (e.g. ~/.ssh/id_ed25519.pub); empty uses the default key of your email. Single commits can still be signed or not from the commit options.',
    fields: [
      { key: 'format', label: 'Sign with', options: SIGNING_FORMATS, initial: signing.format },
      {
        key: 'key',
        label: 'Signing key',
        initial: signing.key ?? '',
        placeholder: 'Default key',
        optional: true
      },
      {
        key: 'scope',
        label: 'Apply to',
        options: [
          { value: 'local', label: 'This repository' },
          { value: 'global', label: 'Every repository' }
        ],
        initial: 'local'
      }
    ],
    checks: [
      { key: 'commits', label: 'Sign every commit', initial: signing.commits },
      { key: 'tags', label: 'Sign every annotated tag', initial: signing.tags }
    ],
    confirmLabel: 'Save'
  })
  if (!values) return
  const next: Signing = {
    format: values.format as Signing['format'],
    key: String(values.key).trim() || null,
    commits: !!values.commits,
    tags: !!values.tags
  }
  const scope = values.scope === 'global' ? 'global' : 'local'
  if (!(await run(snapshot.path, 'setSigning', next, scope))) return
  if (scope === 'global') refreshAll()
  notify('success', next.commits ? 'Commits will be signed' : 'Signing settings saved')
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
    { label: 'Remove profile…', disabled: !profiles.length, onClick: () => void removeProfile() },
    'separator',
    {
      label: snapshot.signing.commits ? 'Commit signing (on)…' : 'Commit signing…',
      onClick: () => void editSigning(snapshot)
    }
  ]
}
