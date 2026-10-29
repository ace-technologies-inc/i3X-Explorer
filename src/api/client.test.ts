import { afterEach, describe, expect, it, vi } from 'vitest'
import { I3XClient } from './client'
import { AuthRequiredError, UnsupportedServerError } from './normalize'
import { HttpStatusError, isSubscriptionGoneError } from './subscription'

type StubResponse = {
  ok: boolean
  status: number
  statusText?: string
  redirected?: boolean
  url?: string
  headers?: Headers
  json?: () => Promise<unknown>
  text?: () => Promise<string>
  arrayBuffer?: () => Promise<ArrayBuffer>
}

// Route stubbed responses by "METHOD path". 204s and empty bodies must not
// throw SyntaxError out of requestRaw (a 204 /sync on an idle queue used to
// kill live updates via the transport's error handler).
function stubFetch(routes: Record<string, StubResponse>) {
  const fetchStub = vi.fn(async (url: string, options?: RequestInit) => {
    const path = new URL(url).pathname
    const key = `${options?.method ?? 'GET'} ${path}`
    const route = routes[key]
    if (!route) throw new Error(`No stub for ${key}`)
    return route as unknown as Response
  })
  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

function jsonResponse(body: unknown, status = 200): StubResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  }
}

const emptyBody = (status: number): StubResponse => ({
  ok: true,
  status,
  text: async () => '',
})

describe('I3XClient empty-body handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sync resolves [] on 204 No Content', async () => {
    stubFetch({ 'POST /subscriptions/sync': emptyBody(204) })
    const client = new I3XClient('http://server')
    await expect(client.sync('sub1')).resolves.toEqual([])
  })

  it('sync resolves [] on an empty 200 body', async () => {
    stubFetch({
      'POST /subscriptions/sync': { ok: true, status: 200, text: async () => '  ' },
    })
    const client = new I3XClient('http://server')
    await expect(client.sync('sub1')).resolves.toEqual([])
  })

  it('sync resolves [] on 204 after connecting', async () => {
    stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      'POST /subscriptions/sync': emptyBody(204),
    })
    const client = new I3XClient('http://server')
    await expect(client.testConnection()).resolves.toBe(true)
    await expect(client.sync('sub1')).resolves.toEqual([])
  })

  it('still surfaces malformed non-empty bodies as errors', async () => {
    stubFetch({
      'POST /subscriptions/sync': { ok: true, status: 200, text: async () => 'not json' },
    })
    const client = new I3XClient('http://server')
    await expect(client.sync('sub1')).rejects.toThrow()
  })
})

describe('I3XClient catalog metadata options', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests metadata by default for namespaces, object types, and relationship types', async () => {
    const fetchStub = stubFetch({
      'GET /namespaces': jsonResponse([]),
      'GET /objecttypes': jsonResponse([]),
      'GET /relationshiptypes': jsonResponse([]),
    })
    const client = new I3XClient('http://server')

    await client.getNamespaces()
    await client.getObjectTypes('urn:example:types')
    await client.getRelationshipTypes('urn:example:relationships')

    const requests = fetchStub.mock.calls.map(([url]) => new URL(url))
    expect(requests.map(url => [url.pathname, url.searchParams.get('includeMetadata'), url.searchParams.get('namespaceUri')])).toEqual([
      ['/namespaces', 'true', null],
      ['/objecttypes', 'true', 'urn:example:types'],
      ['/relationshiptypes', 'true', 'urn:example:relationships'],
    ])
  })

  it('allows callers to disable metadata explicitly', async () => {
    const fetchStub = stubFetch({
      'GET /namespaces': jsonResponse([]),
      'GET /objecttypes': jsonResponse([]),
      'GET /relationshiptypes': jsonResponse([]),
    })
    const client = new I3XClient('http://server')

    await client.getNamespaces(false)
    await client.getObjectTypes('urn:example:types', false)
    await client.getRelationshipTypes('urn:example:relationships', false)

    const requests = fetchStub.mock.calls.map(([url]) => new URL(url))
    expect(requests.map(url => url.searchParams.get('includeMetadata'))).toEqual(['false', 'false', 'false'])
  })
})

