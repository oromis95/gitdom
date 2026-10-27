// Device login (OAuth 2.0 device authorization grant, RFC 8628): GitDom shows a code, the user
// types it on the service's page and approves, GitDom receives a token. It needs an OAuth app
// registered on the service, whose client ID (public, not a secret) goes below.
import type { ForgeKind } from '../../shared/forge'
import type { Secret } from './accounts'
import { ForgeError, requestJson } from './http'

export interface DeviceEndpoints {
  codeUrl: string
  tokenUrl: string
  clientId: string
  scope: string
}

/** Client IDs of the GitDom OAuth apps; empty until one is registered, and the login isn't offered */
const CLIENT_IDS: Partial<Record<ForgeKind, string>> = {
  github: process.env.GITDOM_GITHUB_CLIENT_ID ?? '',
  gitlab: process.env.GITDOM_GITLAB_CLIENT_ID ?? ''
}

/** Where the device login of a host happens; null when it can't be offered there. */
export function deviceEndpoints(kind: ForgeKind, host: string): DeviceEndpoints | null {
  const clientId = CLIENT_IDS[kind]
  if (!clientId) return null
  // The apps are registered on the public services; a server of one's own would need its own
  if (kind === 'github' && host === 'github.com')
    return {
      codeUrl: 'https://github.com/login/device/code',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId,
      scope: 'repo read:org'
    }
  if (kind === 'gitlab' && host === 'gitlab.com')
    return {
      codeUrl: 'https://gitlab.com/oauth/authorize_device',
      tokenUrl: 'https://gitlab.com/oauth/token',
      clientId,
      scope: 'api'
    }
  return null
}

interface CodeAnswer {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval?: number
}

interface TokenAnswer {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString()
})

const toSecret = (answer: TokenAnswer, now: number): Secret => ({
  token: answer.access_token!,
  refresh: answer.refresh_token,
  expiresAt: answer.expires_in ? now + answer.expires_in * 1000 : undefined
})

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export async function requestDeviceCode(endpoints: DeviceEndpoints): Promise<DeviceCode> {
  const answer = await requestJson<CodeAnswer>(
    endpoints.codeUrl,
    form({ client_id: endpoints.clientId, scope: endpoints.scope })
  )
  return {
    deviceCode: answer.device_code,
    userCode: answer.user_code,
    verificationUri: answer.verification_uri,
    expiresIn: answer.expires_in,
    interval: answer.interval ?? 5
  }
}

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ForgeError('Login cancelled', 0))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new ForgeError('Login cancelled', 0))
      },
      { once: true }
    )
  })

/** Asks for the token until the user approves, refuses, or the code expires. */
export async function pollDeviceToken(
  endpoints: DeviceEndpoints,
  code: DeviceCode,
  signal: AbortSignal,
  now: () => number = Date.now
): Promise<Secret> {
  const deadline = now() + code.expiresIn * 1000
  let interval = code.interval
  for (;;) {
    await wait(interval * 1000, signal)
    if (now() > deadline) throw new ForgeError('The code expired: start the login again', 0)
    let answer: TokenAnswer
    try {
      answer = await requestJson<TokenAnswer>(
        endpoints.tokenUrl,
        form({
          client_id: endpoints.clientId,
          device_code: code.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      )
    } catch (e) {
      // GitLab answers 400 while waiting, with the same errors in the body
      if (!(e instanceof ForgeError) || e.status !== 400 || !e.body) throw e
      answer = e.body as TokenAnswer
    }
    if (answer.access_token) return toSecret(answer, now())
    if (answer.error === 'authorization_pending') continue
    if (answer.error === 'slow_down') {
      interval += 5
      continue
    }
    if (answer.error === 'access_denied') throw new ForgeError('The login was refused', 0)
    if (answer.error === 'expired_token')
      throw new ForgeError('The code expired: start the login again', 0)
    throw new ForgeError(answer.error_description ?? answer.error ?? 'The login failed', 0)
  }
}

/** A new token for one that expired (GitLab's last two hours). */
export async function refreshToken(endpoints: DeviceEndpoints, refresh: string): Promise<Secret> {
  const answer = await requestJson<TokenAnswer>(
    endpoints.tokenUrl,
    form({ client_id: endpoints.clientId, refresh_token: refresh, grant_type: 'refresh_token' })
  )
  if (!answer.access_token)
    throw new ForgeError('The login expired: connect the account again', 401, true)
  return toSecret(answer, Date.now())
}
