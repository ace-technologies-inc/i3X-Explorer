import { BearerTokenProvider, TOKEN_REFRESH_MARGIN_MS } from '../api/authProvider'
import {
  configurationFor,
  endSessionUrl,
  refreshTokens,
  revokeTokens,
  type OAuthSettings,
  type TokenSet,
} from './oauthProtocol'
import {
  cancelPopupSignIn,
  defaultRedirectUri,
  releaseSignInWindow,
  reserveSignInWindow,
  signInWithPopup,
} from './popupSignIn'

export interface SignOutResult {
  /** The refresh token was revoked at the issuer (only when it offers revocation). */
  revoked: boolean
  /** The issuer's sign-out page was opened, ending its browser session. */
  endedSession: boolean
}

export interface OAuthTransport {
  /** Synchronous, inside the user's click: prepares an interactive sign-in that may follow. */
  prepareSignIn(): void
  /** Releases what prepareSignIn held when no interactive sign-in happened. */
  releaseSignIn(): void
  signIn(settings: OAuthSettings): Promise<TokenSet>
  refresh(settings: OAuthSettings, tokens: TokenSet): Promise<TokenSet>
  signOut(settings: OAuthSettings, tokens: TokenSet | undefined, endSession: boolean): Promise<SignOutResult>
  cancel(): void
}

/** Electron prefixes an IPC rejection with "Error invoking remote method '<channel>': <Name>: "; the issuer's message is what matters. */
export function withoutIpcPrefix(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  return new Error(message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''))
}

const viaMainProcess = <T>(call: Promise<T>) => call.catch((err: unknown) => { throw withoutIpcPrefix(err) })

/** The desktop app: discovery and every token request run in the main process (electron/oauthMain.ts). */
function desktopTransport(api: NonNullable<Window['electronAPI']>): OAuthTransport {
  return {
    prepareSignIn: () => undefined,
    releaseSignIn: () => undefined,
    signIn: settings => viaMainProcess(api.oauthSignIn!(settings)),
    refresh: (settings, tokens) => viaMainProcess(api.oauthRefresh!(settings, tokens)),
    signOut: (settings, tokens, endSession) => viaMainProcess(api.oauthSignOut!(settings, tokens, endSession)),
    cancel: () => api.oauthCancel?.(),
  }
}

/** The web build: a popup sign-in; the issuer's token endpoint must allow CORS. */
const webTransport: OAuthTransport = {
  prepareSignIn: reserveSignInWindow,
  releaseSignIn: releaseSignInWindow,
  signIn: settings => signInWithPopup(() => configurationFor(settings), settings, settings.redirectUri ?? defaultRedirectUri()),
  refresh: async (settings, tokens) => refreshTokens(await configurationFor(settings), settings, tokens),
  signOut: async (settings, tokens, endSession) => {
    const config = await configurationFor(settings)
    const revoked = tokens ? await revokeTokens(config, tokens).catch(() => false) : false
    const page = endSession ? endSessionUrl(config, tokens) : undefined
    if (page) window.open(page.href, '_blank', 'noopener')
    return { revoked, endedSession: !!page }
  },
  cancel: () => cancelPopupSignIn(new Error('Sign-in was cancelled.')),
}

export function defaultTransport(): OAuthTransport {
  const api = window.electronAPI
  return api?.oauthSignIn ? desktopTransport(api) : webTransport
}

export interface OAuthSession {
  provider: BearerTokenProvider
  accountName?: string
}

// Tokens live in memory for this app session only; nothing here is persisted.
const sessions = new Map<string, TokenSet>()

function sessionKey(settings: OAuthSettings): string {
  // Extra parameters can select the token's audience (e.g. `audience=`), so two sets never share a session.
  const extraParams = Object.entries(settings.extraParams ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([settings.issuer, settings.clientId, settings.scopes, settings.resource ?? '', extraParams])
}

const isExpiring = (tokens: TokenSet) =>
  tokens.expiresAt !== undefined && tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS <= Date.now()

/**
 * A provider for `settings`: reuses this session's tokens (renewing them if they are
 * about to expire), else signs in interactively. Later renewals use the refresh token
 * only; they never open a sign-in window behind the person's back.
 */
export async function openOAuthSession(settings: OAuthSettings, transport: OAuthTransport = defaultTransport()): Promise<OAuthSession> {
  const key = sessionKey(settings)
  let tokens = sessions.get(key)
  // Before any await, so a popup is still opened within the click.
  if (!tokens || isExpiring(tokens)) transport.prepareSignIn()

  try {
    if (tokens && isExpiring(tokens)) {
      tokens = await transport.refresh(settings, tokens).catch(() => undefined)
    }
    if (!tokens) {
      // Whatever was cached could not be renewed; never offer it again, even if this sign-in is cancelled.
      sessions.delete(key)
      tokens = await transport.signIn(settings)
    }
    sessions.set(key, tokens)
  } finally {
    transport.releaseSignIn()
  }

  // Forgets the session when renewal fails: the server just refused its access token, so a reconnect
  // must sign in again rather than reuse it. Any failure counts, because errors lose their type over
  // IPC and a transient one only costs a sign-in.
  const renew = async (): Promise<TokenSet> => {
    const current = sessions.get(key)
    try {
      if (!current?.refreshToken) throw new Error('The sign-in has expired. Reconnect to sign in again.')
      const renewed = await transport.refresh(settings, current)
      sessions.set(key, renewed)
      return renewed
    } catch (err) {
      // Only this session's tokens: a reconnect may have signed in again meanwhile.
      if (sessions.get(key) === current) sessions.delete(key)
      throw err
    }
  }

  return { provider: new BearerTokenProvider(renew, tokens), accountName: tokens.accountName }
}

/** Forgets this session's tokens, revokes them where the issuer allows, and optionally ends its browser session. */
export async function signOutOAuth(
  settings: OAuthSettings,
  options: { endSession?: boolean } = {},
  transport: OAuthTransport = defaultTransport()
): Promise<SignOutResult> {
  const key = sessionKey(settings)
  const tokens = sessions.get(key)
  sessions.delete(key)
  return transport.signOut(settings, tokens, options.endSession ?? false)
}

/** Ends an interactive sign-in in progress; the connect that started it fails with "Sign-in was cancelled." */
export function cancelOAuthSignIn(transport: OAuthTransport = defaultTransport()): void {
  transport.cancel()
}

export function hasOAuthSession(settings: OAuthSettings): boolean {
  return sessions.has(sessionKey(settings))
}

/** Who the session for `settings` signed in as, whichever server it was opened for. */
export function oauthSessionAccount(settings: OAuthSettings): string | undefined {
  return sessions.get(sessionKey(settings))?.accountName
}
