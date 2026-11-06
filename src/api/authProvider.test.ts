import { describe, expect, it, vi } from 'vitest'
import { BearerTokenProvider, StaticAuthProvider, TOKEN_REFRESH_MARGIN_MS } from './authProvider'

describe('StaticAuthProvider', () => {
  it('sends the typed credentials and never claims a renewal', async () => {
    const provider = new StaticAuthProvider({ type: 'bearer', token: 'typed' })
    expect(await provider.getHeaders()).toEqual({ Authorization: 'Bearer typed' })
    expect(await provider.handleUnauthorized({ Authorization: 'Bearer typed' })).toBe(false)
  })

  it('sends no headers without credentials', async () => {
    expect(await new StaticAuthProvider(null).getHeaders()).toEqual({})
  })
})

describe('BearerTokenProvider', () => {
  const now = 1_000_000

  it('uses a token that is not near expiry without acquiring another', async () => {
    const acquire = vi.fn(async () => ({ accessToken: 'new' }))
    const provider = new BearerTokenProvider(acquire, { accessToken: 'current', expiresAt: now + TOKEN_REFRESH_MARGIN_MS + 1 }, () => now)

    expect(await provider.getHeaders()).toEqual({ Authorization: 'Bearer current' })
    expect(acquire).not.toHaveBeenCalled()
  })

  it('renews a token inside the refresh margin before sending it', async () => {
    const acquire = vi.fn(async () => ({ accessToken: 'renewed', expiresAt: now + 3_600_000 }))
    const provider = new BearerTokenProvider(acquire, { accessToken: 'expiring', expiresAt: now + TOKEN_REFRESH_MARGIN_MS }, () => now)

    expect(await provider.getHeaders()).toEqual({ Authorization: 'Bearer renewed' })
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('shares one renewal between concurrent requests', async () => {
    let release!: () => void
    const acquire = vi.fn(() => new Promise<{ accessToken: string }>(resolve => {
      release = () => resolve({ accessToken: 'shared' })
    }))
    const provider = new BearerTokenProvider(acquire, null, () => now)

    const requests = [provider.getHeaders(), provider.getHeaders(), provider.getHeaders()]
    release()

    expect(await Promise.all(requests)).toEqual(Array(3).fill({ Authorization: 'Bearer shared' }))
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  const refused = (token: string) => ({ Accept: 'application/json', Authorization: `Bearer ${token}` })

  it('renews after a 401 and allows a retry when the token changed', async () => {
    const acquire = vi.fn(async () => ({ accessToken: 'renewed' }))
    const provider = new BearerTokenProvider(acquire, { accessToken: 'rejected' }, () => now)

    expect(await provider.handleUnauthorized(refused('rejected'))).toBe(true)
    expect(await provider.getHeaders()).toEqual({ Authorization: 'Bearer renewed' })
  })

  it('refuses a retry when renewal hands back the refused token', async () => {
    const provider = new BearerTokenProvider(async () => ({ accessToken: 'same' }), { accessToken: 'same' }, () => now)
    expect(await provider.handleUnauthorized(refused('same'))).toBe(false)
  })

  it('refuses a retry when renewal fails', async () => {
    const provider = new BearerTokenProvider(async () => { throw new Error('refresh token expired') }, { accessToken: 'rejected' }, () => now)
    expect(await provider.handleUnauthorized(refused('rejected'))).toBe(false)
  })

  it('renews once when several requests are refused together', async () => {
    let release!: () => void
    const acquire = vi.fn(() => new Promise<{ accessToken: string }>(resolve => {
      release = () => resolve({ accessToken: 'renewed' })
    }))
    const provider = new BearerTokenProvider(acquire, { accessToken: 'rejected' }, () => now)

    const handlers = [provider.handleUnauthorized(refused('rejected')), provider.handleUnauthorized(refused('rejected'))]
    release()

    expect(await Promise.all(handlers)).toEqual([true, true])
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('retries without renewing again when the refused token was already replaced', async () => {
    const acquire = vi.fn(async () => ({ accessToken: `token-${acquire.mock.calls.length}` }))
    const provider = new BearerTokenProvider(acquire, { accessToken: 'old' }, () => now)

    expect(await provider.handleUnauthorized(refused('old'))).toBe(true)
    expect(acquire).toHaveBeenCalledTimes(1)

    // A request sent with 'old' before the renewal is refused after it.
    expect(await provider.handleUnauthorized(refused('old'))).toBe(true)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(await provider.getHeaders()).toEqual({ Authorization: 'Bearer token-1' })
  })

  it('renews when a request without a token is refused', async () => {
    const acquire = vi.fn(async () => ({ accessToken: 'first' }))
    const provider = new BearerTokenProvider(acquire, null, () => now)

    expect(await provider.handleUnauthorized({ Accept: 'application/json' })).toBe(true)
    expect(acquire).toHaveBeenCalledTimes(1)
  })
})
