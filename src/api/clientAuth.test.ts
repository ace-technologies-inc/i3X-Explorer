import { afterEach, describe, expect, it, vi } from 'vitest'
import { I3XClient } from './client'
import { BearerTokenProvider } from './authProvider'
import { HttpStatusError } from './subscription'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function authorizationOf(call: unknown[]): string | undefined {
  return ((call[1] as RequestInit).headers as Record<string, string>).Authorization
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The /info probe's answer after the browser followed a redirect to `finalUrl`. */
function redirectedTo(finalUrl: string): Response {
  const response = json({ specVersion: '1.0' })
  Object.defineProperty(response, 'redirected', { value: true })
  Object.defineProperty(response, 'url', { value: finalUrl })
  return response
}

describe('I3XClient credential scope', () => {
  const scoped = (allowedHost: string) => ({
    getHeaders: async () => ({ Authorization: 'Bearer scoped-token' }),
    handleUnauthorized: async () => false,
    permits: (baseUrl: string) => new URL(baseUrl).hostname === allowedHost,
  })

  it('refuses a redirect to a server the credentials do not cover, and sends them nowhere else', async () => {
    const fetchStub = vi.fn(async (url: string) =>
      url === 'https://server.example/v1/info' ? redirectedTo('https://elsewhere.example/v1/info') : json({ success: true, result: [] }))
    vi.stubGlobal('fetch', fetchStub)
    const client = new I3XClient('https://server.example/v1', null, scoped('server.example'))

    await expect(client.testConnection()).rejects.toThrow('The server redirected to https://elsewhere.example/v1')
    expect(client.getBaseUrl()).toBe('https://server.example/v1')
    expect(fetchStub.mock.calls.map(call => call[0])).toEqual(['https://server.example/v1/info'])
  })

  it('follows a redirect that stays within the credentials, such as an upgrade to https', async () => {
    const fetchStub = vi.fn(async (url: string) =>
      url === 'http://server.example/v1/info' ? redirectedTo('https://server.example/v1/info') : json({ success: true, result: [] }))
    vi.stubGlobal('fetch', fetchStub)
    const client = new I3XClient('http://server.example/v1', null, scoped('server.example'))

    expect(await client.testConnection()).toBe(true)
    expect(client.getBaseUrl()).toBe('https://server.example/v1')
    expect(fetchStub.mock.calls.map(call => [call[0], authorizationOf(call)])).toEqual([
      ['http://server.example/v1/info', undefined],
      ['https://server.example/v1/namespaces?includeMetadata=true', 'Bearer scoped-token'],
    ])
  })
})

describe('I3XClient auth', () => {
  it('reads the auth headers for every request, so a renewed token is used without reconnecting', async () => {
    const fetchStub = vi.fn(async () => json([]))
    vi.stubGlobal('fetch', fetchStub)
    let token = 'first'
    const client = new I3XClient('https://server.example', null, {
      getHeaders: async () => ({ Authorization: `Bearer ${token}` }),
      handleUnauthorized: async () => false,
    })

    await client.getNamespaces()
    token = 'second'
    await client.getNamespaces()

    expect(fetchStub.mock.calls.map(authorizationOf)).toEqual(['Bearer first', 'Bearer second'])
  })

  it('retries once with the renewed token after a 401', async () => {
    const fetchStub = vi.fn(async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>).Authorization === 'Bearer renewed'
        ? json([{ uri: 'urn:a', displayName: 'A' }])
        : json({ error: { message: 'token expired' } }, 401))
    vi.stubGlobal('fetch', fetchStub)
    const client = new I3XClient('https://server.example', null,
      new BearerTokenProvider(async () => ({ accessToken: 'renewed' }), { accessToken: 'expired' }))

    expect(await client.getNamespaces()).toEqual([{ uri: 'urn:a', displayName: 'A' }])
    expect(fetchStub.mock.calls.map(authorizationOf)).toEqual(['Bearer expired', 'Bearer renewed'])
  })

  it('does not retry a 401 when the provider has nothing newer', async () => {
    const fetchStub = vi.fn(async () => json({ error: { message: 'bad key' } }, 401))
    vi.stubGlobal('fetch', fetchStub)
    const client = new I3XClient('https://server.example', { type: 'header', headerName: 'X-API-Key', headerValue: 'k' })

    const failure = await client.getNamespaces().catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(HttpStatusError)
    expect((failure as HttpStatusError).status).toBe(401)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('retries a 401 at most once even when every token is refused', async () => {
    let n = 0
    const fetchStub = vi.fn(async () => json({ error: { message: 'no' } }, 401))
    vi.stubGlobal('fetch', fetchStub)
    const client = new I3XClient('https://server.example', null,
      new BearerTokenProvider(async () => ({ accessToken: `t${++n}` }), { accessToken: 't0' }))

    await expect(client.getNamespaces()).rejects.toBeInstanceOf(HttpStatusError)
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('testConnection reports a refused credential instead of a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/info') ? json({ specVersion: '1.0' }) : json({ responseDetail: { status: 403, detail: 'no role' } }, 403)))
    const client = new I3XClient('https://server.example')

    const failure = await client.testConnection().catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(HttpStatusError)
    expect((failure as HttpStatusError).status).toBe(403)
  })

  it('testConnection still answers false for a server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/info') ? json({ specVersion: '1.0' }) : json({}, 500)))
    expect(await new I3XClient('https://server.example').testConnection()).toBe(false)
  })
})
