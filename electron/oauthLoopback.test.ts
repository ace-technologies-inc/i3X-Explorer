import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { signInWithLoopback } from './oauthLoopback'
import { discoverIssuer, type OAuthSettings } from '../src/auth/oauthProtocol'

const issuer = 'https://login.example.com'
const settings: OAuthSettings = { issuer, clientId: 'explorer', scopes: ['api://i3x/read'] }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fake issuer behind openid-client's custom fetch; `token` answers the code exchange. */
async function configWith(token: (form: URLSearchParams) => Response = () => json({ access_token: 'at', token_type: 'Bearer', refresh_token: 'rt' })) {
  const tokenForms: URLSearchParams[] = []
  const fetch = vi.fn(async (url: string, init: { body?: unknown }) => {
    if (url.endsWith('/.well-known/openid-configuration')) {
      return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
    }
    const form = new URLSearchParams(String(init.body))
    tokenForms.push(form)
    return token(form)
  })
  return { config: await discoverIssuer(settings, { fetch }), tokenForms }
}

/** Plays the system browser: requests the redirect URI with the parameters `answer` returns. */
async function visit(authorizationUrl: string, answer: (auth: URL) => Record<string, string>) {
  const auth = new URL(authorizationUrl)
  const redirect = new URL(auth.searchParams.get('redirect_uri')!)
  for (const [key, value] of Object.entries(answer(auth))) redirect.searchParams.set(key, value)
  const response = await fetch(redirect)
  return { status: response.status, page: await response.text() }
}

describe('signInWithLoopback', () => {
  it('receives the code on a loopback port and redeems it with the PKCE verifier and the same redirect URI', async () => {
    const { config, tokenForms } = await configWith()
    let page = ''
    const openBrowser = vi.fn(async (url: string) => {
      page = (await visit(url, auth => ({ code: 'the-code', state: auth.searchParams.get('state')! }))).page
    })

    const tokens = await signInWithLoopback(config, settings, { openBrowser })

    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
    const auth = new URL(openBrowser.mock.calls[0][0])
    expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+\/$/)
    expect(tokenForms[0].get('code')).toBe('the-code')
    expect(tokenForms[0].get('redirect_uri')).toBe(auth.searchParams.get('redirect_uri'))
    expect(createHash('sha256').update(tokenForms[0].get('code_verifier')!).digest('base64url')).toBe(auth.searchParams.get('code_challenge'))
    await vi.waitFor(() => expect(page).toContain('Signed in'))
  })

  it('listens where loopbackRedirectUri says, an IP literal and a path, and redeems with that exact URI', async () => {
    const { config, tokenForms } = await configWith()
    const misdirected: number[] = []
    const openBrowser = vi.fn(async (url: string) => {
      const auth = new URL(url)
      const callback = new URL(auth.searchParams.get('redirect_uri')!)
      misdirected.push((await fetch(`${callback.origin}/?state=${auth.searchParams.get('state')}&code=wrong-path`)).status)
      await visit(url, a => ({ code: 'the-code', state: a.searchParams.get('state')! }))
    })

    await signInWithLoopback(config, { ...settings, loopbackRedirectUri: 'http://127.0.0.1/oauth/callback' }, { openBrowser })

    const redirect = new URL(openBrowser.mock.calls[0][0]).searchParams.get('redirect_uri')
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/)
    expect(misdirected).toEqual([404])
    expect(tokenForms.map(form => [form.get('code'), form.get('redirect_uri')])).toEqual([['the-code', redirect]])
  })

  it('uses the port loopbackRedirectUri names instead of a random one', async () => {
    const probe = http.createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as AddressInfo).port
    await new Promise(resolve => probe.close(resolve))
    const { config } = await configWith()
    const openBrowser = vi.fn(async (url: string) => {
      await visit(url, auth => ({ code: 'c', state: auth.searchParams.get('state')! }))
    })

    await signInWithLoopback(config, { ...settings, loopbackRedirectUri: `http://127.0.0.1:${port}/` }, { openBrowser })

    expect(new URL(openBrowser.mock.calls[0][0]).searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${port}/`)
  })

  it('refuses a loopbackRedirectUri that is not plain http on a loopback host, before opening anything', async () => {
    const { config } = await configWith()
    const openBrowser = vi.fn()

    await expect(signInWithLoopback(config, { ...settings, loopbackRedirectUri: 'https://example.com/callback' }, { openBrowser }))
      .rejects.toThrow('must be http://localhost, http://127.0.0.1 or http://[::1]')
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('answers a stray request 400 and keeps waiting for the real callback', async () => {
    const { config, tokenForms } = await configWith()
    const stray: { status: number }[] = []
    const openBrowser = vi.fn(async (url: string) => {
      stray.push(await visit(url, () => ({ code: 'stolen', state: 'forged' })))
      stray.push(await visit(url, () => ({})))
      await visit(url, auth => ({ code: 'the-code', state: auth.searchParams.get('state')! }))
    })

    const tokens = await signInWithLoopback(config, settings, { openBrowser })

    expect(stray.map(response => response.status)).toEqual([400, 400])
    expect(tokens.accessToken).toBe('at')
    expect(tokenForms.map(form => form.get('code'))).toEqual(['the-code'])
  })

  it('shows "Signed in" only after the code is redeemed, and a failure page when redemption fails', async () => {
    const { config } = await configWith(() => json({ error: 'invalid_grant', error_description: 'Code expired' }, 400))
    let page = ''
    const openBrowser = vi.fn(async (url: string) => {
      page = (await visit(url, auth => ({ code: 'c', state: auth.searchParams.get('state')! }))).page
    })

    await expect(signInWithLoopback(config, settings, { openBrowser })).rejects.toThrow('invalid_grant: Code expired')
    await vi.waitFor(() => expect(page).toContain('Sign-in failed'))
    expect(page).not.toContain('Signed in')
  })

  it('reports the issuer refusing the sign-in', async () => {
    const { config } = await configWith()
    const openBrowser = vi.fn(async (url: string) => {
      await visit(url, auth => ({ error: 'access_denied', error_description: 'The user cancelled', state: auth.searchParams.get('state')! }))
    })

    await expect(signInWithLoopback(config, settings, { openBrowser })).rejects.toThrow('access_denied: The user cancelled')
  })

  it('ends with "Sign-in was cancelled." when aborted, and closes the port', async () => {
    const { config } = await configWith()
    const controller = new AbortController()
    let redirectUri = ''
    const openBrowser = vi.fn((url: string) => {
      redirectUri = new URL(url).searchParams.get('redirect_uri')!
      controller.abort()
    })

    await expect(signInWithLoopback(config, settings, { openBrowser, signal: controller.signal })).rejects.toThrow('Sign-in was cancelled.')
    await expect(fetch(`${redirectUri}?state=x`)).rejects.toThrow()
  })

  it('gives up and closes the port when the browser never comes back', async () => {
    const { config } = await configWith()
    let redirectUri = ''
    const openBrowser = vi.fn((url: string) => { redirectUri = new URL(url).searchParams.get('redirect_uri')! })

    await expect(signInWithLoopback(config, settings, { openBrowser, timeoutMs: 50 })).rejects.toThrow(/timed out/)
    await expect(fetch(`${redirectUri}?state=x`)).rejects.toThrow()
  })
})
