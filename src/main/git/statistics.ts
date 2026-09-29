// Repository statistics: one pass over `git log --numstat`, read as it arrives and summed up here,
// so even a history of a million commits never sits in memory whole; the renderer only receives
// the totals. Languages come from the sizes of the files in the current version.
import { StringDecoder } from 'string_decoder'
import type {
  AuthorStats,
  FileStats,
  LanguageStats,
  MonthStats,
  RepoStatistics,
  StatisticsOptions
} from '../../shared/types'
import { runGit, tryGit } from './exec'

/** A change made this many days before the newest commit counts half as much as a new one */
const HEAT_HALF_LIFE_DAYS = 90
const MAX_AUTHORS = 100
const MAX_FILES = 50
const PROGRESS_INTERVAL = 150

// Header of each commit: author (after .mailmap), email, time, ISO date for the time zone, parents
const FORMAT = '--format=%x1e%aN%x1f%aE%x1f%at%x1f%ai%x1f%P'

interface FileAccumulator {
  changes: number
  last: number
  heat: number
  /** Changes by author index */
  authors: Map<number, number>
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Sums up commits and their changed files, newest first, as `git log` lists them. */
export class StatsCollector {
  commits = 0
  merges = 0
  added = 0
  deleted = 0
  first: number | null = null
  last: number | null = null
  private readonly authorIndex = new Map<string, number>()
  private readonly authors: AuthorStats[] = []
  private readonly files = new Map<string, FileAccumulator>()
  /** Old paths of renamed files, to the path they have now */
  private readonly renamed = new Map<string, string>()
  private readonly days = new Map<string, number>()
  private readonly months = new Map<string, MonthStats>()
  private readonly punchcard = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  private author = -1
  private time = 0
  private month: MonthStats | null = null
  private newest: number | null = null

