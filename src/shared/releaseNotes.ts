// Release notes from the commits between two tags, grouped by type: from the Conventional Commits
// prefix when there is one, from the first word of the summary otherwise.

export interface ReleaseCommit {
  hash: string
  subject: string
  body: string
  author: string
}

export interface ReleaseGroup {
  title: string
  items: { hash: string; scope?: string; text: string; author: string }[]
}

const GROUPS = [
  'Breaking changes',
  'Features',
  'Fixes',
  'Performance',
  'Refactoring',
  'Documentation',
  'Tests',
  'Build and CI',
  'Reverts',
  'Chores',
  'Other changes'
] as const
type GroupTitle = (typeof GROUPS)[number]

const TYPES: Record<string, GroupTitle> = {
  feat: 'Features',
  feature: 'Features',
  fix: 'Fixes',
  bugfix: 'Fixes',
  hotfix: 'Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  docs: 'Documentation',
  doc: 'Documentation',
  test: 'Tests',
  tests: 'Tests',
  build: 'Build and CI',
  ci: 'Build and CI',
  revert: 'Reverts',
  chore: 'Chores',
  style: 'Chores',
  deps: 'Chores'
}

/** First words of summaries without a type, and where they go */
const VERBS: [RegExp, GroupTitle][] = [
  [/^(?:add|adds|added|implement|introduce|new|support|allow|enable|create)\b/i, 'Features'],
  [/^(?:fix|fixes|fixed|correct|resolve|repair|prevent|handle)\b/i, 'Fixes'],
  [/^(?:speed up|faster|optimi[sz]e|cache)\b/i, 'Performance'],
  [/^(?:refactor|rename|move|extract|simplify|clean ?up|reorganize)\b/i, 'Refactoring'],
  [/^(?:docs?|document|readme|changelog)\b/i, 'Documentation'],
  [/^(?:test|tests)\b/i, 'Tests'],
  [/^revert\b/i, 'Reverts'],
  [/^(?:bump|update dependencies|upgrade|release|version)\b/i, 'Chores']
]

const CONVENTIONAL = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i

/** Commits that only exist to be squashed say nothing to the reader */
const NOISE = /^(?:fixup|squash|amend)! /

/** The commits grouped in the usual order of release notes; empty groups are left out. */
export function groupCommits(commits: ReleaseCommit[]): ReleaseGroup[] {
  const groups = new Map<GroupTitle, ReleaseGroup['items']>()
  for (const c of commits) {
    const subject = c.subject.trim()
    if (!subject || NOISE.test(subject)) continue
    const m = CONVENTIONAL.exec(subject)
    let group: GroupTitle
    let scope: string | undefined
    let text = subject
    if (m && TYPES[m[1].toLowerCase()]) {
      group = TYPES[m[1].toLowerCase()]
      scope = m[2]?.trim() || undefined
      text = m[4]
      if (m[3]) group = 'Breaking changes'
    } else {
      group = VERBS.find(([re]) => re.test(subject))?.[1] ?? 'Other changes'
    }
    if (/^BREAKING[ -]CHANGE:/m.test(c.body)) group = 'Breaking changes'
    text = text.charAt(0).toUpperCase() + text.slice(1)
    const items = groups.get(group) ?? []
    items.push({ hash: c.hash, scope, text, author: c.author })
    groups.set(group, items)
  }
  return GROUPS.filter((g) => groups.has(g)).map((title) => ({ title, items: groups.get(title)! }))
}

export interface NotesOptions {
  hashes: boolean
  authors: boolean
}

/** Markdown of the notes, under a heading with the version and the date. */
export function formatNotes(
  heading: string,
  groups: ReleaseGroup[],
  options: NotesOptions
): string {
  const lines = [`## ${heading}`, '']
  if (!groups.length) lines.push('No changes.', '')
  for (const group of groups) {
    lines.push(`### ${group.title}`, '')
    for (const item of group.items) {
      let line = `- ${item.scope ? `**${item.scope}:** ` : ''}${item.text}`
      const extra = [
        ...(options.hashes ? [item.hash.slice(0, 7)] : []),
        ...(options.authors ? [item.author] : [])
      ]
      if (extra.length) line += ` (${extra.join(', ')})`
      lines.push(line)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}
