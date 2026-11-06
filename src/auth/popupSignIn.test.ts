import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  CALLBACK_CHANNEL,
  cancelPopupSignIn,
  releaseSignInWindow,
  reserveSignInWindow,
  signInWithPopup,
} from './popupSignIn'
import { discoverIssuer, type OAuthSettings } from './oauthProtocol'

const issuer = 'https://login.example.com'
const redirectUri = 'https://explorer.example.com/explorer/oauth/callback.html'
const settings: OAuthSettings = { issuer, clientId: 'explorer', scopes: ['api://i3x/read'] }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function config() {
  const fetch = vi.fn(async (url: string) =>
    url.endsWith('/.well-known/openid-configuration')
      ? json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      : json({ access_token: 'at', token_type: 'Bearer' }))
  return discoverIssuer(settings, { fetch })
}

/** A stand-in popup window; `closed` can be flipped as a Cross-Origin-Opener-Policy would. */
function fakeWindow() {
  return {
    closed: false,
    location: { href: 'about:blank' },
    document: { title: '', body: { textContent: '' } },
    close: vi.fn(function (this: { closed: boolean }) { this.closed = true }),
  }
}

/** Plays the callback page: posts a redirect's query on the channel the sign-in listens to. */
function callback(search: string) {
  const channel = new BroadcastChannel(CALLBACK_CHANNEL)
  channel.postMessage({ search })
  channel.close()
}

const stateOf = (popup: ReturnType<typeof fakeWindow>) => new URL(popup.location.href).searchParams.get('state')!

// Node environment: jsdom's TextEncoder yields byte arrays from another realm, which oauth4webapi cannot encode.
let open: Mock<(url?: string | URL, target?: string, features?: string) => unknown>

beforeEach(() => {
  open = vi.fn()
  vi.stubGlobal('window', { open })
})

afterEach(() => {
  releaseSignInWindow()
  vi.unstubAllGlobals()
})

describe('signInWithPopup', () => {
  it('navigates the window reserved during the click instead of opening another', async () => {
    const popup = fakeWindow()
    open.mockReturnValue(popup)
    reserveSignInWindow()
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toBe('about:blank')

    const signingIn = signInWithPopup(config, settings, redirectUri)
    await vi.waitFor(() => expect(popup.location.href).toContain(`${issuer}/authorize`))
    callback(`?code=c&state=${stateOf(popup)}`)

    expect(await signingIn).toMatchObject({ accessToken: 'at' })
    expect(open).toHaveBeenCalledTimes(1)
    expect(popup.close).toHaveBeenCalled()
  })

  it('opens the window itself when none was reserved', async () => {
    const popup = fakeWindow()
    open.mockImplementation(url => {
      popup.location.href = String(url)
      return popup
    })

    const signingIn = signInWithPopup(config, settings, redirectUri)
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    callback(`?code=c&state=${stateOf(popup)}`)

    expect(await signingIn).toMatchObject({ accessToken: 'at' })
  })

  it('ignores a callback for another sign-in and keeps waiting', async () => {
    const popup = fakeWindow()
    open.mockReturnValue(popup)
    reserveSignInWindow()

    const signingIn = signInWithPopup(config, settings, redirectUri)
    await vi.waitFor(() => expect(popup.location.href).toContain('state='))
    callback('?code=stolen&state=forged')
    callback(`?code=c&state=${stateOf(popup)}`)

    expect(await signingIn).toMatchObject({ accessToken: 'at' })
  })

  it('keeps waiting when the window reads as closed, as it does under a Cross-Origin-Opener-Policy', async () => {
    const popup = fakeWindow()
    open.mockReturnValue(popup)
    reserveSignInWindow()

    const signingIn = signInWithPopup(config, settings, redirectUri)
    await vi.waitFor(() => expect(popup.location.href).toContain('state='))
    popup.closed = true
    await new Promise(resolve => setTimeout(resolve, 1_500))
    callback(`?code=c&state=${stateOf(popup)}`)

    expect(await signingIn).toMatchObject({ accessToken: 'at' })
  })

  it('ends with the reason it is cancelled for', async () => {
    const popup = fakeWindow()
    open.mockReturnValue(popup)
    reserveSignInWindow()

    const signingIn = signInWithPopup(config, settings, redirectUri)
    await vi.waitFor(() => expect(popup.location.href).toContain('state='))
    cancelPopupSignIn(new Error('Sign-in was cancelled.'))

    await expect(signingIn).rejects.toThrow('Sign-in was cancelled.')
    expect(popup.close).toHaveBeenCalled()
  })

  it('can be cancelled during discovery, and never navigates the window afterwards', async () => {
    const popup = fakeWindow()
    open.mockReturnValue(popup)
    reserveSignInWindow()
    let finishDiscovery!: () => void
    const discovered = new Promise<void>(resolve => { finishDiscovery = resolve })

    const signingIn = signInWithPopup(async () => { await discovered; return config() }, settings, redirectUri)
    cancelPopupSignIn(new Error('Sign-in was cancelled.'))
    finishDiscovery()

    await expect(signingIn).rejects.toThrow('Sign-in was cancelled.')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(popup.location.href).toBe('about:blank')
    expect(popup.close).toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('does not start a sign-in cancelled before it began, while its window was only reserved', async () => {
    const popup = fakeWindow()
    open.mockReturnValue(popup)
    reserveSignInWindow()
    cancelPopupSignIn(new Error('Sign-in was cancelled.'))
    const getConfig = vi.fn(config)

    await expect(signInWithPopup(getConfig, settings, redirectUri)).rejects.toThrow('Sign-in was cancelled.')
    expect(getConfig).not.toHaveBeenCalled()
    expect(popup.location.href).toBe('about:blank')
    expect(popup.close).toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('times out when no callback ever arrives', async () => {
    open.mockReturnValue(fakeWindow())
    await expect(signInWithPopup(config, settings, redirectUri, 50)).rejects.toThrow('Sign-in timed out')
  })

  it('says so when the browser blocks the window', async () => {
    open.mockReturnValue(null)
    await expect(signInWithPopup(config, settings, redirectUri)).rejects.toThrow('Allow pop-ups for this site')
  })
})

describe('releaseSignInWindow', () => {
  it('closes a reserved window no sign-in used', () => {
    const popup = fakeWindow()
    open.mockReturnValue(popup)
    reserveSignInWindow()

    releaseSignInWindow()

    expect(popup.close).toHaveBeenCalled()
  })
})
