// Asking more people to review an open pull request.
import { useState } from 'react'
import type { Candidate } from '../../../../shared/forge'
import { isReady, pullLabel, useForge } from '../../forge'
import { updatePull } from '../../pullActions'
import ReviewerPicker from './ReviewerPicker'
import { who } from './pullText'

export default function ReviewersDialog(): React.JSX.Element | null {
  const target = useForge((s) => s.review)
  const status = useForge((s) => (target ? s.byRepo[target.repo] : undefined))
  const [chosen, setChosen] = useState<Candidate[]>([])
  const [busy, setBusy] = useState(false)
  const pull = isReady(status) ? status.pulls.find((p) => p.number === target?.number) : undefined
  if (!target || !pull || !isReady(status)) return null
  const label = pullLabel(status.repo.kind, pull.number)
  const close = (): void => {
    setChosen([])
    useForge.setState({ review: null })
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          if (!chosen.length || busy) return
          setBusy(true)
          void updatePull(
            target.repo,
            pull,
            { reviewers: chosen },
            `Asked ${chosen.map((c) => who(c.user)).join(', ')} to review ${label}`
          ).then((done) => {
            setBusy(false)
            if (done) close()
          })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      >
        <div className="modal-title">Ask to review {label}</div>
        {pull.reviewers.length > 0 && (
          <div className="modal-message">
            Already asked: {pull.reviewers.map((r) => who(r.user)).join(', ')}
          </div>
        )}
        <ReviewerPicker
          repo={target.repo}
          chosen={chosen}
          onChange={setChosen}
          exclude={[pull.author.login, ...pull.reviewers.map((r) => r.user.login)]}
        />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!chosen.length || busy}>
            Ask
          </button>
        </div>
      </form>
    </div>
  )
}
