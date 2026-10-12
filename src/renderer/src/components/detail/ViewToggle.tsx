import { List, ListTree } from 'lucide-react'
import type { FileView } from './fileListing'

export function ViewToggle({
  view,
  onChange
}: {
  view: FileView
  onChange: (view: FileView) => void
}): React.JSX.Element {
  return (
    <div className="view-toggle">
      <button
        className={view === 'path' ? 'on' : ''}
        onClick={() => onChange('path')}
        title="Path view"
      >
        <List size={15} />
      </button>
      <button
        className={view === 'tree' ? 'on' : ''}
        onClick={() => onChange('tree')}
        title="Tree view"
      >
        <ListTree size={15} />
      </button>
    </div>
  )
}
