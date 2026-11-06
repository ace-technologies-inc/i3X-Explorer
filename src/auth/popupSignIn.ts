import type { Configuration } from 'openid-client'
import {
  beginAuthorization,
  callbackState,
  completeAuthorization,
  type OAuthSettings,
  type TokenSet,
} from './oauthProtocol'

export const CALLBACK_CHANNEL = 'i3x-oauth-callback'
export const POPUP_SIGN_IN_TIMEOUT_MS = 5 * 60_000
const POPUP_NAME = 'i3x-oauth-sign-in'
const POPUP_FEATURES = 'popup,width=520,height=680'

/** The callback page served beside the app (public/oauth/callback.html). */
export function defaultRedirectUri(): string {
  return new URL(`${import.meta.env.BASE_URL}oauth/callback.html`, document.baseURI).href
}

let reserved: Window | null = null
let cancelPending: ((reason: Error) => void) | null = null
// A cancel that arrived while a window was reserved but before its sign-in started (a reconnect's refresh).
let cancelledEarly: Error | null = null

/**
 * Opens the sign-in window now, while the click that asked for it still counts as a
 * user gesture; discovery and PKCE take a moment, and a browser may block a popup
 * opened after them. The sign-in navigates it once it is ready.
 */
export function reserveSignInWindow(): void {
  cancelledEarly = null
  if (reserved && !reserved.closed) return
  reserved = window.open('about:blank', POPUP_NAME, POPUP_FEATURES)
  if (reserved) {
    reserved.document.title = 'Sign in'
    reserved.document.body.textContent = 'Opening sign-in…'
  }
}

/** Closes a reserved window that no sign-in used (the session was still valid). */
export function releaseSignInWindow(): void {
  cancelledEarly = null
  if (reserved && !reserved.closed) reserved.close()
  reserved = null
}

/** Ends a sign-in in progress, or one about to start in a reserved window; it fails with `reason`. */
export function cancelPopupSignIn(reason: Error): void {
  if (cancelPending) {
    cancelPending(reason)
  } else if (reserved) {
    if (!reserved.closed) reserved.close()
    reserved = null
    cancelledEarly = reason
  }
}

/**
 * Browser sign-in in a popup. The callback page answers on a same-origin
 * BroadcastChannel; a message for another sign-in is ignored. A closed window is not
 * treated as a cancel: an issuer's Cross-Origin-Opener-Policy makes `closed` read true
 * while the sign-in is still in progress, so only a callback, the timeout or a cancel ends it.
 * A cancel ends it at any step, discovery included, and the window is never navigated after one.
 */
export async function signInWithPopup(
  getConfig: () => Promise<Configuration>,
  settings: OAuthSettings,
  redirectUri: string,
  timeoutMs = POPUP_SIGN_IN_TIMEOUT_MS
): Promise<TokenSet> {
  if (cancelledEarly) {
    const reason = cancelledEarly
    cancelledEarly = null
    throw reason
  }
  let cancel: (reason: Error) => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => { cancel = reject })
  cancelled.catch(() => {})
  cancelPending = cancel
  const untilCancelled = <T>(work: Promise<T>) => Promise.race([work, cancelled])

  let popup = reserved && !reserved.closed ? reserved : null
  reserved = null
  let channel: BroadcastChannel | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const config = await untilCancelled(getConfig())
    const pending = await untilCancelled(beginAuthorization(config, settings, redirectUri))
    if (popup) popup.location.href = pending.url.href
    else popup = window.open(pending.url.href, POPUP_NAME, POPUP_FEATURES)
    if (!popup) throw new Error('The sign-in window was blocked. Allow pop-ups for this site and try again.')

    const search = await untilCancelled(new Promise<string>((resolve, reject) => {
      channel = new BroadcastChannel(CALLBACK_CHANNEL)
      timeout = setTimeout(() => reject(new Error('Sign-in timed out. Try again.')), timeoutMs)
      channel.onmessage = (event: MessageEvent) => {
        const received = (event.data as { search?: unknown } | null)?.search
        if (typeof received === 'string' && callbackState(received) === pending.state) resolve(received)
      }
    }))

    return await untilCancelled(completeAuthorization(config, pending, search, settings))
  } finally {
    clearTimeout(timeout)
    channel?.close()
    if (cancelPending === cancel) cancelPending = null
    if (popup && !popup.closed) popup.close()
  }
}
