// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { destroyClient, getClient } from '../api/client'
import { HttpStatusError } from '../api/subscription'
import type { ObjectInstance } from '../api/types'
import { useConnectionStore } from '../stores/connection'
import { useExplorerStore } from '../stores/explorer'
import { connectErrorMessage, performConnect } from './connection'
import { loadRuntimeConfig, SITE_CONFIG_URL } from '../config/runtimeConfig'

function jsonResponse(body: unknown): Response {
  const text = JSON.stringify(body)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    redirected: false,
    url: '',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  } as Response
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    statusText: 'Error',
    redirected: false,
    url: '',
    headers: new Headers(),
    text: async () => body,
  } as Response
}

const objects: ObjectInstance[] = [{
  elementId: 'root',
  displayName: 'Root',
  typeId: 'T',
  parentId: null,
  isComposition: false,
  namespaceUri: 'urn:test',
}]

afterEach(() => {
  destroyClient()
  useConnectionStore.getState().disconnect()
  useExplorerStore.getState().reset()
  vi.unstubAllGlobals()
})

describe('performConnect initial loading', () => {
  it('keeps loading until both catalog and type definitions finish', async () => {
    let resolveObjectTypes!: (response: Response) => void
    const objectTypesResponse = new Promise<Response>(resolve => {
      resolveObjectTypes = resolve
    })
    let objectCatalogResponded = false
    const requested: string[] = []

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requested.push(url.pathname + url.search)
      if (url.pathname.endsWith('/info')) return jsonResponse({ specVersion: '1.0' })
      if (url.pathname.endsWith('/namespaces')) return jsonResponse({ success: true, result: [] })
      if (url.pathname.endsWith('/objecttypes')) return objectTypesResponse
      if (url.pathname.endsWith('/relationshiptypes')) return jsonResponse({ success: true, result: [] })
      if (url.pathname.endsWith('/objects')) {
        if (url.searchParams.has('root')) return jsonResponse({ success: true, result: objects })
        objectCatalogResponded = true
        return jsonResponse({ success: true, result: objects })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    useConnectionStore.getState().setServerUrl('https://server.example/v1')
    const connecting = performConnect()

    await vi.waitFor(() => {
      expect(objectCatalogResponded).toBe(true)
      expect(requested.some(path => path.startsWith('/v1/objecttypes?'))).toBe(true)
    })
    expect(useExplorerStore.getState().isLoading).toBe(true)
    // The catalog is listed without metadata and takes its namespaces from the types.
    expect(useExplorerStore.getState().allObjectsLoaded).toBe(false)

    resolveObjectTypes(jsonResponse({ success: true, result: [] }))
    await connecting

    expect(useExplorerStore.getState().isLoading).toBe(false)
    expect(useExplorerStore.getState().allObjects.map(object => object.elementId)).toEqual(['root'])
    expect(requested).toContain('/v1/objects?includeMetadata=false')
  })

  it('reports a definitions failure without waiting for the catalog, and discards the late catalog', async () => {
    let resolveCatalog!: (response: Response) => void
    const catalogResponse = new Promise<Response>(resolve => {
      resolveCatalog = resolve
    })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/info')) return jsonResponse({ specVersion: '1.0' })
      if (url.pathname.endsWith('/namespaces')) return jsonResponse({ success: true, result: [] })
      if (url.pathname.endsWith('/objecttypes')) return errorResponse(500, 'types unavailable')
      if (url.pathname.endsWith('/relationshiptypes')) return jsonResponse({ success: true, result: [] })
      if (url.pathname.endsWith('/objects')) {
        if (url.searchParams.has('root')) return jsonResponse({ success: true, result: objects })
        return catalogResponse
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    useConnectionStore.getState().setServerUrl('https://server.example/v1')
    await performConnect()

    expect(useConnectionStore.getState().isConnected).toBe(false)
    expect(useConnectionStore.getState().error).toContain('types unavailable')
    expect(useExplorerStore.getState().isLoading).toBe(false)

    resolveCatalog(jsonResponse({ success: true, result: objects }))
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(useExplorerStore.getState().allObjects).toEqual([])
    expect(useConnectionStore.getState().error).toContain('types unavailable')
  })

  it('names a refused credential rather than reporting a failed connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/info')) return jsonResponse({ specVersion: '1.0' })
      return errorResponse(401, JSON.stringify({ responseDetail: { status: 401, detail: 'Token expired.' } }))
    }))

    useConnectionStore.getState().setServerUrl('https://server.example/v1')
    await performConnect()

    expect(useConnectionStore.getState().isConnected).toBe(false)
    expect(useConnectionStore.getState().error)
      .toBe('The server requires sign-in, or it rejected the credentials (HTTP 401). Token expired.')
  })
})

