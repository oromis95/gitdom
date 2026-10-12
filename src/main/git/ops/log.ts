// Operations that read the history: searches, commit details, file and line histories.
import type { MyCommit } from '../../../shared/api'
import { lineBefore, parseDiff } from '../../../shared/diff'
import {
  FILE_LOG_FORMAT,
  parseBlame,
  parseFileLog,
  parseLineLog,
  parseNameStatus,
  withNumstat
} from '../parsers'
import { GitError, runGit, tryGit } from '../exec'
import {
  COMMIT_LIMIT,
  COMMIT_PAGE,
  loadCommits,
  loadCommitDetail,
  logRevisions
} from '../repository'
import {
  type OpImpl,
  assertArg,
  assertTagName,
  assertRev,
  assertHash,
  exists,
  getConfig
} from './shared'

const FILE_HISTORY_LIMIT = 5000
/** Each commit of a line history carries a diff: fewer of them */
const LINE_HISTORY_LIMIT = 500

/** The running search in the changes of each repository: a new one, or clearing it, stops it */
const contentSearches = new Map<string, AbortController>()

/**
 * Commits whose changes add or remove `text` (`-S`, the commits where it appeared or went away),
 * or whose changed lines match a regular expression (`-G`), ignoring case. Git diffs every commit
 * for this, so a long history takes a while: a newer search, or cancelSearch, stops it.
 */
async function searchChanges(
  repo: string,
  field: 'code' | 'regex',
  text: string,
  filter: Parameters<typeof logRevisions>[0]
): Promise<string[]> {
  const controller = new AbortController()
  contentSearches.set(repo, controller)
  try {
    const output = await runGit(
      repo,
      [
        'log',
        `-n${COMMIT_LIMIT}`,
        '--format=%H',
        '-i',
        field === 'code' ? `-S${text}` : `-G${text}`,
        ...logRevisions(filter),
        '--'
      ],
      { signal: controller.signal }
    )
    return output.split('\n').filter(Boolean)
  } catch (e) {
    const invalid = e instanceof GitError && /invalid regex: (.*)/.exec(e.stderr)
    if (invalid) throw new Error(`Invalid regular expression: ${invalid[1].trim()}`)
    throw e
  } finally {
    if (contentSearches.get(repo) === controller) contentSearches.delete(repo)
  }
}

export const logOps: Pick<
  OpImpl,
  | 'searchCommits'
  | 'cancelSearch'
  | 'moreCommits'
  | 'compareFiles'
  | 'commitDetail'
  | 'commitPreview'
  | 'tagInfo'
  | 'fileHistory'
  | 'lineHistory'
  | 'blame'
  | 'lineBefore'
  | 'releaseCommits'
  | 'previousTag'
  | 'myCommits'
