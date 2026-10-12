// The questions git and ssh ask while a command runs (askpass): a username and password or token,
// a key's passphrase, or whether to trust a server seen for the first time. Several commands can
// ask at once, from the workspace dashboard: their questions wait in turn.
import { useEffect, useState } from 'react'
import type { AskpassAnswer, AskpassRequest } from '../../../shared/askpass'

const TITLES: Record<AskpassRequest['kind'], string> = {
  username: 'Sign in',
  password: 'Password',
  passphrase: 'Key passphrase',
  hostKey: 'Unknown server'
}

export default function CredentialDialog(): React.JSX.Element | null {
  const [queue, setQueue] = useState<AskpassRequest[]>([])
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')

  useEffect(() => window.api.askpass.onRequest((request) => setQueue((q) => [...q, request])), [])

  const request = queue[0]
  if (!request) return null

  const answer = (value: AskpassAnswer): void => {
    window.api.askpass.reply(request.id, value)
    setQueue((q) => q.slice(1))
    setUsername('')
    setSecret('')
  }
  const submit = (): void => {
    if (request.kind === 'hostKey') answer({ value: 'yes' })
    else if (request.kind === 'username') answer({ value: username, password: secret })
    else answer({ value: secret })
  }
  const valid = request.kind !== 'username' || username.trim() !== ''
  const where = request.subject ? ` — ${request.subject}` : ''

  return (
    <div className="modal-backdrop">
      <form
        className="modal credential-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') answer(null)
        }}
      >
        <div className="modal-title">
          {TITLES[request.kind]}
          {where}
        </div>
        {request.kind === 'hostKey' ? (
          <>
            <div className="modal-message">
              GitDom hasn&apos;t connected to this server before. Check its fingerprint with the
              server&apos;s owner before trusting it; it is then remembered in known_hosts.
            </div>
            <pre className="credential-prompt">{request.prompt}</pre>
          </>
        ) : (
          <div className="modal-message">
            {request.kind === 'passphrase'
              ? 'Git needs the passphrase of this SSH key.'
              : request.kind === 'username'
                ? 'The server asks for a username and a password or access token.'
                : `Git asks: ${request.prompt.replace(/:\s*$/, '')}.`}
            {request.kind !== 'passphrase' &&
              ' If a credential helper is set up, it keeps them for the next time.'}
          </div>
        )}
        {request.kind === 'username' && (
          <label className="modal-field">
            <span>Username</span>
            <input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
        )}
        {request.kind !== 'hostKey' && (
          <label className="modal-field">
            <span>
              {request.kind === 'passphrase'
                ? 'Passphrase'
                : request.kind === 'username'
                  ? 'Password or token'
                  : 'Password'}
            </span>
            <input
              type="password"
              autoFocus={request.kind !== 'username'}
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => answer(null)}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!valid}
            autoFocus={request.kind === 'hostKey'}
          >
            {request.kind === 'hostKey' ? 'Trust and connect' : 'OK'}
          </button>
        </div>
      </form>
    </div>
  )
}