describe('performConnect with OAuth', () => {
  const issuer = 'https://login.example.com/tenant/v2.0'

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI
  })

  function stubServer(sentAuthorization: (string | undefined)[]) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input)
      if (target === SITE_CONFIG_URL) {
        return jsonResponse({
          env: {
            I3X_OAUTH_COMPANY_ISSUER: issuer,
            I3X_OAUTH_COMPANY_CLIENT_ID: 'explorer',
            I3X_OAUTH_COMPANY_SCOPES: 'openid api://i3x/read',
            I3X_OAUTH_COMPANY_APPLIES_TO: 'https://server.example',
            I3X_OAUTH_PARTNER_ISSUER: issuer,
            I3X_OAUTH_PARTNER_CLIENT_ID: 'partner-app',
            I3X_OAUTH_PARTNER_SCOPES: 'openid api://i3x/read',
            I3X_OAUTH_PARTNER_APPLIES_TO: 'https://server.example',
          },
        })
      }
      if (target.startsWith(issuer)) throw new Error(`The desktop app does discovery in the main process, not the window: ${target}`)
      const url = new URL(target)
      sentAuthorization.push((init?.headers as Record<string, string> | undefined)?.Authorization)
      if (url.pathname.endsWith('/info')) return jsonResponse({ specVersion: '1.0' })
      if (url.pathname.endsWith('/objects')) return jsonResponse({ success: true, result: objects })
      return jsonResponse({ success: true, result: [] })
    }))
  }

  it('signs in with the best profile for the server and sends its token on every request', async () => {
    const sent: (string | undefined)[] = []
    stubServer(sent)
    const oauthSignIn = vi.fn(async () => ({ accessToken: 'entra-token', accountName: 'Pat Doe' }))
    ;(window as { electronAPI?: unknown }).electronAPI = { oauthSignIn, encryptString: async () => null, decryptString: async () => null }
    await loadRuntimeConfig()

    useConnectionStore.getState().setServerUrl('https://server.example/v1')
    useConnectionStore.getState().setCredentials({ type: 'oauth' })
    await performConnect()

    expect(useConnectionStore.getState().error).toBeNull()
    expect(useConnectionStore.getState().isConnected).toBe(true)
    expect(useConnectionStore.getState().accountName).toBe('Pat Doe')
    expect(useConnectionStore.getState().signInPending).toBe(false)
    // Both profiles cover the server equally, so the first by name wins; the main process gets its settings.
    expect(oauthSignIn).toHaveBeenCalledWith(expect.objectContaining({
      issuer,
      clientId: 'explorer',
      scopes: ['openid', 'api://i3x/read'],
    }))
    expect(sent.length).toBeGreaterThan(1)
    // The first /info probe goes without credentials, to see where it redirects before the token is sent.
    expect(sent[0]).toBeUndefined()
    expect(new Set(sent.slice(1))).toEqual(new Set(['Bearer entra-token']))
  })

  it('signs in with the profile the connection names', async () => {
    stubServer([])
    const oauthSignIn = vi.fn(async () => ({ accessToken: 'partner-token' }))
    ;(window as { electronAPI?: unknown }).electronAPI = { oauthSignIn, encryptString: async () => null, decryptString: async () => null }
    await loadRuntimeConfig()

    useConnectionStore.getState().setServerUrl('https://server.example/v1')
    useConnectionStore.getState().setCredentials({ type: 'oauth', profile: 'partner' })
    await performConnect()

    expect(useConnectionStore.getState().error).toBeNull()
    expect(oauthSignIn).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'partner-app' }))
  })

  it('does not swap a named profile that is no longer configured for another one', async () => {
    const sent: (string | undefined)[] = []
    stubServer(sent)
    const oauthSignIn = vi.fn()
    ;(window as { electronAPI?: unknown }).electronAPI = { oauthSignIn, encryptString: async () => null, decryptString: async () => null }
    await loadRuntimeConfig()

    useConnectionStore.getState().setServerUrl('https://server.example/v1')
    useConnectionStore.getState().setCredentials({ type: 'oauth', profile: 'retired' })
    await performConnect()

    expect(useConnectionStore.getState().error)
      .toBe('The sign-in profile "retired" is not configured for this server. Choose another in the connection dialog.')
    expect(oauthSignIn).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('does not use a profile for a server it does not apply to', async () => {
    const sent: (string | undefined)[] = []
    stubServer(sent)
    const oauthSignIn = vi.fn()
    ;(window as { electronAPI?: unknown }).electronAPI = { oauthSignIn, encryptString: async () => null, decryptString: async () => null }
    await loadRuntimeConfig()

    useConnectionStore.getState().setServerUrl('https://other.example/v1')
    useConnectionStore.getState().setCredentials({ type: 'oauth' })
    await performConnect()

    expect(useConnectionStore.getState().error).toBe('No OAuth sign-in settings apply to this server. Enter them in the connection dialog.')
    expect(oauthSignIn).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('refuses a redirect to a server its profile does not cover, and sends the token nowhere else', async () => {
    stubServer([])
    const requested: string[] = []
    const serve = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const target = String(input)
      if (target === SITE_CONFIG_URL) return serve(input, init)
      requested.push(target)
      if (target === 'https://server.example/v1/info') {
        return { ...jsonResponse({ specVersion: '1.0' }), redirected: true, url: 'https://elsewhere.example/v1/info' } as Response
      }
      return serve(input, init)
    })
    ;(window as { electronAPI?: unknown }).electronAPI = {
      oauthSignIn: async () => ({ accessToken: 'company-token' }), encryptString: async () => null, decryptString: async () => null,
    }
    await loadRuntimeConfig()

    useConnectionStore.getState().setServerUrl('https://server.example/v1')
    useConnectionStore.getState().setCredentials({ type: 'oauth', profile: 'company' })
    await performConnect()

    expect(useConnectionStore.getState().error)
      .toBe('The server redirected to https://elsewhere.example/v1, which this sign-in does not cover; nothing was sent there.')
    expect(useConnectionStore.getState().isConnected).toBe(false)
    expect(requested).toEqual(['https://server.example/v1/info'])
  })

  describe('with custom settings', () => {
    const custom = { issuer, clientId: 'own-app', scopes: ['openid', 'api://i3x/read'] }

    /** Serves /info redirected from `from` to `to`, recording each request's URL and Authorization. */
    function redirectInfo(from: string, to: string) {
      const requests: [string, string | undefined][] = []
      stubServer([])
      const serve = vi.mocked(fetch).getMockImplementation()!
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const target = String(input)
        if (target === SITE_CONFIG_URL) return serve(input, init)
        requests.push([target, (init?.headers as Record<string, string> | undefined)?.Authorization])
        if (target === from) return { ...jsonResponse({ specVersion: '1.0' }), redirected: true, url: to } as Response
        return serve(input, init)
      })
      ;(window as { electronAPI?: unknown }).electronAPI = {
        oauthSignIn: async () => ({ accessToken: 'own-token' }), encryptString: async () => null, decryptString: async () => null,
      }
      return requests
    }

    it('refuses a redirect from https down to http, so the token never travels in clear text', async () => {
      const requests = redirectInfo('https://server.example/v1/info', 'http://server.example/v1/info')
      await loadRuntimeConfig()

      useConnectionStore.getState().setServerUrl('https://server.example/v1')
      useConnectionStore.getState().setCredentials({ type: 'oauth', settings: custom })
      await performConnect()

      expect(useConnectionStore.getState().error)
        .toBe('The server redirected to http://server.example/v1, which this sign-in does not cover; nothing was sent there.')
      expect(requests).toEqual([['https://server.example/v1/info', undefined]])
    })

    it('refuses a redirect to another port on the same host', async () => {
      redirectInfo('https://server.example/v1/info', 'https://server.example:8443/v1/info')
      await loadRuntimeConfig()

      useConnectionStore.getState().setServerUrl('https://server.example/v1')
      useConnectionStore.getState().setCredentials({ type: 'oauth', settings: custom })
      await performConnect()

      expect(useConnectionStore.getState().error).toContain('https://server.example:8443/v1, which this sign-in does not cover')
    })

    it('follows an upgrade from http to https on the same host, and sends the token only there', async () => {
      const requests = redirectInfo('http://server.example/v1/info', 'https://server.example/v1/info')
      await loadRuntimeConfig()

      useConnectionStore.getState().setServerUrl('http://server.example/v1')
      useConnectionStore.getState().setCredentials({ type: 'oauth', settings: custom })
      await performConnect()

      expect(useConnectionStore.getState().error).toBeNull()
      expect(useConnectionStore.getState().serverUrl).toBe('https://server.example/v1')
      expect(requests[0]).toEqual(['http://server.example/v1/info', undefined])
      expect(new Set(requests.slice(1).map(([url, auth]) => [new URL(url).origin, auth].join(' '))))
        .toEqual(new Set(['https://server.example Bearer own-token']))
    })
  })
})

