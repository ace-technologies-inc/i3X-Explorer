import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  beginAuthorization,
  completeAuthorization,
  discoverIssuer,
  endSessionUrl,
  refreshTokens,
  revokeTokens,
  type OAuthSettings,
} from './oauthProtocol'

const issuer = 'https://login.example.com/tenant/v2.0'

const settings: OAuthSettings = {
  issuer,
  clientId: 'explorer',
  scopes: ['openid', 'profile', 'api://i3x/read'],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const base64Url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

/** An ID token as the issuer would send it; claims are what openid-client checks (the token comes over TLS). */
function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000)
  const body = { iss: issuer, aud: 'explorer', sub: 'user-1', iat: now, exp: now + 3600, ...claims }
  return `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(JSON.stringify(body))}.${base64Url('signature')}`
}

interface Recorded {
  url: string
  method: string
  form: URLSearchParams
}

/** A stand-in authorization server reached through openid-client's custom fetch. */
function fakeIssuer(options: {
  metadata?: Record<string, unknown>
  token?: (form: URLSearchParams) => Response
  oidcStatus?: number
} = {}) {
  const requests: Recorded[] = []
  const metadata: Record<string, string> = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    ...options.metadata,
  }
  const fetch = vi.fn(async (url: string, init: { method?: string; body?: unknown }) => {
    const form = new URLSearchParams(init.body === undefined ? '' : String(init.body))
    requests.push({ url, method: init.method ?? 'GET', form })
    if (url.endsWith('/.well-known/openid-configuration')) {
      return options.oidcStatus ? json({}, options.oidcStatus) : json(metadata)
    }
    if (url.includes('/.well-known/oauth-authorization-server')) return json(metadata)
    if (url === metadata.token_endpoint) return (options.token ?? (() => json({ access_token: 'at', token_type: 'Bearer' })))(form)
    if (url === metadata.revocation_endpoint) return new Response(null, { status: 200 })
    return json({ error: 'not_found' }, 404)
  })
  return { fetch, requests, metadata }
}

describe('discoverIssuer', () => {
  it('reads OIDC discovery under the issuer path', async () => {
    const server = fakeIssuer()
    const config = await discoverIssuer(settings, { fetch: server.fetch })

    expect(server.requests[0].url).toBe(`${issuer}/.well-known/openid-configuration`)
    expect(config.serverMetadata().token_endpoint).toBe(`${issuer}/token`)
  })

  it('falls back to RFC 8414 metadata', async () => {
    const server = fakeIssuer({ oidcStatus: 404 })
    await discoverIssuer(settings, { fetch: server.fetch })

    expect(server.requests.map(request => request.url)).toEqual([
      `${issuer}/.well-known/openid-configuration`,
      'https://login.example.com/.well-known/oauth-authorization-server/tenant/v2.0',
    ])
  })

  it('refuses metadata that names another issuer', async () => {
    const server = fakeIssuer({ metadata: { issuer: 'https://evil.example.com' } })
    await expect(discoverIssuer(settings, { fetch: server.fetch })).rejects.toThrow(/Could not read the sign-in settings/)
  })

  it('refuses a plain-http issuer before sending anything', async () => {
    const server = fakeIssuer()
    await expect(discoverIssuer({ ...settings, issuer: 'http://login.example.com' }, { fetch: server.fetch }))
      .rejects.toThrow('The issuer must be an https URL')
    expect(server.fetch).not.toHaveBeenCalled()
  })

  it('allows a plain-http issuer on localhost for a local identity provider', async () => {
    const local = 'http://localhost:8180/realms/i3x'
    const fetch = vi.fn(async () => json({ issuer: local, authorization_endpoint: `${local}/auth`, token_endpoint: `${local}/token` }))
    const config = await discoverIssuer({ ...settings, issuer: local }, { fetch })
    expect(config.serverMetadata().issuer).toBe(local)
  })
})