describe('I3XClient in-flight request coalescing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shares one fetch and parsed result for identical concurrent reads', async () => {
    const fetchStub = stubFetch({ 'GET /namespaces': jsonResponse([]) })
    const client = new I3XClient('http://server')

    const [first, second] = await Promise.all([client.getNamespaces(), client.getNamespaces()])

    expect(fetchStub).toHaveBeenCalledOnce()
    expect(first).toBe(second)
  })

  it('coalesces concurrent version probes and namespace loads', async () => {
    const fetchStub = stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0' }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
    })
    const client = new I3XClient('http://server')

    await Promise.all([client.testConnection(), client.testConnection()])

    expect(fetchStub.mock.calls.filter(([url]) => new URL(url).pathname === '/info')).toHaveLength(1)
    expect(fetchStub.mock.calls.filter(([url]) => new URL(url).pathname === '/namespaces')).toHaveLength(1)
  })

  it('does not coalesce requests with different query options', async () => {
    const fetchStub = stubFetch({ 'GET /namespaces': jsonResponse([]) })
    const client = new I3XClient('http://server')

    await Promise.all([client.getNamespaces(true), client.getNamespaces(false)])

    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('does not coalesce stateful subscription sync requests', async () => {
    const fetchStub = stubFetch({ 'POST /subscriptions/sync': jsonResponse([]) })
    const client = new I3XClient('http://server')

    await Promise.all([client.sync('sub1'), client.sync('sub1')])

    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('canonicalizes JSON body keys when matching read requests', async () => {
    const fetchStub = stubFetch({
      'POST /objects/related': { ...jsonResponse([]), headers: new Headers() },
    })
    const client = new I3XClient('http://server')
    const common = { operation: 'related', title: 'Related objects', method: 'POST' as const, path: '/objects/related' }

    await Promise.all([
      client.executeDescriptor({ ...common, body: { elementIds: ['one'], relationshipType: 'HasComponent' } }),
      client.executeDescriptor({ ...common, body: { relationshipType: 'HasComponent', elementIds: ['one'] } }),
    ])

    expect(fetchStub).toHaveBeenCalledOnce()
  })

  it('returns the raw catalog body for the catalog engine, one fetch for concurrent callers', async () => {
    const fetchStub = stubFetch({
      'GET /objects': jsonResponse([
        { elementId: 'one', displayName: 'One', typeId: 'T', parentId: null, namespaceUri: 'urn:x' },
      ]),
    })
    const client = new I3XClient('http://server')

    const [first, second] = await Promise.all([client.getObjectCatalogBytes(), client.getObjectCatalogBytes()])

    expect(fetchStub).toHaveBeenCalledOnce()
    if (first.notModified || second.notModified) throw new Error('expected a body')
    expect(first.buffer).toBe(second.buffer)
    expect(JSON.parse(new TextDecoder().decode(first.buffer))).toMatchObject([{ elementId: 'one' }])
  })

  it('revalidates the catalog with If-None-Match and reports a 304 as not modified', async () => {
    const fetchStub = stubFetch({
      'GET /objects': { ok: false, status: 304, headers: new Headers({ ETag: '"c1"' }) },
    })
    const client = new I3XClient('http://server')

    const [conditional] = await Promise.all([
      client.getObjectCatalogBytes('"c1"'),
      client.getObjectCatalogBytes(),
    ])

    // A conditional request must never share an unconditional caller's fetch, or vice versa.
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect((fetchStub.mock.calls[0][1]?.headers as Record<string, string>)['If-None-Match']).toBe('"c1"')
    expect(conditional).toEqual({ notModified: true })
  })

  it('returns the catalog ETag with the body', async () => {
    stubFetch({ 'GET /objects': { ...jsonResponse([]), headers: new Headers({ ETag: '"c1"' }) } })
    const client = new I3XClient('http://server')

    const body = await client.getObjectCatalogBytes()

    expect(body).toMatchObject({ notModified: false, etag: '"c1"' })
  })

  it('shares one catalog response between concurrent full-list callers', async () => {
    const fetchStub = stubFetch({
      'GET /objects': jsonResponse({
        success: true,
        result: [
          { elementId: 'root', displayName: 'Root', typeElementId: 'T', parentId: null, namespaceUri: 'urn:x' },
          { elementId: 'child', displayName: 'Child', typeElementId: 'T', parentId: 'root', namespaceUri: 'urn:x' },
        ],
      }),
    })
    const client = new I3XClient('http://server')

    const [first, second] = await Promise.all([client.getObjects(), client.getObjects()])

    expect(fetchStub).toHaveBeenCalledOnce()
    expect(first.map(object => object.elementId)).toEqual(['root', 'child'])
    expect(second).toBe(first)
  })
})

describe('I3XClient.testConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('connects to a 1.0 server and keeps its capabilities matrix', async () => {
    stubFetch({
      'GET /info': jsonResponse({ success: true, result: { specVersion: '1.0', capabilities: { subscribe: { stream: false } } } }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
    })
    const client = new I3XClient('http://server')

    await expect(client.testConnection()).resolves.toBe(true)
    expect(client.getCapabilities()).toEqual({ subscribe: { stream: false } })
  })

  it('rejects a server that is not an i3X 1.0 release, naming what /info said', async () => {
    const fetchStub = stubFetch({
      'GET /info': jsonResponse({ specVersion: '0.9' }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
    })
    const client = new I3XClient('http://server')

    const error = await client.testConnection().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(UnsupportedServerError)
    expect((error as UnsupportedServerError).message).toBe(
      'This server does not implement i3X 1.0 (found: spec version 0.9). i3X Explorer 1.1 supports 1.0 servers only.'
    )
    // It stops at /info; nothing else is requested from an unsupported server.
    expect(fetchStub).toHaveBeenCalledOnce()
  })

  it('rejects a server with no /info endpoint as unsupported, naming the status', async () => {
    stubFetch({ 'GET /info': jsonResponse({}, 404) })
    const client = new I3XClient('http://server')

    const error = await client.testConnection().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(UnsupportedServerError)
    expect((error as UnsupportedServerError).found).toBe('GET /info answered HTTP 404')
  })

  it.each([401, 403])('reports a %i from /info as an authentication problem, not an unsupported server', async (status) => {
    const fetchStub = stubFetch({ 'GET /info': jsonResponse({}, status) })
    const client = new I3XClient('http://server')

    const error = await client.testConnection().catch((err: unknown) => err)
    expect(error).toBeInstanceOf(AuthRequiredError)
    expect(error).not.toBeInstanceOf(UnsupportedServerError)
    expect((error as AuthRequiredError).status).toBe(status)
    expect((error as AuthRequiredError).message).toMatch(/Authentication settings/)
    expect(fetchStub).toHaveBeenCalledOnce()
  })

  it('reports an unreachable server as a failed connection, not an unsupported one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const client = new I3XClient('http://server')

    await expect(client.testConnection()).resolves.toBe(false)
  })
})

