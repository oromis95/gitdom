// Preferences > Accounts: the services GitDom is connected to, and servers of one's own.
import { useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { FORGE_NAMES, type TokenSource } from '../../../../shared/forge'
import { disconnectForge, loadAccounts, refreshAllForge, useForge } from '../../forge'
import { updateSettings, useSettings } from '../../settings'
import { Avatar } from './PullBits'

const SOURCES: Record<TokenSource, string> = {
  gcm: "Git Credential Manager's token",
  oauth: 'Logged in with the browser',
  token: 'Token, kept encrypted'
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="pref-row">
      <div className="pref-label">
        <span>{label}</span>
        {hint && <span className="pref-hint">{hint}</span>}
      </div>
      <div className="pref-control">{children}</div>
    </div>
  )
}

export default function AccountSettings(): React.JSX.Element {
  const accounts = useForge((s) => s.accounts)
  const hosts = useSettings((s) => s.forgeHosts)
  const badges = useSettings((s) => s.graphPullRequests)
  useEffect(() => void loadAccounts(), [])

  return (
    <>
      <Row
        label="Connected"
        hint="Connect from the Pull Requests section of the sidebar; tokens only go to their service"
      >
        {accounts.length === 0 ? (
          <span className="muted">No account yet</span>
        ) : (
          <div className="account-list">
            {accounts.map((a) => (
              <div key={a.host} className="account-row">
                <Avatar user={a.user} size={28} />
                <div className="account-who">
                  <div>
                    <b>{a.user.name ?? a.user.login}</b>{' '}
                    <span className="muted">{a.user.login}</span>
                  </div>
                  <div className="muted" title={SOURCES[a.source]}>
                    {FORGE_NAMES[a.kind]} · {a.host} · {SOURCES[a.source]}
                  </div>
                </div>
                <button className="btn btn-small" onClick={() => void disconnectForge(a.host)}>
                  <LogOut size={13} /> Disconnect
                </button>
              </div>
            ))}
          </div>
        )}
      </Row>
      <Row label="Graph" hint="A badge with the number, the review and the checks">
        <label className="modal-check">
          <input
            type="checkbox"
            checked={badges}
            onChange={(e) => updateSettings({ graphPullRequests: e.target.checked })}
          />
          Show pull requests on the branches
        </label>
      </Row>
      <Row
        label="Servers of your own"
        hint={
          <>
            GitHub Enterprise, self-managed GitLab, Bitbucket Data Center or Azure DevOps Server: a
            host and its kind (github, gitlab, bitbucket, azure) per line, e.g.{' '}
            <span className="mono">git.example.com gitlab</span>. Bitbucket Data Center is found by
            itself from its /scm/ addresses
          </>
        }
      >
        <textarea
          className="pref-hosts mono"
          rows={3}
          spellCheck={false}
          defaultValue={hosts}
          placeholder="git.example.com gitlab"
          onBlur={(e) => {
            if (e.target.value.trim() === hosts) return
            updateSettings({ forgeHosts: e.target.value.trim() })
            refreshAllForge()
          }}
        />
      </Row>
    </>
  )
}
