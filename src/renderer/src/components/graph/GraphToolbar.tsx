// The bar above the graph: the search and its matches, the branches left out, the columns.
import { ChevronDown, ChevronUp, Columns3, EyeOff, Regex, Search, X } from 'lucide-react'
import type { GraphFilter } from '../../../../shared/types'
import { useShortcutLabel } from '../../shortcuts'
import { NO_GRAPH_FILTER, useApp } from '../../store'
import { openMenu } from '../../ui'
import { tipAfter } from '../../tips'
import { useSettings } from '../../settings'
import type { GraphSearch } from './hooks'
import { branchName, columnsMenu } from './shared'

export default function GraphToolbar({
  repo,
  graphFilter,
  search,
  searchRef,
  matches,
  position,
  onlyMatches,
  setOnlyMatches,
  goToMatch,
  onSearchKey
}: {
  repo: string
  graphFilter: GraphFilter | undefined
  search: GraphSearch
  searchRef: React.RefObject<HTMLInputElement | null>
  /** How many rows match, and which of them is selected (-1 for none) */
  matches: number
  position: number
  onlyMatches: boolean
  setOnlyMatches(only: boolean): void
  goToMatch(backwards: boolean): void
  onSearchKey(e: React.KeyboardEvent<HTMLInputElement>): void
}): React.JSX.Element {
  const setGraphFilter = useApp((s) => s.setGraphFilter)
  const settings = useSettings()
  const searchShortcut = useShortcutLabel('search')
  const { key, mode, regex, error } = search

  const counter = search.searching
    ? 'Searching…'
    : error
      ? error.startsWith('Invalid regular expression')
        ? 'Invalid regex'
        : 'Search failed'
      : matches === 0
        ? 'No results'
        : `${position >= 0 ? position + 1 : '–'} / ${matches}`

  const filter = graphFilter ?? NO_GRAPH_FILTER
  const hiddenMenu = (e: React.MouseEvent): void =>
    openMenu(e, [
      ...filter.hidden.map((name) => ({
        label: `Show ${branchName(name)}`,
        onClick: () =>
          setGraphFilter(repo, {
            ...filter,
            hidden: filter.hidden.filter((h) => h !== name)
          })
      })),
      'separator',
      { label: 'Show all branches', onClick: () => setGraphFilter(repo, NO_GRAPH_FILTER) }
    ])

  return (
    <div className="graph-toolbar">
      <div className={`graph-search${key ? ' active' : ''}`}>
        <Search size={14} className="muted" />
        <input
          ref={searchRef}
          placeholder={
            (mode === 'commit'
              ? 'Search messages, authors, SHA'
              : mode === 'file'
                ? 'Search changed files'
                : regex
                  ? 'Regex in the changed lines'
                  : 'Code added or removed') + (searchShortcut ? ` (${searchShortcut})` : '')
          }
          value={search.text}
          onChange={(e) => {
            search.setText(e.target.value)
            if (mode !== 'code' && e.target.value.length > 2) tipAfter('search')
          }}
          onKeyDown={onSearchKey}
        />
        {mode === 'code' && (
          <button
            className={`graph-tool${regex ? ' active' : ''}`}
            title={
              regex
                ? 'Regular expression: commits whose added or removed lines match it. Click to find where a text appeared or went away instead'
                : 'Click to search with a regular expression, in every added or removed line'
            }
            aria-pressed={regex}
            onClick={() => search.setRegex(!regex)}
          >
            <Regex size={14} />
          </button>
        )}
        {key && (
          <>
            <span className="graph-search-count" title={error}>
              {counter}
            </span>
            <button
              className="graph-tool"
              title="Previous match (Shift+Enter)"
              disabled={matches === 0}
              onClick={() => goToMatch(true)}
            >
              <ChevronUp size={14} />
            </button>
            <button
              className="graph-tool"
              title="Next match (Enter)"
              disabled={matches === 0}
              onClick={() => goToMatch(false)}
            >
              <ChevronDown size={14} />
            </button>
            <button className="graph-tool" title="Clear (Esc)" onClick={() => search.setText('')}>
              <X size={14} />
            </button>
          </>
        )}
      </div>
      <span className="segmented">
        {(['commit', 'file', 'code'] as const).map((m) => (
          <button
            key={m}
            className={mode === m ? 'active' : ''}
            title={
              m === 'commit'
                ? 'Search commit messages, authors and SHA'
                : m === 'file'
                  ? 'Search the paths of the changed files'
                  : 'Find the commits where some code appeared or went away'
            }
            onClick={() => search.setMode(m)}
          >
            {m === 'commit' ? 'Commits' : m === 'file' ? 'Files' : 'Code'}
          </button>
        ))}
      </span>
      <label className="graph-only" title="List only the matching commits">
        <input
          type="checkbox"
          checked={onlyMatches}
          onChange={(e) => setOnlyMatches(e.target.checked)}
        />
        Only matches
      </label>
      <span className="graph-toolbar-gap" />
      {filter.solo ? (
        <span className="graph-filter-chip" title={filter.solo}>
          Only {branchName(filter.solo)}
          <button onClick={() => setGraphFilter(repo, { ...filter, solo: null })}>Show all</button>
        </span>
      ) : (
        filter.hidden.length > 0 && (
          <button
            className="graph-filter-chip"
            title={filter.hidden.map(branchName).join('\n')}
            onClick={hiddenMenu}
          >
            <EyeOff size={13} />
            {filter.hidden.length} hidden
          </button>
        )
      )}
      <button className="graph-tool" title="Columns" onClick={(e) => columnsMenu(e, settings)}>
        <Columns3 size={15} />
      </button>
    </div>
  )
}
