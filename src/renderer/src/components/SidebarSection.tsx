// A collapsible section of the sidebar: its header shows a count and optional buttons.
import { useState } from 'react'
import { ChevronDown, ChevronRight, ListChecks, Plus, RefreshCw } from 'lucide-react'

export default function Section({
  title,
  icon,
  count,
  onAdd,
  onOverview,
  onRefresh,
  children
}: {
  title: string
  icon: React.ReactNode
  count: number
  /** Shows a + button in the header, e.g. to create a branch */
  onAdd?: { title: string; run: () => void }
  /** Shows a button for an overview of the section, e.g. of the branches */
  onOverview?: { title: string; run: () => void }
  /** Shows a button to read the section again, spinning while `busy` */
  onRefresh?: { title: string; run: () => void; busy: boolean }
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button className="section-header" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        {icon}
        {title}
        <span className="section-count">{count}</span>
        {onRefresh && (
          <span
            role="button"
            className={`section-add${onRefresh.busy ? ' spinning' : ''}`}
            title={onRefresh.title}
            onClick={(e) => {
              e.stopPropagation()
              onRefresh.run()
            }}
          >
            <RefreshCw size={13} />
          </span>
        )}
        {onOverview && (
          <span
            role="button"
            className="section-add"
            title={onOverview.title}
            onClick={(e) => {
              e.stopPropagation()
              onOverview.run()
            }}
          >
            <ListChecks size={15} />
          </span>
        )}
        {onAdd && (
          <span
            role="button"
            className="section-add"
            title={onAdd.title}
            onClick={(e) => {
              e.stopPropagation()
              onAdd.run()
            }}
          >
            <Plus size={15} />
          </span>
        )}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}
