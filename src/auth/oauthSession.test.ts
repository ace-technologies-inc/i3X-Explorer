import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  cancelOAuthSignIn,
  hasOAuthSession,
  openOAuthSession,
  signOutOAuth,
  withoutIpcPrefix,
  type OAuthTransport,
} from './oauthSession'
import type { OAuthSettings, TokenSet } from './oauthProtocol'

let issuerCount = 0

type MockTransport = { [K in keyof OAuthTransport]: Mock<OAuthTransport[K]> }

function setup(overrides: Partial<MockTransport> = {}) {
  const settings: OAuthSettings = {
    issuer: `https://login${++issuerCount}.example.com`,
    clientId: 'explorer',
    scopes: ['openid', 'api://i3x/read'],
  }
  const transport: MockTransport = {
    prepareSignIn: vi.fn(),
    releaseSignIn: vi.fn(),
    signIn: vi.fn<OAuthTransport['signIn']>(async (): Promise<TokenSet> => ({ accessToken: 'signed-in', refreshToken: 'rt-1', expiresAt: Date.now() + 3_600_000 })),
    refresh: vi.fn<OAuthTransport['refresh']>(async (): Promise<TokenSet> => ({ accessToken: 'refreshed', refreshToken: 'rt-2', expiresAt: Date.now() + 3_600_000 })),
    signOut: vi.fn<OAuthTransport['signOut']>(async () => ({ revoked: false, endedSession: false })),
    cancel: vi.fn(),
    ...overrides,
  }
  return { settings, transport }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('withoutIpcPrefix', () => {
  it("leaves the issuer's message from an Electron IPC rejection", () => {
    const ipc = new Error("Error invoking remote method 'oauth-sign-in': Error: invalid_client: AADSTS7000218: The request body must contain client_secret.")
    expect(withoutIpcPrefix(ipc).message).toBe('invalid_client: AADSTS7000218: The request body must contain client_secret.')
  })

  it('leaves a message without the wrapper as it is', () => {
    expect(withoutIpcPrefix(new Error('Sign-in timed out. Try again.')).message).toBe('Sign-in timed out. Try again.')
  })
})

describe('openOAuthSession', () => {
  it('signs in once, then reuses the session without signing in again', async () => {
    const { settings, transport } = setup()

    const first = await openOAuthSession(settings, transport)
    const second = await openOAuthSession(settings, transport)

    expect(await first.provider.getHeaders()).toEqual({ Authorization: 'Bearer signed-in' })
    expect(await second.provider.getHeaders()).toEqual({ Authorization: 'Bearer signed-in' })
    expect(transport.signIn).toHaveBeenCalledTimes(1)
    expect(transport.signIn).toHaveBeenCalledWith(settings)
  })

  it('prepares an interactive sign-in before its first await, and releases it afterwards', async () => {
    const { settings, transport } = setup()

    const opening = openOAuthSession(settings, transport)
    expect(transport.prepareSignIn).toHaveBeenCalledTimes(1)
    expect(transport.prepareSignIn.mock.invocationCallOrder[0]).toBeLessThan(transport.signIn.mock.invocationCallOrder[0])
    await opening

    expect(transport.releaseSignIn).toHaveBeenCalledTimes(1)
  })

  it('does not prepare a sign-in window for a session that is still valid', async () => {
    const { settings, transport } = setup()
    await openOAuthSession(settings, transport)
    transport.prepareSignIn.mockClear()

    await openOAuthSession(settings, transport)

    expect(transport.prepareSignIn).not.toHaveBeenCalled()
  })

  it('releases a prepared sign-in when the sign-in fails', async () => {
    const { settings, transport } = setup({ signIn: vi.fn<OAuthTransport['signIn']>(async () => { throw new Error('access_denied') }) })

    await expect(openOAuthSession(settings, transport)).rejects.toThrow('access_denied')
    expect(transport.releaseSignIn).toHaveBeenCalledTimes(1)
    expect(hasOAuthSession(settings)).toBe(false)
  })

  it('renews with the refresh token, never by opening another sign-in', async () => {
    const { settings, transport } = setup()
    const session = await openOAuthSession(settings, transport)

    expect(await session.provider.handleUnauthorized({ Authorization: 'Bearer signed-in' })).toBe(true)
    expect(await session.provider.getHeaders()).toEqual({ Authorization: 'Bearer refreshed' })
    expect(transport.refresh).toHaveBeenCalledWith(settings, expect.objectContaining({ refreshToken: 'rt-1' }))
    expect(transport.signIn).toHaveBeenCalledTimes(1)
  })

  it('refuses a retry when there is no refresh token, instead of signing in behind the person', async () => {
    const { settings, transport } = setup({ signIn: vi.fn<OAuthTransport['signIn']>(async () => ({ accessToken: 'only' })) })
    const session = await openOAuthSession(settings, transport)

    expect(await session.provider.handleUnauthorized({ Authorization: 'Bearer only' })).toBe(false)
    expect(transport.signIn).toHaveBeenCalledTimes(1)
  })

  it('refreshes an expiring session on reconnect, and signs in again only when that fails', async () => {
    vi.useFakeTimers({ now: 0 })
    const { settings, transport } = setup({
      signIn: vi.fn<OAuthTransport['signIn']>()
        .mockResolvedValueOnce({ accessToken: 'short', refreshToken: 'rt-1', expiresAt: 10_000 })
        .mockResolvedValueOnce({ accessToken: 'fresh', refreshToken: 'rt-2', expiresAt: 3_600_000 }),
      refresh: vi.fn<OAuthTransport['refresh']>(async () => { throw new Error('invalid_grant') }),
    })
    await openOAuthSession(settings, transport)
    vi.setSystemTime(10_000)

    const session = await openOAuthSession(settings, transport)

    expect(transport.refresh).toHaveBeenCalledTimes(1)
    expect(transport.signIn).toHaveBeenCalledTimes(2)
    expect(await session.provider.getHeaders()).toEqual({ Authorization: 'Bearer fresh' })
  })

  it('forgets a session whose renewal was refused, so a reconnect signs in again instead of reusing its token', async () => {
    const { settings, transport } = setup({
      signIn: vi.fn<OAuthTransport['signIn']>()
        .mockResolvedValueOnce({ accessToken: 'refused', refreshToken: 'revoked', expiresAt: Date.now() + 3_600_000 })
        .mockResolvedValueOnce({ accessToken: 'fresh', refreshToken: 'rt-2', expiresAt: Date.now() + 3_600_000 }),
      refresh: vi.fn<OAuthTransport['refresh']>(async () => { throw new Error('invalid_grant') }),
    })
    const session = await openOAuthSession(settings, transport)

    expect(await session.provider.handleUnauthorized({ Authorization: 'Bearer refused' })).toBe(false)
    expect(hasOAuthSession(settings)).toBe(false)

    const reconnected = await openOAuthSession(settings, transport)
    expect(transport.signIn).toHaveBeenCalledTimes(2)
    expect(await reconnected.provider.getHeaders()).toEqual({ Authorization: 'Bearer fresh' })
  })

  it('forgets an expiring session whose refresh failed even when the sign-in that follows is cancelled', async () => {
    vi.useFakeTimers({ now: 0 })
    const { settings, transport } = setup({
      signIn: vi.fn<OAuthTransport['signIn']>()
        .mockResolvedValueOnce({ accessToken: 'short', refreshToken: 'rt-1', expiresAt: 10_000 })
        .mockRejectedValueOnce(new Error('Sign-in was cancelled.')),
      refresh: vi.fn<OAuthTransport['refresh']>(async () => { throw new Error('invalid_grant') }),
    })
    await openOAuthSession(settings, transport)
    vi.setSystemTime(10_000)

    await expect(openOAuthSession(settings, transport)).rejects.toThrow('Sign-in was cancelled.')
    expect(hasOAuthSession(settings)).toBe(false)
  })

  it('keeps sessions for different audiences apart, but not for the same parameters in another order', async () => {
    const { settings, transport } = setup()
    await openOAuthSession({ ...settings, extraParams: { audience: 'api-a', prompt: 'login' } }, transport)
    await openOAuthSession({ ...settings, extraParams: { prompt: 'login', audience: 'api-a' } }, transport)
    expect(transport.signIn).toHaveBeenCalledTimes(1)

    await openOAuthSession({ ...settings, extraParams: { audience: 'api-b', prompt: 'login' } }, transport)

    expect(transport.signIn).toHaveBeenCalledTimes(2)
    expect(transport.signIn.mock.calls[1][0].extraParams).toEqual({ audience: 'api-b', prompt: 'login' })
  })

  it('keeps sessions for different scopes apart', async () => {
    const { settings, transport } = setup()
    await openOAuthSession(settings, transport)
    await openOAuthSession({ ...settings, scopes: ['openid', 'api://i3x/write'] }, transport)

    expect(transport.signIn).toHaveBeenCalledTimes(2)
  })

  it('names the signed-in account from the tokens', async () => {
    const { settings, transport } = setup({ signIn: vi.fn<OAuthTransport['signIn']>(async () => ({ accessToken: 'a', accountName: 'Pat Doe' })) })
    expect((await openOAuthSession(settings, transport)).accountName).toBe('Pat Doe')
  })
})

describe('signOutOAuth', () => {
  it('forgets the session and hands its tokens to the transport to revoke', async () => {
    const { settings, transport } = setup()
    await openOAuthSession(settings, transport)

    await signOutOAuth(settings, { endSession: true }, transport)

    expect(hasOAuthSession(settings)).toBe(false)
    expect(transport.signOut).toHaveBeenCalledWith(settings, expect.objectContaining({ refreshToken: 'rt-1' }), true)
    await openOAuthSession(settings, transport)
    expect(transport.signIn).toHaveBeenCalledTimes(2)
  })

  it('does not end the browser session unless asked', async () => {
    const { settings, transport } = setup()
    await openOAuthSession(settings, transport)

    await signOutOAuth(settings, {}, transport)

    expect(transport.signOut).toHaveBeenCalledWith(settings, expect.anything(), false)
  })
})

describe('cancelOAuthSignIn', () => {
  it('asks the transport to cancel the sign-in in progress', () => {
    const { transport } = setup()
    cancelOAuthSignIn(transport)
    expect(transport.cancel).toHaveBeenCalledTimes(1)
  })
})
