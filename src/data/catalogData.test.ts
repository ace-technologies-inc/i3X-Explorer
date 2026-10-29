import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, destroyClient } from '../api/client'
import { normalizeV1Object } from '../api/normalize'
import { metadataKey } from '../components/diff/diffEngine'
import { createSnapshot, decodeSnapshotBytes, parseSnapshot } from '../components/diff/snapshot'
import { ensureAllObjectsLoaded, refreshAllObjects } from '../services/catalog'
import { useDiffStore } from '../stores/diff'
import { useExplorerStore } from '../stores/explorer'
import { CatalogEngine } from './catalogEngine'
import { createCatalogEngineApi } from './catalogEngineApi'
import {
  catalogMetadataKeyer,
  catalogObjectsJson,
  catalogSnapshotBlob,
  catalogSubtreeJson,
  catalogValueJson,
  getCatalogEngine,
  ObjectDetailsError,
  resetCatalogEngine,
} from './catalogData'
import { installCatalogColumns } from './catalogInstaller'
import * as catalogInstaller from './catalogInstaller'
import { queryClient } from './queryClient'
import type { ObjectType } from '../api/types'

const source = { baseUrl: 'http://server', cacheEnabled: false }
// The catalog body lists objects without metadata; the server answers /objects/list with it.
const objects = [
  { elementId: 'a', displayName: 'A', typeElementId: 'T' },
  { elementId: 'b', displayName: 'B', typeElementId: 'T', parentId: 'a' },
]
const fullObjects = objects.map(object => normalizeV1Object({
  ...object,
  metadata: { typeNamespaceUri: 'urn:x', owner: object.elementId === 'a' ? 'alpha' : 'beta' },
}))

async function install(entries: unknown[] = objects) {
  const engine = await getCatalogEngine()
  const state = useExplorerStore.getState()
  const buffer = new TextEncoder().encode(JSON.stringify({ success: true, result: entries })).buffer
  const result = await engine.ingest(buffer, source, state.allObjectsFingerprint, { T: 'urn:x' })
  if (result.columns) state.setAllObjectsCatalog(await installCatalogColumns(result.columns, state.objectIndex))
  useExplorerStore.setState({ catalogDetailsFingerprint: result.fingerprint })
  return engine
}

function serverWithDetails() {
  const client = createClient(source.baseUrl)
  const fetchDetails = vi.spyOn(client, 'getObjectDetails').mockImplementation(async ids => ({
    objects: fullObjects.filter(object => ids.includes(object.elementId)),
    failures: [],
  }))
  return { client, fetchDetails }
}

function failDetailsOf(fetchDetails: ReturnType<typeof serverWithDetails>['fetchDetails'], elementId: string) {
  fetchDetails.mockImplementation(async ids => ({
    objects: fullObjects.filter(object => ids.includes(object.elementId) && object.elementId !== elementId),
    failures: [{ elementId, message: 'backend unavailable' }],
  }))
}

beforeEach(() => {
  vi.stubGlobal('Worker', undefined)
  resetCatalogEngine()
  useExplorerStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetCatalogEngine()
  useExplorerStore.getState().reset()
  vi.unstubAllGlobals()
  destroyClient()
  useDiffStore.setState({ baseline: null, baselineIndex: new Map(), diff: null, busy: null, error: null, deepCompare: false })
})

