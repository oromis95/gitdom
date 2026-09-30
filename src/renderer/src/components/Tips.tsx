// The tips dialog: one feature at a time, with its animation and how to use it.
import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Lightbulb, X } from 'lucide-react'
import { useSettings } from '../settings'
import { TIPS, closeTips, setShowTips, showTip, useTips, withKeys } from '../tips'
import TipAnimation from './TipAnimation'

export default function Tips(): React.JSX.Element | null {
  const open = useTips((s) => s.open)
  const showTips = useSettings((s) => s.showTips)

  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeTips()
      else if (e.key === 'ArrowRight') showTip(open + 1)
      else if (e.key === 'ArrowLeft') showTip(open - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (open === null) return null
  const tip = TIPS[open]
  return (
    <div className="modal-backdrop" onMouseDown={closeTips}>
      <div className="modal tips" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pref-header">
          <div className="modal-title">
            <Lightbulb size={16} /> Tips
          </div>
          <select
            className="tip-jump"
            aria-label="Go to a tip"
            value={open}
            onChange={(e) => showTip(Number(e.target.value))}
          >
            {TIPS.map((t, i) => (
              <option key={t.id} value={i}>
                {t.title}
              </option>
            ))}
          </select>
          <button className="pref-close" aria-label="Close" onClick={closeTips}>
            <X size={16} />
          </button>
        </div>
        <TipAnimation id={tip.id} />
        <div className="tip-body">
          <div className="tip-title">{tip.title}</div>
          <p className="tip-text">{tip.text}</p>
          <ol className="tip-steps">
            {tip.steps.map((step, i) => (
              <li key={i}>{withKeys(step)}</li>
            ))}
          </ol>
        </div>
        <div className="tip-footer">
          <label className="modal-check">
            <input
              type="checkbox"
              checked={showTips}
              onChange={(e) => setShowTips(e.target.checked)}
            />
            Show tips at startup and while working
          </label>
          <span className="tip-count">
            {open + 1} of {TIPS.length}
          </span>
          <button className="btn" aria-label="Previous tip" onClick={() => showTip(open - 1)}>
            <ChevronLeft size={14} />
          </button>
          <button
            className="btn btn-primary"
            autoFocus
            aria-label="Next tip"
            onClick={() => showTip(open + 1)}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
