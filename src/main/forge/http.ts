// Requests to the services' APIs. They go through Electron's net.fetch, which uses the system
// proxy like the browser; tests put a fake in its place.

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

let fetcher: Fetcher | null = null

/** Sets the function requests go through: net.fetch in the app, a fake in tests. */
export function setFetcher(next: Fetcher): void {
  fetcher = next
}

export class ForgeError extends Error {
  constructor(
    message: string,
    /** HTTP status, 0 when the service couldn't be reached */
    readonly status: number,
    /** The token was refused or lacks a permission: the account has to be connected again */
    readonly auth = false,
    /** The service's JSON answer, when it sent one */
    readonly body: unknown = null
  ) {
    super(message)
    this.name = 'ForgeError'
  }
}

const TIMEOUT = 30000

/** Sends a request; the response is returned whatever its status. */
export async function send(url: string, init: RequestInit = {}): Promise<Response> {
  if (!fetcher) throw new Error('No fetcher set')
  const signal = init.signal ?? AbortSignal.timeout(TIMEOUT)
  try {
    return await fetcher(url, {
      ...init,
      signal,
      headers: { 'User-Agent': 'GitDom', ...(init.headers as Record<string, string>) }
    })
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new ForgeError(`Can't reach ${new URL(url).host}: ${reason}`, 0)
  }
}

/** Reads the error a service sent back, in one of the shapes they use. */
function errorText(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  for (const key of ['message', 'error_description', 'error', 'errorMessage']) {
    const value = b[key]
    if (typeof value === 'string' && value) return value
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { message?: unknown }).message === 'string'
    )
      return (value as { message: string }).message
  }
  return null
}

/** Sends a request and reads its JSON, turning statuses other than 2xx into a ForgeError. */
export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await send(url, init)
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Not JSON: a proxy's or the server's error page
  }
  if (response.ok) {
    if (body === null && text)
      throw new ForgeError('The service sent an unreadable answer', response.status)
    return body as T
  }
  const host = new URL(url).host
  const detail = errorText(body)
  if (response.status === 401)
    throw new ForgeError(`${host} refused the token${detail ? `: ${detail}` : ''}`, 401, true)
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'))
    const when = reset ? ` until ${new Date(reset * 1000).toLocaleTimeString()}` : ''
    throw new ForgeError(`${host}: too many requests, paused${when}`, 403)
  }
  if (response.status === 403)
    throw new ForgeError(
      `${host}: the token lacks a permission${detail ? ` (${detail})` : ''}`,
      403,
      true
    )
  throw new ForgeError(
    detail ?? `${host} answered ${response.status} ${response.statusText}`,
    response.status,
    false,
    body
  )
}

interface GraphQlAnswer<T> {
  data?: T
  errors?: { message: string; type?: string; extensions?: { code?: string } }[]
}

/** Runs a GraphQL query; errors in the answer become a ForgeError. */
export async function graphql<T>(
  endpoint: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const answer = await requestJson<GraphQlAnswer<T>>(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const error = answer.errors?.[0]
  if (error) {
    // GitHub reports a missing scope as an error with data still present
    const auth = error.type === 'INSUFFICIENT_SCOPES' || error.extensions?.code === 'unauthorized'
    if (!answer.data || auth) throw new ForgeError(error.message, 200, auth)
  }
  if (!answer.data) throw new ForgeError('The service sent no data', 200)
  return answer.data
}