describe('full catalog exports', () => {
  it('fetches the objects\' metadata from the server for copy JSON', async () => {
    await install()
    const { fetchDetails } = serverWithDetails()
    const { allObjects } = useExplorerStore.getState()

    expect(JSON.parse(await catalogObjectsJson(allObjects)).map((object: { metadata: unknown }) => object.metadata))
      .toEqual(fullObjects.map(object => object.metadata))
    expect(JSON.parse(await catalogSubtreeJson([allObjects[0]]))[0].children[0].metadata).toEqual(fullObjects[1].metadata)
    expect(fetchDetails).toHaveBeenLastCalledWith(['a', 'b'])
  })

  it('keeps the relationship and children of a copied branch', async () => {
    await install()
    serverWithDetails()
    const related = normalizeV1Object({ elementId: 'a', displayName: 'A', typeElementId: 'T', sourceRelationship: 'HasChildren' })
    const relatedChild = normalizeV1Object({ elementId: 'b', displayName: 'B', typeElementId: 'T', sourceRelationship: 'HasComponent' })

    const branch = JSON.parse(await catalogValueJson({ ...related, children: [relatedChild] }))

    expect(branch).toMatchObject({
      metadata: fullObjects[0].metadata,
      namespaceUri: 'urn:x',
      sourceRelationship: 'HasChildren',
      children: [{ metadata: fullObjects[1].metadata, sourceRelationship: 'HasComponent' }],
    })
  })

  it('copies objects the store holds in full without a request', async () => {
    const { fetchDetails } = serverWithDetails()
    useExplorerStore.getState().setAllObjects(fullObjects)

    expect(JSON.parse(await catalogValueJson(fullObjects[0])).metadata).toEqual(fullObjects[0].metadata)
    expect(JSON.parse(await catalogSubtreeJson([fullObjects[0]]))[0].children[0].metadata).toEqual(fullObjects[1].metadata)
    expect(fetchDetails).not.toHaveBeenCalled()
  })

  it('saves snapshots with the objects\' metadata', async () => {
    await install()
    serverWithDetails()

    const blob = await catalogSnapshotBlob({
      appVersion: 'test', serverUrl: source.baseUrl, capturedAt: '2026-01-01T00:00:00Z',
      namespaces: [], objectTypes: [],
    })

    const { snapshot } = parseSnapshot(await decodeSnapshotBytes(await blob.arrayBuffer()))
    expect(snapshot.objects.map(object => object.metadata)).toEqual(fullObjects.map(object => object.metadata))
  })

  it('refuses copies and snapshots when the server cannot supply an object\'s details', async () => {
    await install()
    const { fetchDetails } = serverWithDetails()
    failDetailsOf(fetchDetails, 'b')
    const { allObjects } = useExplorerStore.getState()

    await expect(catalogObjectsJson(allObjects)).rejects.toThrow(ObjectDetailsError)
    await expect(catalogValueJson(allObjects[1])).rejects.toThrow('b (backend unavailable)')
    await expect(catalogSnapshotBlob({
      appVersion: 'test', serverUrl: source.baseUrl, capturedAt: '2026-01-01T00:00:00Z',
      namespaces: [], objectTypes: [],
    })).rejects.toThrow(ObjectDetailsError)
  })
})

describe('metadata compare against the live catalog', () => {
  it('keys the live objects by their fetched metadata', async () => {
    await install()
    serverWithDetails()
    const state = useExplorerStore.getState()

    const keyer = (await catalogMetadataKeyer())!

    expect(keyer(state.objectIndex.get('a')!)).toBe(metadataKey(fullObjects[0]))
  })

  it('reports a refresh during the metadata fetch and permits a successful retry', async () => {
    await install()
    const { fetchDetails } = serverWithDetails()
    const baseline = createSnapshot({
      appVersion: 'test', serverUrl: source.baseUrl, capturedAt: '2026-01-01T00:00:00Z',
      namespaces: [], objectTypes: [], objects: fullObjects,
    })
    useDiffStore.setState({ baseline, baselineIndex: new Map(fullObjects.map(object => [object.elementId, object])), deepCompare: true })
    let resolveDetails!: (value: { objects: typeof fullObjects; failures: [] }) => void
    fetchDetails.mockImplementationOnce(() => new Promise(resolve => { resolveDetails = resolve }))
    useDiffStore.getState().runDiff()
    await vi.waitFor(() => expect(fetchDetails).toHaveBeenCalled())

    await install([...objects].reverse())
    resolveDetails({ objects: fullObjects, failures: [] })
    await vi.waitFor(() => expect(useDiffStore.getState().busy).toBeNull())
    expect(useDiffStore.getState().error).toContain('refreshed while its metadata was loading')
    expect(useDiffStore.getState().diff).toBeNull()

    useDiffStore.getState().runDiff()
    await vi.waitFor(() => expect(useDiffStore.getState().busy).toBeNull())
    expect(useDiffStore.getState().error).toBeNull()
    expect(useDiffStore.getState().diff?.metadataOnly).toEqual([])
    expect(useDiffStore.getState().diff?.identical).toBe(true)
  })

  it('reports objects whose metadata could not be read instead of diffing their skeletons', async () => {
    await install()
    const { fetchDetails } = serverWithDetails()
    failDetailsOf(fetchDetails, 'b')
    const baseline = createSnapshot({
      appVersion: 'test', serverUrl: source.baseUrl, capturedAt: '2026-01-01T00:00:00Z',
      namespaces: [], objectTypes: [], objects: fullObjects,
    })
    useDiffStore.setState({ baseline, baselineIndex: new Map(fullObjects.map(object => [object.elementId, object])), deepCompare: true })

    useDiffStore.getState().runDiff()
    await vi.waitFor(() => expect(useDiffStore.getState().busy).toBeNull())

    expect(useDiffStore.getState().error).toContain('b (backend unavailable)')
    expect(useDiffStore.getState().diff).toBeNull()
  })
})

