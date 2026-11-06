import http from 'http'
import type { AddressInfo } from 'net'
import type { Configuration } from 'openid-client'
import {
  beginAuthorization,
  callbackState,
  completeAuthorization,
  loopbackRedirect,
  type OAuthSettings,
  type PendingAuthorization,
  type TokenSet,
} from '../src/auth/oauthProtocol'

export const SIGN_IN_TIMEOUT_MS = 5 * 60_000

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>i3X Explorer</title>` +
  `<body style="font-family:system-ui;padding:2rem">${message}</body>`

export interface LoopbackOptions {
  openBrowser: (url: string) => Promise<void> | void
  timeoutMs?: number
  /** Aborting ends the sign-in with "Sign-in was cancelled." */
  signal?: AbortSignal
}

/**
 * Native-app sign-in (RFC 8252): a one-shot listener on a loopback port receives the redirect
 * from the system browser, and the code is redeemed here, outside any browser origin. The
 * callback's host, path and (optional) port come from `settings.loopbackRedirectUri`; without a
 * port a random free one is used. A request that does not carry this sign-in's state is
 * answered 400 and ignored, so a stray request cannot end it.
 */
export function signInWithLoopback(
  config: Configuration,
  settings: OAuthSettings,
  options: LoopbackOptions
): Promise<TokenSet> {
  return new Promise<TokenSet>((resolve, reject) => {
    let pending: PendingAuthorization | undefined
    let redeeming = false
    let settled = false
    let target: URL
    try {
      target = loopbackRedirect(settings)
    } catch (err) {
      reject(err)
      return
    }
    const callbackPath = target.pathname || '/'

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!pending || redeeming || url.pathname !== callbackPath || callbackState(url.searchParams) !== pending.state) {
        res.writeHead(url.pathname === callbackPath ? 400 : 404, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(PAGE('This is not the sign-in i3X Explorer is waiting for.'))
        return
      }
      redeeming = true
      completeAuthorization(config, pending, url.search, settings).then(
        tokens => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(PAGE('Signed in. You can close this tab and return to i3X Explorer.'))
          finish(undefined, tokens)
        },
        err => {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(PAGE('Sign-in failed. You can close this tab and return to i3X Explorer.'))
          finish(err)
        }
      )
    })

    const timer = setTimeout(
      () => finish(new Error('Sign-in timed out. Try again.')),
      options.timeoutMs ?? SIGN_IN_TIMEOUT_MS
    )
    const onAbort = () => finish(new Error('Sign-in was cancelled.'))
    options.signal?.addEventListener('abort', onAbort)

    function finish(err: unknown, tokens?: TokenSet) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      server.close()
      if (tokens) resolve(tokens)
      else reject(err instanceof Error ? err : new Error(String(err)))
    }

    if (options.signal?.aborted) {
      onAbort()
      return
    }
    server.on('error', err => finish(err))
    // localhost resolves to the IPv4 loopback in browsers that try it first; [::1] needs the IPv6 one.
    const listenHost = target.hostname === '[::1]' ? '::1' : '127.0.0.1'
    server.listen(target.port ? Number(target.port) : 0, listenHost, async () => {
      try {
        const { port } = server.address() as AddressInfo
        const redirectUri = new URL(target.href)
        redirectUri.port = String(port)
        pending = await beginAuthorization(config, settings, redirectUri.href)
        if (!settled) await options.openBrowser(pending.url.href)
      } catch (err) {
        finish(err)
      }
    })
  })
}
