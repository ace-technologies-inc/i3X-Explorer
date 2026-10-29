import { getClient, type CatalogBody, type I3XClient } from '../api/client'
import type { ObjectInstance } from '../api/types'
import { getCatalogEngine, isCurrentCatalogEngine, transferBuffer } from '../data/catalogData'
import type { CatalogEngineApi } from '../data/catalogEngineApi'
import type { CatalogIngestResult, CatalogSource, TypeNamespaces } from '../data/catalogEngine'
import { installCatalogColumns } from '../data/catalogInstaller'
import { queryClient, serverScope } from '../data/queryClient'
import { useExplorerStore } from '../stores/explorer'

const ALL_OBJECTS_REFETCH_TTL_MS = 3000
const allObjectsFetchedAt = new WeakMap<I3XClient, number>()
/** The ETag of the last catalog body each client ingested, and the fingerprint of that body. */
const catalogValidators = new WeakMap<I3XClient, { etag: string; fingerprint: string }>()
/** Clients whose network refused `If-None-Match` (a CORS preflight that doesn't allow it). */
const conditionalRefused = new WeakSet<I3XClient>()
let allObjectsInFlight: { client: I3XClient; promise: Promise<void> } | null = null
const rootsInFlight = new WeakMap<I3XClient, Promise<ObjectInstance[]>>()

/**
 * The single owner of full-catalog loads: one in-flight load per client, shared
 * by connect, search, folder expansion, and the background poll.
 */
export function ensureAllObjectsLoaded(
  client: I3XClient,
  options: { force?: boolean; invalidateCurrent?: boolean } = {}
): Promise<void> {
  if (allObjectsInFlight?.client === client) return allObjectsInFlight.promise

  if (!options.force && catalogReady()) return Promise.resolve()
  if (options.invalidateCurrent) useExplorerStore.setState({ allObjectsLoaded: false })

  const promise = loadCatalog(client).finally(() => {
    if (allObjectsInFlight?.promise === promise) allObjectsInFlight = null
  })
  allObjectsInFlight = { client, promise }
  return promise
}

export function refreshAllObjects(client: I3XClient, force = false): Promise<void> {
  if (allObjectsInFlight?.client === client) return allObjectsInFlight.promise
  const fetchedAt = allObjectsFetchedAt.get(client) ?? 0
  if (!force && catalogReady() && Date.now() - fetchedAt < ALL_OBJECTS_REFETCH_TTL_MS) {
    return Promise.resolve()
  }
  return ensureAllObjectsLoaded(client, { force: true })
}

function catalogReady(): boolean {
  const state = useExplorerStore.getState()
  return state.allObjectsLoaded && (state.allObjectsFingerprint === null || state.allObjectsFingerprint === state.catalogDetailsFingerprint)
}

function requireCurrentEngine(engine: CatalogEngineApi): void {
  if (!isCurrentCatalogEngine(engine)) throw new Error('The catalog worker stopped. Refresh the catalog to try again.')
}

/**
 * The catalog is listed without metadata, so objects take their namespace from
 * their type. Shares the in-flight types request of a connect or a poll.
 */
async function typeNamespaces(client: I3XClient): Promise<TypeNamespaces> {
  const types = await client.getObjectTypes()
  return Object.fromEntries(types.map(type => [type.elementId, type.namespaceUri]))
}

/** Starts both requests together; awaited later, so neither rejection is reported as unhandled meanwhile. */
function inParallel<T>(request: Promise<T>): Promise<T> {
  request.catch(() => {})
  return request
}

/**
 * Loads the server's hierarchy roots into the store, one load per client at a
 * time. The body is parsed in the catalog engine and installed as skeletons
 * that reuse the catalog's (or the previous roots') instances, so an unchanged
 * refresh leaves the store untouched.
 */
export function loadHierarchicalRoots(client: I3XClient): Promise<ObjectInstance[]> {
  const pending = rootsInFlight.get(client)
  if (pending) return pending
  const promise = fetchHierarchicalRoots(client).finally(() => rootsInFlight.delete(client))
  rootsInFlight.set(client, promise)
  return promise
}

async function fetchHierarchicalRoots(client: I3XClient): Promise<ObjectInstance[]> {
  const body = inParallel(client.getRootObjectBytes())
  const namespaces = inParallel(typeNamespaces(client))
  const engine = await getCatalogEngine()
  const buffer = await body
  const columns = buffer
    ? await engine.roots(transferBuffer(buffer), await namespaces)
    : null
  if (getClient() !== client) return []
  requireCurrentEngine(engine)
  const { objectIndex, hierarchicalRoots } = useExplorerStore.getState()
  const previous = new Map(hierarchicalRoots.map(root => [root.elementId, root]))
  const roots = columns
    ? (await installCatalogColumns(columns, { get: id => objectIndex.get(id) ?? previous.get(id) })).objects
    : []
  requireCurrentEngine(engine)
  if (getClient() === client) useExplorerStore.getState().setHierarchicalRoots(roots)
  return roots
}