describe('I3XClient.getRelatedObjectsByType', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const page = (results: unknown[], link?: string): StubResponse & { headers: Headers } => ({
    ...jsonResponse({ success: true, results }),
    headers: new Headers(link ? { Link: link } : {}),
  })
  const entry = (elementId: string, targets: string[]) => ({
    elementId,
    success: true,
    result: targets.map(t => ({
      sourceRelationship: 'Feeds',
      object: { elementId: t, displayName: t, typeElementId: 'T', parentId: null, isComposition: false },
    })),
  })

  it('follows the Link next cursor and merges a source split across pages', async () => {
    const fetchStub = vi.fn(async (url: string, _options?: RequestInit) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/info') return jsonResponse({ specVersion: '1.0' }) as unknown as Response
      if (parsed.pathname === '/namespaces') return jsonResponse({ success: true, result: [] }) as unknown as Response
      const cursor = parsed.searchParams.get('cursor')
      if (!cursor) {
        return page([entry('A', ['x'])], '</v1/objects/related-by-type?limit=1000&cursor=c2>; rel="next"') as unknown as Response
      }
      return page([
        entry('A', ['y']),
        entry('B', ['z']),
        { elementId: 'C', success: false, result: null, responseDetail: { title: 'Error', status: 500, detail: 'C unavailable' } },
      ]) as unknown as Response
    })
    vi.stubGlobal('fetch', fetchStub)
    const client = new I3XClient('http://server')
    await client.testConnection()

    const { entries: result, failures } = await client.getRelatedObjectsByType('Feeds')
    expect(result.map(e => [e.sourceId, e.related.map(o => o.elementId)])).toEqual([
      ['A', ['x', 'y']],
      ['B', ['z']],
    ])
    expect(failures).toEqual([{ elementId: 'C', message: 'HTTP 500: C unavailable' }])
    expect(result[0].related[0].sourceRelationship).toBe('Feeds')
    const relatedCalls = fetchStub.mock.calls.filter(([url]) => url.includes('related-by-type'))
    expect(relatedCalls).toHaveLength(2)
    expect(JSON.parse((relatedCalls[0][1] as RequestInit).body as string)).toEqual({
      relationshipTypes: ['Feeds'],
      includeMetadata: true,
    })
  })

  it('throws the envelope reason when a failed page carries no results', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url).pathname
      if (path === '/info') return jsonResponse({ specVersion: '1.0' }) as unknown as Response
      if (path === '/namespaces') return jsonResponse({ success: true, result: [] }) as unknown as Response
      return jsonResponse({
        success: false,
        results: [],
        responseDetail: { title: 'Error', status: 503, detail: 'busy' },
      }) as unknown as Response
    }))
    const client = new I3XClient('http://server')
    await client.testConnection()

    await expect(client.getRelatedObjectsByType('Feeds')).rejects.toThrow('HTTP 503: busy')
  })
})

