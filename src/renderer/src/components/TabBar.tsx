import { FolderOpen, GitBranch, Loader2, Plus, X } from 'lucide-react'
import { copy, showInFolder } from '../actions'
import { useApp, type RepoTab } from '../store'
import { openMenu, type MenuItem } from '../ui'

/** Close this tab, the others, those on either side or all of them; copy or show its folder. */
function tabMenu(tabs: RepoTab[], index: number, closeTabs: (paths: string[]) => void): MenuItem[] {
  const tab = tabs[index]
  const paths = (list: RepoTab[]): string[] => list.map((t) => t.path)
  const others = tabs.filter((t) => t !== tab)
  const right = tabs.slice(index + 1)
  const left = tabs.slice(0, index)
  return [
    { label: 'Close', onClick: () => closeTabs([tab.path]) },
    { label: 'Close others', onClick: () => closeTabs(paths(others)), disabled: !others.length },
    {
      label: 'Close tabs to the right',
      onClick: () => closeTabs(paths(right)),
      disabled: !right.length
    },
    {
      label: 'Close tabs to the left',
      onClick: () => closeTabs(paths(left)),
      disabled: !left.length
    },
    { label: 'Close all', onClick: () => closeTabs(paths(tabs)) },
    'separator',
    { label: 'Copy path', onClick: () => copy(tab.path) },
    {
      label: 'Show in folder',
      onClick: () => showInFolder(tab.path, null),
      disabled: !!tab.opening
    }
  ]
}

export default function TabBar(): React.JSX.Element {
  const { tabs, active, setActive, closeTab, closeTabs, pickAndOpen } = useApp()

  return (
    <div className="tabbar">
      <button className="tab-add" title="Open repository" onClick={() => void pickAndOpen()}>
        <FolderOpen size={18} />
      </button>
      {tabs.map((tab, i) => (
        <div
          key={tab.path}
          className={`tab${i === active ? ' active' : ''}`}
          title={tab.path}
          onMouseDown={(e) => {
            // Middle click closes the tab, like in browsers
            if (e.button === 1) closeTab(i)
            else if (e.button === 0) setActive(i)
          }}
          onContextMenu={(e) => openMenu(e, tabMenu(tabs, i, closeTabs))}
        >
          {tab.loading ? <Loader2 size={15} className="spin" /> : <GitBranch size={15} />}
          <span className="tab-name">{tab.name}</span>
          <button
            className="tab-close"
            aria-label="Close tab"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => closeTab(i)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button className="tab-add" title="Open repository" onClick={() => void pickAndOpen()}>
        <Plus size={18} />
      </button>
    </div>
  )
}