> = {
  async searchCommits(repo, field, text, filter) {
    const inChanges = field === 'code' || field === 'regex'
    if (inChanges) contentSearches.get(repo)?.abort()
    if (!text.trim()) return []
    if (/[\0\n\r]/.test(text)) throw new Error('Invalid search text')
    if (inChanges) return searchChanges(repo, field, text, filter)
    const match =
      field === 'message'
        ? ['-i', '-F', `--grep=${text}`]
        : // Pathspec magic: any path containing the text, ignoring case. Its glob characters are
          // made literal with brackets, as Git for Windows turns backslashes into slashes
          ['--', `:(icase,glob)**/*${text.replace(/\\/g, '/').replace(/[*?[]/g, '[$&]')}*`]
    const output = await runGit(repo, [
      'log',
      `-n${COMMIT_LIMIT}`,
      '--format=%H',
      ...logRevisions(filter),
      ...match
    ])
    return output.split('\n').filter(Boolean)
  },

  async cancelSearch(repo) {
    contentSearches.get(repo)?.abort()
  },

  moreCommits(repo, skip, filter) {
    return loadCommits(repo, filter, skip, COMMIT_PAGE)
  },

  async compareFiles(repo, from, to) {
    assertRev(from)
    assertRev(to)
    return parseNameStatus(
      await runGit(repo, ['diff', '--no-ext-diff', '--name-status', '-z', '-M', from, to])
    )
  },

  commitDetail: (repo, hash) => loadCommitDetail(repo, hash),

  async commitPreview(repo, hash) {
    assertHash(hash)
    const [header, body] = (await runGit(repo, ['show', '-s', '--format=%P%x1f%b', hash])).split(
      '\x1f'
    )
    const parents = header.trim().split(' ').filter(Boolean)
    // Merges and stashes are shown against their first parent, like the commit detail
    const diff = (format: string): Promise<string> =>
      runGit(
        repo,
        parents.length > 1
          ? ['diff', '--no-ext-diff', format, '-z', '-M', parents[0], hash]
          : ['diff-tree', '--no-commit-id', '-r', '--root', format, '-z', '-M', hash]
      )
    const [names, numbers] = await Promise.all([diff('--name-status'), diff('--numstat')])
    return { body: body.trim(), files: withNumstat(parseNameStatus(names), numbers) }
  },

  async tagInfo(repo, name) {
    await assertTagName(repo, name)
    const output = await runGit(repo, [
      'for-each-ref',
      '--format=%(objecttype)%1f%(taggername)%1f%(taggeremail:trim)%1f%(taggerdate:unix)%1f%(contents:subject)%1f%(contents:body)',
      `refs/tags/${name}`
    ])
    const [type, tagger, email, date, subject, body] = output.split('\x1f')
    if (type !== 'tag') return null
    return { tagger, email, date: Number(date), subject, body: (body ?? '').trim() }
  },

  async fileHistory(repo, path) {
    assertArg(path, 'path')
    const output = await runGit(repo, [
      '--literal-pathspecs',
      'log',
      '--follow',
      `-n${FILE_HISTORY_LIMIT}`,
      `--format=${FILE_LOG_FORMAT}`,
      '--name-status',
      '-z',
      '--',
      path
    ])
    return parseFileLog(output, path)
  },

  async lineHistory(repo, path, range, rev) {
    assertArg(path, 'path')
    if (rev) assertHash(rev)
    // Line numbers ("12,40") or a function name, which git looks for with its function detection
    const lines = /^(\d+),(\d+)$/.exec(range)
    const valid = lines
      ? Number(lines[1]) >= 1 && Number(lines[2]) >= Number(lines[1])
      : /^:[^:\0\n]+$/.test(range)
    if (!valid) throw new Error(`Invalid line range: ${range}`)
    const output = await runGit(repo, [
      'log',
      `-L${range}:${path}`,
      `-n${LINE_HISTORY_LIMIT}`,
      `--format=${FILE_LOG_FORMAT}`,
      ...(rev ? [rev] : []),
      '--'
    ]).catch((e: unknown) => {
      if (!lines && e instanceof GitError && /no match/.test(e.message)) {
        const name = range.slice(1).replace(/\\(.)/g, '$1')
        throw new Error(
          `Git finds no function named “${name}” in ${path}: it looks for lines that start a function, like “function ${name}” or “def ${name}”, from the start of the line`
        )
      }
      throw e
    })
    return parseLineLog(output, path)
  },

  async blame(repo, path, rev) {
    assertArg(path, 'path')
    if (rev) assertHash(rev)
    const output = await runGit(repo, [
      '--literal-pathspecs',
      'blame',
      '--porcelain',
      ...(rev ? [rev] : []),
      '--',
      path
    ])
    return parseBlame(output, path)
  },

  async lineBefore(repo, hash, path, previous, line) {
    assertHash(hash)
    assertHash(previous.hash)
    assertArg(path, 'path')
    assertArg(previous.path, 'path')
    const output = await runGit(repo, [
      '--literal-pathspecs',
      'diff',
      '--no-ext-diff',
      '--no-color',
      '-M',
      '-U0',
      previous.hash,
      hash,
      '--',
      ...new Set([previous.path, path])
    ])
    return lineBefore(parseDiff(output, path).hunks, line)
  },

  async releaseCommits(repo, from, to) {
    if (from) assertArg(from, 'commit')
    assertArg(to, 'commit')
    const output = await runGit(repo, [
      'log',
      '--no-merges',
      // By the history, not the dates: commits made in the same second keep their order
      '--topo-order',
      '--format=%H%x1f%an%x1f%s%x1f%b%x1e',
      from ? `${from}..${to}` : to,
      '--'
    ])
    return output
      .split('\x1e')
      .map((record) => record.replace(/^\n/, ''))
      .filter(Boolean)
      .map((record) => {
        const [hash, author, subject, body] = record.split('\x1f')
        return { hash, author, subject, body: body.trim() }
      })
  },

  async previousTag(repo, rev) {
    assertArg(rev, 'commit')
    return (await tryGit(repo, ['describe', '--tags', '--abbrev=0', rev]))?.trim() || null
  },

  async myCommits(repo, since, until, emails) {
    if (!Number.isFinite(since) || !Number.isFinite(until)) throw new Error('Invalid period')
    if (!(await exists(repo))) throw new Error('The folder is gone')
    const own = await getConfig(repo, 'user.email')
    const mine = new Set(
      [...(Array.isArray(emails) ? emails : []), own]
        .filter((e): e is string => typeof e === 'string' && !!e.trim())
        .map((e) => e.trim().toLowerCase())
    )
    if (!mine.size) return []
    const output = await tryGit(repo, [
      'log',
      '--all',
      '--source',
      '--no-merges',
      `--since=@${Math.floor(since)}`,
      `--until=@${Math.floor(until)}`,
      '--format=%H%x1f%at%x1f%ae%x1f%S%x1f%s'
    ])
    const seen = new Set<string>()
    const commits: MyCommit[] = []
    for (const line of (output ?? '').split('\n')) {
      const [hash, date, email, source, ...subject] = line.split('\x1f')
      if (!hash || seen.has(hash) || !mine.has(email.toLowerCase())) continue
      seen.add(hash)
      const ref = source.replace(/^refs\/(heads|tags|remotes)\//, '')
      // Stashes are work in progress, not work done
      if (source === 'refs/stash') continue
      commits.push({ hash, date: Number(date), ref, subject: subject.join('\x1f') })
    }
    // --since reads the committer date: a rebase today would bring in last month's work
    return commits.filter((c) => c.date >= since && c.date < until).sort((a, b) => b.date - a.date)
  }
}
