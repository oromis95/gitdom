import { FolderOpen, GitBranch, Loader2, Plus, X } from 'lucide-react'
import { useApp } from '../store'

export default function TabBar(): React.JSX.Element {
  const { tabs, active, setActive, closeTab, pickAndOpen } = useApp()

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
            else setActive(i)
          }}
        >
          {tab.loading ? <Loader2 size={15} /> : <GitBranch size={15} />}
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