describe('connectErrorMessage', () => {
  it('explains a 403 as an account the server does not allow, keeping the server detail', () => {
    expect(connectErrorMessage(new HttpStatusError(403, 'Missing role.')))
      .toBe('The server accepted the credentials, but this account is not allowed to use it (HTTP 403). Missing role.')
  })

  it('leaves other failures as they are', () => {
    expect(connectErrorMessage(new HttpStatusError(500, 'boom'))).toBe('HTTP 500: boom')
    expect(connectErrorMessage('not an error')).toBe('Connection failed')
  })
})

describe('performConnect against a server that is not an i3X 1.0 release', () => {
  it('refuses it, says what the server answered, and requests nothing but /info', async () => {
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/info')) return jsonResponse({ version: '0.4' })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchStub)

    useConnectionStore.getState().setServerUrl('https://old-server.example/api')
    await performConnect()

    const connection = useConnectionStore.getState()
    expect(connection.isConnected).toBe(false)
    expect(connection.isConnecting).toBe(false)
    expect(connection.unsupportedServer).toBe('spec version 0.4')
    expect(connection.error).toBe(
      'This server does not implement i3X 1.0 (found: spec version 0.4). i3X Explorer 1.1 supports 1.0 servers only.'
    )
    expect(getClient()).toBeNull()
    expect(fetchStub).toHaveBeenCalledOnce()
  })

  it('clears an earlier refusal when the next connect succeeds', async () => {
    useConnectionStore.getState().setUnsupportedServer('spec version 0.4')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/info')) return jsonResponse({ specVersion: '1.0' })
      if (url.pathname.endsWith('/objects')) return jsonResponse({ success: true, result: objects })
      return jsonResponse({ success: true, result: [] })
    }))

    useConnectionStore.getState().setServerUrl('https://server.example/v1')
    await performConnect()

    expect(useConnectionStore.getState().isConnected).toBe(true)
    expect(useConnectionStore.getState().unsupportedServer).toBeNull()
  })
})
