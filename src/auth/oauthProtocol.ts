/**
 * OAuth 2.0 / OpenID Connect sign-in on openid-client: discovery, PKCE authorization
 * code flow, refresh, revocation and end-session, generic over any issuer. Shared by
 * the web build (renderer) and the desktop app's main process.
 */
import * as client from 'openid-client'

export interface OAuthSettings {
  issuer: string
  clientId: string
  scopes: string[]
  /** RFC 8707 resource indicator, for issuers that select the audience by it. */
  resource?: string
  extraParams?: Record<string, string>
  /** Web only; the desktop app uses `loopbackRedirectUri`. */
  redirectUri?: string
  /**
   * Desktop only: the loopback URL the system browser returns to (`http://localhost`, `http://127.0.0.1`
   * or `http://[::1]`, with an optional path). Without a port, a random free one is used (RFC 8252 7.3).
   */
  loopbackRedirectUri?: string
}

/** Plain data, so it can cross Electron IPC. */
export interface TokenSet {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt?: number
  refreshToken?: string
  idToken?: string
  /** From the validated ID token's claims, for display. */
  accountName?: string
}

/** A started sign-in: the URL to open and what the callback must be checked against. */
export interface PendingAuthorization {
  url: URL
  redirectUri: string
  state: string
  nonce?: string
  codeVerifier: string
}

// The sign-in flow sets these itself; extra parameters can never replace them.
export const RESERVED_AUTH_PARAMS = new Set([
  'client_id',
  'redirect_uri',
  'response_type',
  'response_mode',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
  'resource',
])

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

// Entra's "Mobile and desktop" registration is http://localhost; RFC 8252 prefers an IP literal, so it is configurable.
export const DEFAULT_LOOPBACK_REDIRECT_URI = 'http://localhost/'

/** The desktop callback URL to listen on, checked: plain http on a loopback host, no query or fragment. */
export function loopbackRedirect(settings: Pick<OAuthSettings, 'loopbackRedirectUri'>): URL {
  const value = settings.loopbackRedirectUri ?? DEFAULT_LOOPBACK_REDIRECT_URI
  let url: URL | null = null
  try {
    url = new URL(value)
  } catch {
    // Reported below.
  }
  if (!url || !isLoopbackHttp(url) || url.search || url.hash || url.username || url.password) {
    throw new Error(`The loopback redirect URI "${value}" must be http://localhost, http://127.0.0.1 or http://[::1], with an optional port and path.`)
  }
  return url
}

export interface DiscoveryOptions {
  /** Replaces fetch for every request this configuration makes (tests). */
  fetch?: client.CustomFetch
}

/** Discovery (OIDC, then RFC 8414). Every endpoint must be https; plain http is allowed only for a loopback issuer. */
export async function discoverIssuer(settings: OAuthSettings, options: DiscoveryOptions = {}): Promise<client.Configuration> {
  let issuer: URL
  try {
    issuer = new URL(settings.issuer)
  } catch {
    throw new Error(`The issuer "${settings.issuer}" is not a URL.`)
  }
  if (issuer.protocol !== 'https:' && !isLoopbackHttp(issuer)) {
    throw new Error(`The issuer must be an https URL (plain http only on localhost): ${settings.issuer}`)
  }
  const discoveryOptions: client.DiscoveryRequestOptions = {
    execute: isLoopbackHttp(issuer) ? [client.allowInsecureRequests] : [],
    ...(options.fetch ? { [client.customFetch]: options.fetch } : {}),
  }
  try {
    return await client.discovery(issuer, settings.clientId, undefined, client.None(), discoveryOptions)
  } catch (oidcError) {
    try {
      return await client.discovery(issuer, settings.clientId, undefined, client.None(), { ...discoveryOptions, algorithm: 'oauth2' })
    } catch {
      throw new Error(`Could not read the sign-in settings of ${settings.issuer}: ${describe(oidcError)}`)
    }
  }
}

const configurations = new Map<string, Promise<client.Configuration>>()

/** One discovery per issuer and client for the life of the process; a failed one is retried next time. */
export function configurationFor(settings: OAuthSettings): Promise<client.Configuration> {
  const key = `${settings.issuer}\n${settings.clientId}`
  let pending = configurations.get(key)
  if (!pending) {
    pending = discoverIssuer(settings)
    pending.catch(() => configurations.delete(key))
    configurations.set(key, pending)
  }
  return pending
}

