import type { Credentials } from '../stores/connection'
import { buildAuthHeaders } from './auth'

/** Supplies the auth headers for each request, so a credential that expires can be renewed mid-session. */
export interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>
  /** Called with the headers a 401 refused; resolves true when newer credentials exist and the request may be retried once. */
  handleUnauthorized(sent: Record<string, string>): Promise<boolean>
  /** Whether these credentials may be sent to a server at `baseUrl`; absent means anywhere. */
  permits?(baseUrl: string): boolean
}

/** The credentials do not cover the server a request would go to (e.g. after a redirect). */
export class CredentialScopeError extends Error {
  constructor(baseUrl: string) {
    super(`The server redirected to ${baseUrl}, which this sign-in does not cover; nothing was sent there.`)
    this.name = 'CredentialScopeError'
  }
}

/**
 * How a request carrying `auth` handles a redirect. Scoped credentials are never forwarded: the
 * browser keeps them on a same-origin redirect, and the page cannot see the target before it follows.
 */
export const redirectModeFor = (auth: AuthProvider | null | undefined): RequestRedirect =>
  auth?.permits ? 'manual' : 'follow'

/** A redirect that `redirect: 'manual'` stopped (opaque in a browser, the 3xx itself elsewhere); 304 is not one. */
export function isUnfollowedRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || [301, 302, 303, 307, 308].includes(response.status)
}

/** A signed-in request was answered with a redirect, which was not followed. */
export class CredentialRedirectError extends Error {
  constructor() {
    super('The server answered a signed-in request with a redirect. It was not followed, so the sign-in was not sent on; reconnect to pick up a moved server.')
    this.name = 'CredentialRedirectError'
  }
}

/** Credentials typed into the connection dialog; they never change, so a 401 is final. */
export class StaticAuthProvider implements AuthProvider {
  private readonly headers: Record<string, string>

  constructor(credentials: Credentials | null | undefined) {
    this.headers = buildAuthHeaders(credentials)
  }

  async getHeaders(): Promise<Record<string, string>> {
    return { ...this.headers }
  }

  async handleUnauthorized(_sent: Record<string, string>): Promise<boolean> {
    return false
  }
}

export interface AccessToken {
  accessToken: string
  /** Epoch milliseconds; omit when the issuer gave no lifetime. */
  expiresAt?: number
}

/** Renew this long before expiry so a request never leaves with a token about to lapse. */
export const TOKEN_REFRESH_MARGIN_MS = 60_000

/**
 * A bearer token obtained and renewed by `acquire`. Concurrent callers share one
 * renewal, and a token is renewed ahead of its expiry rather than after a 401.
 */
export class BearerTokenProvider implements AuthProvider {
  private token: AccessToken | null
  private pending: Promise<AccessToken> | null = null

  constructor(
    private readonly acquire: () => Promise<AccessToken>,
    initial: AccessToken | null = null,
    private readonly now: () => number = Date.now
  ) {
    this.token = initial
  }

  async getHeaders(): Promise<Record<string, string>> {
    const token = this.isFresh(this.token) ? this.token : await this.renew()
    return { Authorization: `Bearer ${token.accessToken}` }
  }

  async handleUnauthorized(sent: Record<string, string>): Promise<boolean> {
    const authorization = sent.Authorization
    const refused = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
    if (this.isFresh(this.token) && this.token.accessToken !== refused) return true
    try {
      const renewed = await this.renew()
      return renewed.accessToken !== refused
    } catch {
      return false
    }
  }

  private isFresh(token: AccessToken | null): token is AccessToken {
    if (!token) return false
    return token.expiresAt === undefined || token.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()
  }

  private renew(): Promise<AccessToken> {
    if (!this.pending) {
      this.pending = this.acquire()
        .then(token => {
          this.token = token
          return token
        })
        .finally(() => {
          this.pending = null
        })
    }
    return this.pending
  }
}