describe('I3XClient.getObjectDetails', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports failed and unanswered elements alongside the resolved objects', async () => {
    stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      'POST /objects/list': jsonResponse({
        success: true,
        results: [
          { elementId: 'ok', success: true, result: { elementId: 'ok', displayName: 'OK', typeElementId: 'T', metadata: { owner: 'x' } } },
          { elementId: 'bad', success: false, responseDetail: { status: 500, title: 'Server error', detail: 'backend unavailable' } },
        ],
      }),
    })
    const client = new I3XClient('http://server')
    await client.testConnection()

    const { objects, failures } = await client.getObjectDetails(['ok', 'bad', 'gone'])

    expect(objects.map(object => [object.elementId, object.metadata])).toEqual([['ok', { owner: 'x' }]])
    expect(failures).toEqual([
      { elementId: 'bad', message: 'HTTP 500: backend unavailable' },
      { elementId: 'gone', message: 'Not returned by the server' },
    ])
    await expect(client.getObjectsByIds(['ok', 'bad'])).resolves.toHaveLength(1)
  })
})

describe('I3XClient.getValue', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws the responseDetail of a failed per-element result instead of reporting no value', async () => {
    stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      'POST /objects/value': jsonResponse({
        success: false,
        results: [
          { elementId: 'mp', success: false, result: null, responseDetail: { title: 'Error', status: 500, detail: 'fetch failed with status 404' } },
        ],
      }),
    })
    const client = new I3XClient('http://server')
    await client.testConnection()

    await expect(client.getValue('mp')).rejects.toThrow('HTTP 500: fetch failed with status 404')
  })

  it('reports failed elements of a related batch instead of treating them as empty', async () => {
    stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      'POST /objects/related': jsonResponse({
        success: false,
        results: [
          { elementId: 'ok', success: true, result: [] },
          { elementId: 'bad', success: false, result: null, responseDetail: { title: 'Error', status: 502, detail: 'upstream down' } },
        ],
      }),
    })
    const client = new I3XClient('http://server')
    await client.testConnection()

    const { related, failures } = await client.getRelatedObjectsBatch(['ok', 'bad'])
    expect([...related.keys()]).toEqual(['ok'])
    expect(failures).toEqual([{ elementId: 'bad', message: 'HTTP 502: upstream down' }])
  })

  it('fails every requested id with the envelope reason when the results array is empty', async () => {
    stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      'POST /objects/related': jsonResponse({
        success: false,
        results: [],
        responseDetail: { title: 'Service Unavailable', status: 503, detail: 'backend busy' },
      }),
      'POST /objects/list': jsonResponse({
        success: false,
        results: [],
        responseDetail: { title: 'Service Unavailable', status: 503, detail: 'backend busy' },
      }),
    })
    const client = new I3XClient('http://server')
    await client.testConnection()

    const expected = [
      { elementId: 'a', message: 'HTTP 503: backend busy' },
      { elementId: 'b', message: 'HTTP 503: backend busy' },
    ]
    expect((await client.getRelatedObjectsBatch(['a', 'b'])).failures).toEqual(expected)
    expect((await client.getObjectDetails(['a', 'b'])).failures).toEqual(expected)
  })

  it('attributes a lone unlabeled result to the lone requested id', async () => {
    stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      'POST /objects/related': jsonResponse({ success: true, results: [{ elementId: null, success: true, result: [] }] }),
    })
    const client = new I3XClient('http://server')
    await client.testConnection()

    const { related, failures } = await client.getRelatedObjectsBatch(['root'])
    expect([...related.keys()]).toEqual(['root'])
    expect(failures).toEqual([])
  })

  it('fails requested ids the server never answered, with an unattributed failure reason when there is one', async () => {
    stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      'POST /objects/related': jsonResponse({
        success: false,
        results: [
          { elementId: 'ok', success: true, result: [] },
          { elementId: null, success: false, result: null, responseDetail: { title: 'Error', status: 500, detail: 'lost one' } },
        ],
      }),
    })
    const client = new I3XClient('http://server')
    await client.testConnection()

    const { failures } = await client.getRelatedObjectsBatch(['ok', 'a', 'b'])
    expect(failures).toEqual([
      { elementId: 'a', message: 'HTTP 500: lost one' },
      { elementId: 'b', message: 'HTTP 500: lost one' },
    ])
  })

  it('types a 2xx failure envelope by its responseDetail status so subscription expiry is recognised', async () => {
    stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      'POST /subscriptions/sync': jsonResponse({
        success: false,
        result: null,
        responseDetail: { title: 'Not Found', status: 404, detail: 'no such subscription' },
      }),
    })
    const client = new I3XClient('http://server')
    await client.testConnection()

    const error = await client.sync('s').catch((err: unknown) => err)
    expect(error).toBeInstanceOf(HttpStatusError)
    expect((error as HttpStatusError).status).toBe(404)
    expect(isSubscriptionGoneError(error as Error)).toBe(true)
  })
})