  /** `offset` is the author's time zone, in minutes east of UTC. */
  addCommit(name: string, email: string, time: number, offset: number, parents: number): void {
    this.commits++
    if (parents > 1) this.merges++
    this.first = this.first === null ? time : Math.min(this.first, time)
    this.last = this.last === null ? time : Math.max(this.last, time)
    this.newest ??= time

    const key = email.toLowerCase() || name
    let index = this.authorIndex.get(key)
    if (index === undefined) {
      index = this.authors.length
      this.authorIndex.set(key, index)
      this.authors.push({ name, email, commits: 0, added: 0, deleted: 0, first: time, last: time })
    }
    const author = this.authors[index]
    author.commits++
    author.first = Math.min(author.first, time)
    author.last = Math.max(author.last, time)
    this.author = index
    this.time = time

    // The clock on the author's wall: their working hours, not the viewer's
    const local = new Date((time + offset * 60) * 1000)
    const month = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}`
    const day = `${month}-${pad(local.getUTCDate())}`
    this.days.set(day, (this.days.get(day) ?? 0) + 1)
    this.punchcard[local.getUTCDay()][local.getUTCHours()]++
    let stats = this.months.get(month)
    if (!stats) {
      stats = { month, commits: 0, added: 0, deleted: 0 }
      this.months.set(month, stats)
    }
    stats.commits++
    this.month = stats
  }

  /**
   * A file changed by the last commit added; `added` and `deleted` are null for binary files.
   * `oldPath` is set when the commit renamed it.
   */
  addFile(added: number | null, deleted: number | null, path: string, oldPath?: string): void {
    if (this.author < 0) return
    const current = this.renamed.get(path) ?? path
    // Older commits name the file by its old path
    if (oldPath !== undefined && oldPath !== path) this.renamed.set(oldPath, current)

    const lines = (added ?? 0) + (deleted ?? 0)
    if (lines) {
      this.added += added ?? 0
      this.deleted += deleted ?? 0
      this.authors[this.author].added += added ?? 0
      this.authors[this.author].deleted += deleted ?? 0
      this.month!.added += added ?? 0
      this.month!.deleted += deleted ?? 0
    }

    let file = this.files.get(current)
    if (!file) {
      file = { changes: 0, last: this.time, heat: 0, authors: new Map() }
      this.files.set(current, file)
    }
    file.changes++
    file.last = Math.max(file.last, this.time)
    const age = Math.max(0, (this.newest ?? this.time) - this.time) / 86400
    file.heat += 0.5 ** (age / HEAT_HALF_LIFE_DAYS)
    file.authors.set(this.author, (file.authors.get(this.author) ?? 0) + 1)
  }

  /** The statistics, for the files of the current version (`tracked`: path to size). */
  result(tracked: Map<string, number>): RepoStatistics {
    const files: FileStats[] = []
    const owners = new Map<number, number>()
    let changed = 0
    for (const [path, file] of this.files) {
      if (!tracked.has(path)) continue
      changed++
      // Lockfiles and builds change with every dependency bump: they'd only crowd out the rest
      if (GENERATED.test(path)) continue
      let owner = 0
      let most = 0
      for (const [author, changes] of file.authors) {
        if (changes > most) [owner, most] = [author, changes]
      }
      owners.set(owner, (owners.get(owner) ?? 0) + 1)
      files.push({
        path,
        changes: file.changes,
        authors: file.authors.size,
        last: file.last,
        heat: Math.round(file.heat * 100) / 100,
        owner: this.authors[owner].name,
        ownerShare: most / file.changes
      })
    }

    let busFactor = 0
    let covered = 0
    for (const owned of [...owners.values()].sort((a, b) => b - a)) {
      if (covered * 2 >= files.length) break
      covered += owned
      busFactor++
    }

    return {
      commits: this.commits,
      merges: this.merges,
      added: this.added,
      deleted: this.deleted,
      first: this.first,
      last: this.last,
      authors: [...this.authors]
        .sort((a, b) => b.commits - a.commits || b.added - a.added)
        .slice(0, MAX_AUTHORS),
      authorCount: this.authors.length,
      days: Object.fromEntries(this.days),
      punchcard: this.punchcard,
      months: this.allMonths(),
      languages: languagesOf(tracked),
      hotspots: [...files]
        .sort((a, b) => b.heat - a.heat || b.changes - a.changes)
        .slice(0, MAX_FILES),
      soloFiles: files
        .filter((f) => f.authors === 1)
        .sort((a, b) => b.changes - a.changes || b.last - a.last)
        .slice(0, MAX_FILES),
      trackedFiles: tracked.size,
      changedFiles: changed,
      busFactor
    }
  }

  /** Months from the first to the last, with the quiet ones too, so charts keep their scale. */
  private allMonths(): MonthStats[] {
    const keys = [...this.months.keys()].sort()
    if (!keys.length) return []
    const months: MonthStats[] = []
    let [year, month] = keys[0].split('-').map(Number)
    const end = keys[keys.length - 1]
    for (;;) {
      const key = `${year}-${pad(month)}`
      months.push(this.months.get(key) ?? { month: key, commits: 0, added: 0, deleted: 0 })
      if (key >= end) return months
      if (++month > 12) [year, month] = [year + 1, 1]
    }
  }
}

/** Minutes east of UTC, from the end of an ISO-like date: "2026-09-29 10:00:00 +0200". */
export function zoneOffset(date: string): number {
  const match = /([+-])(\d\d)(\d\d)\s*$/.exec(date)
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

const count = (text: string): number | null => (text === '-' ? null : Number(text) || 0)

/**
 * Feeds `git log --numstat -z` output to a collector, in chunks of any size. Each commit starts
 * with a header after \x1e; each file is "added\tdeleted\tpath", or for a rename
 * "added\tdeleted\t" followed by the old and the new path, all separated by NUL.
 */
export class NumstatParser {
  private partial = ''
  private rename: { added: number | null; deleted: number | null; old?: string } | null = null

  constructor(private readonly collector: StatsCollector) {}

  push(text: string): void {
    const tokens = (this.partial + text).split('\0')
    this.partial = tokens.pop() ?? ''
    for (const token of tokens) this.token(token)
  }

  end(): void {
    if (this.partial) this.token(this.partial)
    this.partial = ''
  }

  private token(raw: string): void {
    if (this.rename) {
      if (this.rename.old === undefined) this.rename.old = raw
      else {
        this.collector.addFile(this.rename.added, this.rename.deleted, raw, this.rename.old)
        this.rename = null
      }
      return
    }
    const token = raw.replace(/^\n+/, '')
    if (!token) return
    if (token.startsWith('\x1e')) {
      const [name, email, time, date, parents] = token.slice(1).split('\x1f')
      this.collector.addCommit(
        name,
        email,
        Number(time) || 0,
        zoneOffset(date ?? ''),
        (parents ?? '').split(' ').filter(Boolean).length
      )
      return
    }
    const [added, deleted, path] = token.split('\t')
    if (path === undefined) return
    if (path === '') this.rename = { added: count(added), deleted: count(deleted) }
    else this.collector.addFile(count(added), count(deleted), path)
  }
}

// Generated and vendored files: they say nothing about the project's languages or its authors
const GENERATED =
  /(^|\/)(node_modules|vendor|third_party|dist|build|out)\/|\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  groovy: 'Groovy',
  gradle: 'Groovy',
  cs: 'C#',
  fs: 'F#',
  vb: 'Visual Basic',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  hh: 'C++',
  go: 'Go',
  rs: 'Rust',
  swift: 'Swift',
  m: 'Objective-C',
  mm: 'Objective-C',
  rb: 'Ruby',
  php: 'PHP',
  pl: 'Perl',
  lua: 'Lua',
  r: 'R',
  dart: 'Dart',
  ex: 'Elixir',
  exs: 'Elixir',
  erl: 'Erlang',
  hs: 'Haskell',
  clj: 'Clojure',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  ps1: 'PowerShell',
  psm1: 'PowerShell',
  bat: 'Batchfile',
  cmd: 'Batchfile',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'SCSS',
  less: 'Less',
  vue: 'Vue',
  svelte: 'Svelte',
  md: 'Markdown',
  mdx: 'Markdown',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  tf: 'HCL',
  proto: 'Protocol Buffers',
  graphql: 'GraphQL',
  ipynb: 'Jupyter Notebook'
}

const FILE_NAMES: Record<string, string> = {
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  cmakelists: 'CMake'
}

/** The language of a file, from its name; null when it isn't source code GitDom knows. */
export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const base = name.replace(/\.txt$/, '')
  if (FILE_NAMES[base]) return FILE_NAMES[base]
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (LANGUAGES[name.slice(dot + 1)] ?? null) : null
}

export function languagesOf(tracked: Map<string, number>): LanguageStats[] {
  const languages = new Map<string, LanguageStats>()
  for (const [path, bytes] of tracked) {
    const name = GENERATED.test(path) ? null : languageOf(path)
    if (!name) continue
    const stats = languages.get(name) ?? { name, bytes: 0, files: 0 }
    stats.bytes += bytes
    stats.files++
    languages.set(name, stats)
  }
  return [...languages.values()].sort((a, b) => b.bytes - a.bytes)
}

/** Files of the current version, with their sizes, from "mode type hash size\tpath" NUL records. */
export function parseTree(output: string): Map<string, number> {
  const files = new Map<string, number>()
  for (const record of output.split('\0')) {
    const tab = record.indexOf('\t')
    if (tab < 0) continue
    const [, type, , size] = record.slice(0, tab).split(/\s+/)
    if (type === 'blob') files.set(record.slice(tab + 1), Number(size) || 0)
  }
  return files
}

/** Statistics being computed, by repository: a new request, or closing the view, stops them. */
const running = new Map<string, AbortController>()

export async function repoStatistics(
  repo: string,
  options: StatisticsOptions,
  onProgress: (commits: number) => void
): Promise<RepoStatistics> {
  const { sinceDays, allBranches } = options
  if (sinceDays !== null && !(Number.isInteger(sinceDays) && sinceDays > 0))
    throw new Error(`Invalid period: ${sinceDays}`)

  running.get(repo)?.abort()
  const controller = new AbortController()
  running.set(repo, controller)
  try {
    const collector = new StatsCollector()
    const parser = new NumstatParser(collector)
    const decoder = new StringDecoder('utf8')
    const hasHead = (await tryGit(repo, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null
    if (hasHead || allBranches) {
      let reported = 0
      await runGit(
        repo,
        [
          'log',
          '--numstat',
          '-z',
          '-M',
          FORMAT,
          ...(sinceDays ? [`--since=${sinceDays}.days`] : []),
          ...(allBranches ? ['--branches', '--remotes', '--tags'] : ['HEAD']),
          '--'
        ],
        {
          signal: controller.signal,
          onStdout(chunk) {
            parser.push(decoder.write(chunk))
            if (Date.now() - reported > PROGRESS_INTERVAL) {
              reported = Date.now()
              onProgress(collector.commits)
            }
          }
        }
      )
      parser.push(decoder.end())
      parser.end()
    }
    const tree = hasHead ? await runGit(repo, ['ls-tree', '-r', '-l', '-z', 'HEAD']) : ''
    return collector.result(parseTree(tree))
  } finally {
    if (running.get(repo) === controller) running.delete(repo)
  }
}

export function cancelStatistics(repo: string): void {
  running.get(repo)?.abort()
}
