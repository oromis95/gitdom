// Connecting an account when Git Credential Manager has no token the service's API accepts:
// a device login in the browser, where GitDom has an app on the service, or a token pasted in.
import { useEffect, useState } from 'react'
import { Copy, ExternalLink, KeyRound, LogIn } from 'lucide-react'
import type { DeviceLogin, ForgeKind } from '../../../../shared/forge'
import { FORGE_NAMES, PUBLIC_HOSTS } from '../../../../shared/forge'
import { connected, openInBrowser, useForge, type ConnectRequest } from '../../forge'
import * as actions from '../../actions'

/** The permissions a token needs, as the service's page names them */
const SCOPES: Record<ForgeKind, string> = {
  github: 'repo and read:org',
  gitlab: 'api',
  bitbucket: 'pull request, repository and account (read and write)',
  azure: 'Code: Read & write'
}

/** Where the token is created, as the button says it */
const TOKEN_PLACES: Partial<Record<ForgeKind, string>> = {
  bitbucket: 'your Atlassian account',
  azure: 'Azure DevOps'
}

export default function ConnectDialog(): React.JSX.Element | null {
  const request = useForge((s) => s.connect)
  // Keyed: each request starts with an empty form
  return request ? <ConnectForm key={`${request.kind} ${request.host}`} request={request} /> : null
}

function ConnectForm({ request }: { request: ConnectRequest }): React.JSX.Element {
  const [token, setToken] = useState('')
  // Bitbucket's API tokens go with the Atlassian account's email; access tokens go alone
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState<DeviceLogin | null>(null)
  const [canSave, setCanSave] = useState(true)

  useEffect(() => {
    void window.api.forge.canSaveTokens().then(setCanSave)
  }, [])

  const name = FORGE_NAMES[request.kind]
  const where = PUBLIC_HOSTS.has(request.host) ? '' : ` (${request.host})`

  const close = (): void => {
    if (login) window.api.forge.cancelLogin(login.id)
    useForge.setState({ connect: null })
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await window.api.forge.connectWithToken(
      request.host,
      request.kind,
      token,
      email,
      request.path
    )
    setBusy(false)
    if (result.ok) connected(result.value)
    else setError(result.error)
  }

  const startLogin = async (): Promise<void> => {
    setError(null)
    const started = await window.api.forge.startLogin(request.host, request.kind)
    if (!started.ok) return setError(started.error)
    setLogin(started.value)
    openInBrowser(started.value.verificationUri)
    const finished = await window.api.forge.finishLogin(started.value.id)
    if (useForge.getState().connect !== request) return
    setLogin(null)
    if (finished.ok) connected(finished.value)
    else if (finished.error !== 'Login cancelled') setError(finished.error)
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal connect-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (token.trim() && !busy) void submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      >
        <div className="modal-title">
          Connect to {name}
          {where}
        </div>
        <div className="modal-message">
          Git Credential Manager has no token for {request.host} that {name}&apos;s API accepts.
          {request.device ? ' Log in with the browser, or paste a token.' : ' Paste a token.'}{' '}
          GitDom keeps it encrypted on this computer and only sends it to {request.host}.
        </div>
        {!canSave && (
          <div className="modal-message connect-warning">
            This system can&apos;t encrypt it: the account lasts until GitDom closes.
          </div>
        )}

        {request.device &&
          (login ? (
            <div className="connect-device">
              <div className="muted">Type this code on the page that opened:</div>
              <div className="connect-code">
                <span className="mono">{login.userCode}</span>
                <button
                  type="button"
                  className="row-action"
                  title="Copy the code"
                  onClick={() => actions.copy(login.userCode)}
                >
                  <Copy size={13} />
                </button>
              </div>
              <button
                type="button"
                className="row-action"
                onClick={() => openInBrowser(login.verificationUri)}
              >
                <ExternalLink size={13} /> {login.verificationUri}
              </button>
              <div className="muted">Waiting for the approval…</div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary connect-login"
              onClick={() => void startLogin()}
            >
              <LogIn size={15} /> Log in with the browser
            </button>
          ))}

        {request.kind === 'bitbucket' && (
          <label className="modal-field">
            <span>
              Email <span className="muted">of your Atlassian account, for an API token</span>
            </span>
            <input
              type="email"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
        <label className="modal-field">
          <span>
            Token <span className="muted">with the {SCOPES[request.kind]} permissions</span>
          </span>
          <input
            type="password"
            autoFocus={!request.device && request.kind !== 'bitbucket'}
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="row-action connect-create"
          onClick={() =>
            void window.api.forge
              .tokenPage(request.host, request.kind, request.path)
              .then(openInBrowser)
          }
        >
          <KeyRound size={13} /> Create a token on {TOKEN_PLACES[request.kind] ?? request.host}
        </button>
        {error && <div className="banner-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!token.trim() || busy}>
            {busy ? 'Checking…' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  )
}