describe('beginAuthorization', () => {
  it('sends the code flow parameters with an S256 challenge of its verifier, and extra parameters cannot replace them', async () => {
    const config = await discoverIssuer(settings, { fetch: fakeIssuer().fetch })
    const pending = await beginAuthorization(
      config,
      {
        ...settings,
        resource: 'https://i3x.example.com',
        extraParams: { prompt: 'select_account', client_id: 'evil', redirect_uri: 'https://evil.example.com', Scope: 'everything' },
      },
      'http://localhost:51234'
    )
    const query = Object.fromEntries(pending.url.searchParams)

    expect(pending.url.origin + pending.url.pathname).toBe(`${issuer}/authorize`)
    expect(query).toEqual({
      prompt: 'select_account',
      client_id: 'explorer',
      response_type: 'code',
      redirect_uri: 'http://localhost:51234/',
      scope: 'openid profile api://i3x/read',
      code_challenge: createHash('sha256').update(pending.codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: pending.state,
      nonce: pending.nonce,
      resource: 'https://i3x.example.com',
    })
    expect(pending.redirectUri).toBe('http://localhost:51234/')
  })

  it('sends no nonce for a plain OAuth 2.0 sign-in without the openid scope', async () => {
    const config = await discoverIssuer(settings, { fetch: fakeIssuer().fetch })
    const pending = await beginAuthorization(config, { ...settings, scopes: ['api://i3x/read'] }, 'https://explorer.example.com/explorer/oauth/callback.html')

    expect(pending.nonce).toBeUndefined()
    expect(pending.url.searchParams.has('nonce')).toBe(false)
    expect(pending.redirectUri).toBe('https://explorer.example.com/explorer/oauth/callback.html')
  })
})

describe('completeAuthorization', () => {
  async function started(server = fakeIssuer(), scopes = settings.scopes) {
    const config = await discoverIssuer(settings, { fetch: server.fetch })
    const pending = await beginAuthorization(config, { ...settings, scopes }, 'http://localhost:51234/')
    return { server, config, pending }
  }

  it('redeems the code with its verifier and the same redirect URI, checks the ID token and reads the name', async () => {
    let nonce = ''
    const server = fakeIssuer({
      token: () => json({
        access_token: 'at', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt',
        id_token: idToken({ nonce, name: 'Pat Doe' }),
      }),
    })
    const { config, pending } = await started(server)
    nonce = pending.nonce!

    const before = Date.now()
    const tokens = await completeAuthorization(config, pending, `?code=the-code&state=${pending.state}`, settings)
    const after = Date.now()

    const tokenRequest = server.requests.find(request => request.url === `${issuer}/token`)!
    expect(Object.fromEntries(tokenRequest.form)).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'explorer',
      code: 'the-code',
      redirect_uri: 'http://localhost:51234/',
      code_verifier: pending.codeVerifier,
    })
    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt', accountName: 'Pat Doe' })
    // openid-client counts the lifetime down in whole seconds, so allow up to one second less.
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000)
    expect(tokens.expiresAt).toBeLessThanOrEqual(after + 3_600_000)
  })

  it('rejects a callback for another sign-in and redeems nothing', async () => {
    const { server, config, pending } = await started()
    await expect(completeAuthorization(config, pending, '?code=stolen&state=forged', settings)).rejects.toThrow()
    expect(server.requests.some(request => request.url === `${issuer}/token`)).toBe(false)
  })

  it('surfaces the issuer refusing the sign-in', async () => {
    const { config, pending } = await started()
    await expect(completeAuthorization(config, pending, `?error=access_denied&error_description=The+user+cancelled&state=${pending.state}`, settings))
      .rejects.toThrow('access_denied: The user cancelled')
  })

  it('rejects an ID token whose nonce belongs to another sign-in', async () => {
    const server = fakeIssuer({ token: () => json({ access_token: 'at', token_type: 'Bearer', id_token: idToken({ nonce: 'replayed' }) }) })
    const { config, pending } = await started(server)
    await expect(completeAuthorization(config, pending, `?code=c&state=${pending.state}`, settings)).rejects.toThrow()
  })

  it('refuses to send the code to a token endpoint that is not https', async () => {
    const server = fakeIssuer({ metadata: { token_endpoint: 'http://login.example.com/token' } })
    const { config, pending } = await started(server, ['api://i3x/read'])
    await expect(completeAuthorization(config, pending, `?code=c&state=${pending.state}`, settings)).rejects.toThrow()
    expect(server.requests.some(request => request.url === 'http://login.example.com/token')).toBe(false)
  })

  it('reports the issuer error from a refused exchange', async () => {
    const server = fakeIssuer({ token: () => json({ error: 'invalid_grant', error_description: 'Code expired' }, 400) })
    const { config, pending } = await started(server, ['api://i3x/read'])
    await expect(completeAuthorization(config, pending, `?code=c&state=${pending.state}`, settings)).rejects.toThrow('invalid_grant: Code expired')
  })
})

