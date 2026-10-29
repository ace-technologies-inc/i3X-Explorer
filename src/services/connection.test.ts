// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { destroyClient, getClient } from '../api/client'
import type { ObjectInstance } from '../api/types'
import { useConnectionStore } from '../stores/connection'
import { useExplorerStore } from '../stores/explorer'
import { performConnect } from './connection'

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