class CatalogWorker extends EventTarget {
  static instances: CatalogWorker[] = []
  api = createCatalogEngineApi(new CatalogEngine(null))
  blocked = new Set<string>()
  requests: string[] = []
  terminated = false

  constructor() {
    super()
    CatalogWorker.instances.push(this)
  }

  postMessage(message: { id: string; path: string[]; argumentList: { value: unknown }[] }) {
    const method = message.path[0]
    this.requests.push(method)
    if (this.blocked.has(method)) return
    const operation = Reflect.get(this.api, method)
    Promise.resolve(Reflect.apply(operation, this.api, message.argumentList.map(argument => argument.value)))
      .then(value => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, type: 'RAW', value } })))
  }

  terminate() {
    this.terminated = true
  }
}

describe('catalog worker recovery', () => {
  function workers() {
    CatalogWorker.instances = []
    vi.stubGlobal('Worker', CatalogWorker)
  }

  function clientWithCatalog() {
    const client = createClient(source.baseUrl)
    vi.spyOn(client, 'getObjectTypes').mockResolvedValue([])
    const fetch = vi.spyOn(client, 'getObjectCatalogBytes').mockImplementation(async etag => etag
      ? { notModified: true }
      : { notModified: false, etag: 'catalog-etag', buffer: new TextEncoder().encode(JSON.stringify({ success: true, result: objects })).buffer })
    useExplorerStore.setState({ catalogCacheEnabled: false })
    return { client, fetch }
  }

  async function engineHoldsCatalogOnScreen(): Promise<boolean> {
    const fingerprint = useExplorerStore.getState().allObjectsFingerprint!
    return (await (await getCatalogEngine()).insights([], 1, fingerprint)) !== null
  }

  it('applies changed type namespaces to an unchanged (304) catalog and revalidates open details', async () => {
    const { client, fetch } = clientWithCatalog()
    const typeIn = (namespaceUri: string) => [{ elementId: 'T', displayName: 'T', namespaceUri, schema: {} } as unknown as ObjectType]
    const types = vi.spyOn(client, 'getObjectTypes').mockResolvedValue(typeIn('urn:one'))
    await ensureAllObjectsLoaded(client)
    expect(useExplorerStore.getState().objectIndex.get('a')?.namespaceUri).toBe('urn:one')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    types.mockResolvedValue(typeIn('urn:two'))
    await refreshAllObjects(client, true)

    expect(fetch).toHaveBeenLastCalledWith('catalog-etag')
    const state = useExplorerStore.getState()
    expect(state.objectIndex.get('a')?.namespaceUri).toBe('urn:two')
    expect(state.searchIndex.get('a')).toContain('urn:two')
    expect(state.catalogDetailsFingerprint).toBe(state.allObjectsFingerprint)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['objectDetails', source.baseUrl] })

    await refreshAllObjects(client, true)
    expect(fetch).toHaveBeenLastCalledWith('catalog-etag')
    expect(useExplorerStore.getState().allObjects).toBe(state.allObjects)
  })

  it('falls back to an in-process engine when the worker fails during startup', async () => {
    class FailedWorker extends CatalogWorker {
      constructor() {
        super()
        this.blocked.add('ping')
        queueMicrotask(() => this.dispatchEvent(new Event('error')))
      }
    }
    CatalogWorker.instances = []
    vi.stubGlobal('Worker', FailedWorker)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const engine = await getCatalogEngine()

    expect(await engine.ping()).toBe(true)
    expect(CatalogWorker.instances[0].terminated).toBe(true)
    await install()
    expect(await engineHoldsCatalogOnScreen()).toBe(true)
  })

  it.each(['error', 'messageerror'])('rejects outstanding RPCs after %s and starts another engine', async event => {
    workers()
    const engine = await getCatalogEngine()
    const worker = CatalogWorker.instances[0]
    worker.blocked.add('insights')
    const request = engine.insights([], 1, 'fingerprint')
    const rejected = expect(request).rejects.toThrow('catalog worker stopped')
    await vi.waitFor(() => expect(worker.requests).toContain('insights'))

    worker.dispatchEvent(new Event(event))

    await rejected
    expect(worker.terminated).toBe(true)
    await expect(engine.insights([], 1, 'fingerprint')).rejects.toThrow('catalog worker stopped')
    expect(await getCatalogEngine()).not.toBe(engine)
    expect(CatalogWorker.instances).toHaveLength(2)
  })

  it('releases a crashed ingest load so an unforced retry can finish', async () => {
    workers()
    await getCatalogEngine()
    const worker = CatalogWorker.instances[0]
    worker.blocked.add('ingest')
    const { client } = clientWithCatalog()
    const load = ensureAllObjectsLoaded(client, { force: true })
    expect(ensureAllObjectsLoaded(client, { force: true })).toBe(load)
    const rejected = expect(load).rejects.toThrow('catalog worker stopped')
    await vi.waitFor(() => expect(worker.requests).toContain('ingest'))

    worker.dispatchEvent(new Event('error'))
    await rejected
    const retry = ensureAllObjectsLoaded(client)
    expect(retry).not.toBe(load)
    await retry

    expect(useExplorerStore.getState().catalogDetailsFingerprint).toBe(useExplorerStore.getState().allObjectsFingerprint)
    expect(await engineHoldsCatalogOnScreen()).toBe(true)
  })

  it('drops conditional validation after a crash and rehydrates the unchanged catalog', async () => {
    workers()
    const { client, fetch } = clientWithCatalog()
    await ensureAllObjectsLoaded(client)
    const state = useExplorerStore.getState()
    await refreshAllObjects(client, true)
    expect(fetch).toHaveBeenLastCalledWith('catalog-etag')

    CatalogWorker.instances[0].dispatchEvent(new Event('error'))
    expect(useExplorerStore.getState().catalogDetailsFingerprint).toBeNull()
    expect(useExplorerStore.getState().allObjects).toBe(state.allObjects)
    await refreshAllObjects(client)

    expect(fetch).toHaveBeenLastCalledWith()
    expect(useExplorerStore.getState().catalogDetailsFingerprint).toBe(state.allObjectsFingerprint)
    expect(await engineHoldsCatalogOnScreen()).toBe(true)
  })

  it('does not publish a conditional response from a terminated engine', async () => {
    workers()
    const { client, fetch } = clientWithCatalog()
    await ensureAllObjectsLoaded(client)
    let resolveBody!: (value: { notModified: true }) => void
    fetch.mockImplementationOnce(() => new Promise(resolve => { resolveBody = resolve }))
    const load = refreshAllObjects(client, true)
    const rejected = expect(load).rejects.toThrow('catalog worker stopped')

    CatalogWorker.instances[0].dispatchEvent(new Event('error'))
    resolveBody({ notModified: true })
    await rejected

    expect(useExplorerStore.getState().catalogDetailsFingerprint).toBeNull()
    await ensureAllObjectsLoaded(client)
    expect(fetch).toHaveBeenLastCalledWith()
  })

  it('does not publish columns if the worker dies during the sliced install', async () => {
    workers()
    const { client } = clientWithCatalog()
    const installColumns = catalogInstaller.installCatalogColumns
    vi.spyOn(catalogInstaller, 'installCatalogColumns').mockImplementationOnce(async (...args) => {
      const catalog = await installColumns(...args)
      CatalogWorker.instances[0].dispatchEvent(new Event('error'))
      return catalog
    })

    await expect(ensureAllObjectsLoaded(client)).rejects.toThrow('catalog worker stopped')

    expect(useExplorerStore.getState().allObjects).toEqual([])
    expect(useExplorerStore.getState().catalogDetailsFingerprint).toBeNull()
    await ensureAllObjectsLoaded(client)
    expect(useExplorerStore.getState().allObjects).toHaveLength(2)
  })
})