describe('refreshTokens', () => {
  it('refreshes with the same scopes and keeps the refresh token and name when none is returned', async () => {
    const server = fakeIssuer({ token: () => json({ access_token: 'renewed', token_type: 'Bearer' }) })
    const config = await discoverIssuer(settings, { fetch: server.fetch })

    const tokens = await refreshTokens(config, settings, { accessToken: 'old', refreshToken: 'rt', accountName: 'Pat Doe' })

    expect(tokens).toMatchObject({ accessToken: 'renewed', refreshToken: 'rt', accountName: 'Pat Doe' })
    expect(Object.fromEntries(server.requests[server.requests.length - 1].form)).toMatchObject({
      grant_type: 'refresh_token',
      client_id: 'explorer',
      refresh_token: 'rt',
      scope: 'openid profile api://i3x/read',
    })
  })

  it('cannot refresh without a refresh token, and asks nothing of the issuer', async () => {
    const server = fakeIssuer()
    const config = await discoverIssuer(settings, { fetch: server.fetch })
    await expect(refreshTokens(config, settings, { accessToken: 'only' })).rejects.toThrow('The sign-in has expired')
    expect(server.requests).toHaveLength(1)
  })
})

describe('sign-out', () => {
  it('revokes the refresh token only where the issuer offers revocation', async () => {
    const withRevocation = fakeIssuer({ metadata: { revocation_endpoint: `${issuer}/revoke` } })
    const revoking = await discoverIssuer(settings, { fetch: withRevocation.fetch })
    expect(await revokeTokens(revoking, { accessToken: 'at', refreshToken: 'rt' })).toBe(true)
    expect(Object.fromEntries(withRevocation.requests[withRevocation.requests.length - 1].form)).toMatchObject({ token: 'rt', token_type_hint: 'refresh_token' })

    const without = fakeIssuer()
    const plain = await discoverIssuer(settings, { fetch: without.fetch })
    expect(await revokeTokens(plain, { accessToken: 'at', refreshToken: 'rt' })).toBe(false)
    expect(without.requests).toHaveLength(1)
  })

  it('builds the end-session URL with the ID token hint, and none when the issuer has no such page', async () => {
    const withLogout = await discoverIssuer(settings, { fetch: fakeIssuer({ metadata: { end_session_endpoint: `${issuer}/logout` } }).fetch })
    const url = endSessionUrl(withLogout, { accessToken: 'at', idToken: 'the-id-token' })!
    expect(url.origin + url.pathname).toBe(`${issuer}/logout`)
    expect(url.searchParams.get('id_token_hint')).toBe('the-id-token')
    expect(url.searchParams.get('client_id')).toBe('explorer')

    const without = await discoverIssuer(settings, { fetch: fakeIssuer().fetch })
    expect(endSessionUrl(without, { accessToken: 'at' })).toBeUndefined()
  })
})