/** Starts a sign-in: PKCE, state and (for OpenID Connect) a nonce, with extra parameters unable to replace the flow's own. */
export async function beginAuthorization(
  config: client.Configuration,
  settings: OAuthSettings,
  redirectUri: string
): Promise<PendingAuthorization> {
  const codeVerifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const nonce = settings.scopes.includes('openid') ? client.randomNonce() : undefined
  // The token request repeats the redirect URI in the canonical form the callback URL will have.
  const canonicalRedirect = new URL(redirectUri).href
  const extra = Object.fromEntries(
    Object.entries(settings.extraParams ?? {}).filter(([key]) => !RESERVED_AUTH_PARAMS.has(key.toLowerCase()))
  )
  const url = client.buildAuthorizationUrl(config, {
    ...extra,
    redirect_uri: canonicalRedirect,
    scope: settings.scopes.join(' '),
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    ...(nonce ? { nonce } : {}),
    ...(settings.resource ? { resource: settings.resource } : {}),
  })
  return { url, redirectUri: canonicalRedirect, state, nonce, codeVerifier }
}

/** The state carried by a redirect's query, to tell this sign-in's callback from a stray request. */
export function callbackState(search: string | URLSearchParams): string | null {
  return new URLSearchParams(search).get('state')
}

/** Checks the callback against the pending sign-in (state, issuer, ID token claims and nonce) and redeems the code. */
export async function completeAuthorization(
  config: client.Configuration,
  pending: PendingAuthorization,
  callbackSearch: string,
  settings: Pick<OAuthSettings, 'resource'>
): Promise<TokenSet> {
  const callback = new URL(pending.redirectUri)
  callback.search = callbackSearch
  try {
    const tokens = await client.authorizationCodeGrant(
      config,
      callback,
      {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        ...(pending.nonce ? { expectedNonce: pending.nonce, idTokenExpected: true } : {}),
      },
      settings.resource ? { resource: settings.resource } : undefined
    )
    return toTokenSet(tokens)
  } catch (err) {
    throw new Error(describe(err))
  }
}

export async function refreshTokens(config: client.Configuration, settings: OAuthSettings, current: TokenSet): Promise<TokenSet> {
  if (!current.refreshToken) throw new Error('The sign-in has expired. Reconnect to sign in again.')
  try {
    const tokens = await client.refreshTokenGrant(config, current.refreshToken, {
      scope: settings.scopes.join(' '),
      ...(settings.resource ? { resource: settings.resource } : {}),
    })
    return toTokenSet(tokens, current)
  } catch (err) {
    throw new Error(describe(err))
  }
}

/** Revokes the refresh token (RFC 7009) when the issuer offers revocation; answers whether it did. */
export async function revokeTokens(config: client.Configuration, tokens: TokenSet): Promise<boolean> {
  if (!tokens.refreshToken || !config.serverMetadata().revocation_endpoint) return false
  await client.tokenRevocation(config, tokens.refreshToken, { token_type_hint: 'refresh_token' })
  return true
}

/** The issuer's sign-out page (OIDC RP-initiated logout), when it has one. */
export function endSessionUrl(config: client.Configuration, tokens: TokenSet | undefined): URL | undefined {
  if (!config.serverMetadata().end_session_endpoint) return undefined
  return client.buildEndSessionUrl(config, tokens?.idToken ? { id_token_hint: tokens.idToken } : {})
}

function toTokenSet(
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
  previous?: TokenSet
): TokenSet {
  const expiresIn = tokens.expiresIn()
  const claims = tokens.claims()
  const name = claims?.name ?? claims?.preferred_username ?? claims?.email
  return {
    accessToken: tokens.access_token,
    expiresAt: expiresIn !== undefined ? Date.now() + expiresIn * 1000 : undefined,
    // An issuer may keep the refresh token and not send it again (RFC 6749 section 6).
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    idToken: tokens.id_token ?? previous?.idToken,
    accountName: typeof name === 'string' ? name : previous?.accountName,
  }
}

/** The issuer's own error and description when it sent one, else the library's message. */
export function describe(err: unknown): string {
  if (err instanceof client.ResponseBodyError || err instanceof client.AuthorizationResponseError) {
    return err.error_description ? `${err.error}: ${err.error_description}` : err.error
  }
  if (err instanceof Error) {
    const inner = (err as { cause?: unknown }).cause
    const cause = inner instanceof Error ? ` (${inner.message})` : ''
    return `${err.message}${cause}`
  }
  return String(err)
}