/** Resolves once a catalog is on screen (from the cache or the server), or when `load` settles. */
export function catalogAvailable(load: Promise<void>): Promise<void> {
  return new Promise(resolve => {
    if (useExplorerStore.getState().allObjectsLoaded) {
      resolve()
      return
    }
    const unsubscribe = useExplorerStore.subscribe(state => {
      if (!state.allObjectsLoaded) return
      unsubscribe()
      resolve()
    })
    const settle = () => {
      unsubscribe()
      resolve()
    }
    load.then(settle, settle)
  })
}

async function loadCatalog(client: I3XClient): Promise<void> {
  const store = useExplorerStore.getState
  const source: CatalogSource = {
    baseUrl: client.getBaseUrl(),
    cacheEnabled: store().catalogCacheEnabled,
  }
  const body = inParallel(fetchCatalogBody(client))
  const engine = await getCatalogEngine()

  if (!store().allObjectsLoaded) await installFromCache(engine, client, source)

  let response = await body
  if (getClient() !== client) return
  requireCurrentEngine(engine)
  const namespaces = await typeNamespaces(client)
  if (getClient() !== client) return
  requireCurrentEngine(engine)

  let result: CatalogIngestResult | null = null
  let etag: string | null = null
  if (response.notModified) {
    // Unchanged body, but the type namespaces its objects take may have changed.
    result = await engine.revalidated(source, store().allObjectsFingerprint, namespaces)
    etag = catalogValidators.get(client)?.etag ?? null
    if (!result) {
      catalogValidators.delete(client)
      response = await client.getObjectCatalogBytes()
      if (getClient() !== client) return
      requireCurrentEngine(engine)
    }
  }
  if (!result) {
    if (response.notModified || !response.buffer) throw new Error('The server returned an empty object list')
    result = await engine.ingest(transferBuffer(response.buffer), source, store().allObjectsFingerprint, namespaces)
    etag = response.etag
  }
  if (getClient() !== client) return
  requireCurrentEngine(engine)
  if (etag) catalogValidators.set(client, { etag, fingerprint: result.fingerprint })
  else catalogValidators.delete(client)

  if (result.columns) {
    const catalog = await installCatalogColumns(result.columns, store().objectIndex)
    if (getClient() !== client) return
    requireCurrentEngine(engine)
    store().setAllObjectsCatalog(catalog)
  } else {
    useExplorerStore.setState({ allObjectsLoaded: true })
  }
  useExplorerStore.setState({
    catalogDetailsFingerprint: result.fingerprint,
    catalogOrigin: { kind: 'network', at: new Date().toISOString() },
  })
  allObjectsFetchedAt.set(client, Date.now())
  // The listing carries no metadata, so an unchanged catalog says nothing about the details on screen.
  void queryClient.invalidateQueries({ queryKey: ['objectDetails', ...serverScope()] })
}

/** The ETag to revalidate with, only while the store and the engine both hold the catalog it names. */
function currentValidator(client: I3XClient): string | undefined {
  const validator = catalogValidators.get(client)
  const state = useExplorerStore.getState()
  if (!validator || !state.allObjectsLoaded || conditionalRefused.has(client)) return undefined
  if (state.allObjectsFingerprint !== validator.fingerprint) return undefined
  if (state.catalogDetailsFingerprint !== validator.fingerprint) return undefined
  return validator.etag
}

async function fetchCatalogBody(client: I3XClient): Promise<CatalogBody> {
  const etag = currentValidator(client)
  if (!etag) return client.getObjectCatalogBytes()
  try {
    return await client.getObjectCatalogBytes(etag)
  } catch (err) {
    // fetch rejects with a TypeError only when the request never got a response.
    if (!(err instanceof TypeError)) throw err
    const body = await client.getObjectCatalogBytes()
    // The plain request got through, so the header was the problem, not the network.
    conditionalRefused.add(client)
    return body
  }
}

async function installFromCache(engine: CatalogEngineApi, client: I3XClient, source: CatalogSource): Promise<void> {
  try {
    const cached = await engine.readCache(source)
    if (!cached || getClient() !== client || useExplorerStore.getState().allObjectsLoaded) return
    const catalog = await installCatalogColumns(cached.columns, useExplorerStore.getState().objectIndex)
    if (getClient() !== client || useExplorerStore.getState().allObjectsLoaded) return
    requireCurrentEngine(engine)
    useExplorerStore.getState().setAllObjectsCatalog(catalog)
    useExplorerStore.setState({ catalogOrigin: { kind: 'cache', at: cached.savedAt } })
  } catch (err) {
    console.warn('Catalog cache read failed:', err)
  }
}
