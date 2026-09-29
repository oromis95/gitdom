// The new version notice and the What's New dialog.
import { useEffect } from 'react'
import { Download, RotateCw, Sparkles, X } from 'lucide-react'
import type { ReleaseInfo } from '../../../shared/api'
import { parseMarkdown, type Inline } from '../../../shared/releases'
import {
  cancelUpdateDownload,
  closeWhatsNew,
  dismissUpdate,
  downloadUpdate,
  installUpdate,
  showReleaseNotes,
  skipUpdate,
  useUpdates
} from '../updates'

function Text({ parts }: { parts: Inline[] }): React.JSX.Element {
  return (
    <>
      {parts.map((p, i) =>
        p.code ? <code key={i}>{p.text}</code> : p.bold ? <b key={i}>{p.text}</b> : p.text
      )}
    </>
  )
}

function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown">
      {parseMarkdown(text).map((block, i) =>
        block.kind === 'heading' ? (
          <div key={i} className="md-heading">
            <Text parts={block.text} />
          </div>
        ) : block.kind === 'item' ? (
          <div key={i} className="md-item" style={{ marginLeft: block.depth * 18 }}>
            <Text parts={block.text} />
          </div>
        ) : (
          <p key={i}>
            <Text parts={block.text} />
          </p>
        )
      )}
    </div>
  )
}

function WhatsNewDialog(): React.JSX.Element | null {
  const whatsNew = useUpdates((s) => s.whatsNew)

  useEffect(() => {
    if (!whatsNew) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeWhatsNew()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [whatsNew])

  if (!whatsNew) return null
  return (
    <div className="modal-backdrop" onMouseDown={closeWhatsNew}>
      <div className="modal whats-new" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pref-header">
          <div className="modal-title">
            <Sparkles size={16} /> {whatsNew.title}
          </div>
          <button className="pref-close" aria-label="Close" onClick={closeWhatsNew}>
            <X size={16} />
          </button>
        </div>
        <div className="whats-new-body">
          {whatsNew.entries.map((entry) => (
            <section key={entry.version}>
              <div className="whats-new-version">
                GitDom {entry.version}
                {entry.date && <span className="muted">{entry.date}</span>}
              </div>
              {entry.body ? (
                <Markdown text={entry.body} />
              ) : (
                <p className="muted">No release notes: see the release page.</p>
              )}
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" autoFocus onClick={closeWhatsNew}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

const megabytes = (bytes: number): string => (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)

function UpdateActions({ release }: { release: ReleaseInfo }): React.JSX.Element {
  const selfUpdate = useUpdates((s) => s.selfUpdate)
  const download = useUpdates((s) => s.download)
  const openPage = (): void => window.api.app.openRepoPage(release.downloadUrl ?? release.url)

  if (download.state === 'downloading') {
    const { received, total } = download
    return (
      <>
        <div
          className="update-progress"
          role="progressbar"
          aria-valuenow={received}
          aria-valuemax={total ?? undefined}
        >
          <div
            style={{ width: total ? `${(100 * received) / total}%` : '100%' }}
            className={total ? '' : 'indeterminate'}
          />
        </div>
        <div className="update-notice-actions">
          <span className="muted">
            Downloading… {megabytes(received)}
            {total ? ` of ${megabytes(total)}` : ''} MB
          </span>
          <button className="btn" onClick={cancelUpdateDownload}>
            Cancel
          </button>
        </div>
      </>
    )
  }
  if (download.state === 'ready') {
    return (
      <>
        <div className="muted">
          Downloaded and verified. It&apos;s installed when you close GitDom, or now:
        </div>
        <div className="update-notice-actions">
          <button className="btn btn-primary" onClick={() => void installUpdate()}>
            <RotateCw size={14} /> Restart now
          </button>
          <button className="btn" onClick={dismissUpdate}>
            Later
          </button>
        </div>
      </>
    )
  }
  const failed = download.state === 'failed'
  return (
    <>
      {failed && <div className="pref-bad">{download.error}</div>}
      <div className="update-notice-actions">
        {selfUpdate && (
          <button
            className="btn btn-primary"
            title="Download it, then restart GitDom"
            onClick={() => void downloadUpdate()}
          >
            {failed ? 'Try again' : 'Update'}
          </button>
        )}
        {/* After a failed update, the release page is the way out */}
        {(!selfUpdate || failed) && (
          <button className={selfUpdate ? 'btn' : 'btn btn-primary'} onClick={openPage}>
            Download
          </button>
        )}
        <button className="btn" onClick={() => showReleaseNotes(release)}>
          What&apos;s new
        </button>
        <button className="link" onClick={skipUpdate}>
          Skip this version
        </button>
      </div>
    </>
  )
}

function UpdateNotice(): React.JSX.Element | null {
  const release = useUpdates((s) => s.available)
  if (!release) return null
  return (
    <div className="update-notice" role="status">
      <div className="update-notice-title">
        <Download size={16} />
        GitDom {release.version} is available
        <button
          className="pref-close"
          aria-label="Dismiss"
          title="Remind me next time"
          onClick={dismissUpdate}
        >
          <X size={14} />
        </button>
      </div>
      <div className="muted">You have version {__APP_VERSION__}.</div>
      <UpdateActions release={release} />
    </div>
  )
}

export default function Updates(): React.JSX.Element {
  return (
    <>
      <UpdateNotice />
      <WhatsNewDialog />
    </>
  )
}