describe('I3XClient register/unregister outcomes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function connectedClient(routes: Record<string, StubResponse>) {
    const fetchStub = stubFetch({
      'GET /info': jsonResponse({ specVersion: '1.0', capabilities: {} }),
      'GET /namespaces': jsonResponse({ success: true, result: [] }),
      ...routes,
    })
    const client = new I3XClient('https://server')
    await client.testConnection()
    return { client, fetchStub }
  }

  const refused = jsonResponse({
    success: false,
    result: null,
    responseDetail: { title: 'Rejected', detail: 'operation refused' },
  })

  it('reports a failure envelope with a null result as a rejection, not an empty success', async () => {
    const { client } = await connectedClient({
      'POST /subscriptions/register': refused,
      'POST /subscriptions/unregister': refused,
    })

    const rejected = { accepted: [], rejected: [{ elementId: 'a', message: 'operation refused' }] }
    await expect(client.registerMonitoredItems('s', ['a'], 0)).resolves.toEqual(rejected)
    await expect(client.unregisterMonitoredItems('s', ['a'], 0)).resolves.toEqual(rejected)
  })

  it('splits mixed per-item results and sends the registration depth on unregister', async () => {
    const { client, fetchStub } = await connectedClient({
      'POST /subscriptions/unregister': jsonResponse({
        success: true,
        results: [
          { success: true, elementId: 'a' },
          { success: false, elementId: 'b', responseDetail: { status: 404, detail: 'b not found' } },
        ],
      }),
    })

    await expect(client.unregisterMonitoredItems('s', ['a', 'b'], 0)).resolves.toEqual({
      accepted: ['a'],
      rejected: [{ elementId: 'b', message: 'b not found' }],
    })
    const call = fetchStub.mock.calls.find(([url]) => url.endsWith('/subscriptions/unregister'))!
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ elementIds: ['a', 'b'], maxDepth: 0 })
  })

  it('accepts everything on 204 No Content', async () => {
    const { client } = await connectedClient({ 'POST /subscriptions/register': emptyBody(204) })
    await expect(client.registerMonitoredItems('s', ['a', 'b'])).resolves.toEqual({ accepted: ['a', 'b'], rejected: [] })
  })
})
