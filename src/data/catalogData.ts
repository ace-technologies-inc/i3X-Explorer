import { transfer, wrap } from 'comlink'
import { getClient, type ObjectDetailsFailure } from '../api/client'
import type { Namespace, ObjectInstance, ObjectType } from '../api/types'
import { metadataKey } from '../components/diff/diffEngine'
import { compressSnapshotText, createSnapshot, serializeSnapshot } from '../components/diff/snapshot'
import {
  getInsightsReport,
  peekInsightsReport,
  primeInsightsReport,
  type InsightsResult,
} from '../components/main/insightsReport'
import { useExplorerStore } from '../stores/explorer'
import { createIndexedDbCatalogCache } from './catalogCache'
import { CatalogEngine } from './catalogEngine'
import { createCatalogEngineApi, type CatalogEngineApi } from './catalogEngineApi'
import { isCatalogSkeleton } from './catalogInstaller'
import { subtreeValue, toJson, withCatalogDetails } from './catalogJson'

const WORKER_START_TIMEOUT_MS = 5000

let enginePromise: Promise<CatalogEngineApi> | null = null
let currentEngine: CatalogEngineApi | null = null
let stopEngine: (() => void) | null = null
let engineGeneration = 0

/** The catalog engine: in the catalog worker when one starts, otherwise in-process. */
export function getCatalogEngine(): Promise<CatalogEngineApi> {
  enginePromise ??= startEngine()
  return enginePromise
}

/** Drops the engine so the next request starts a fresh one. */
export function resetCatalogEngine(): void {
  engineGeneration += 1
  enginePromise = null
  currentEngine = null
  const stop = stopEngine
  stopEngine = null
  stop?.()
  useExplorerStore.setState({ catalogDetailsFingerprint: null })
}

export function isCurrentCatalogEngine(engine: CatalogEngineApi): boolean {
  return currentEngine === engine
}

/** Marks an ArrayBuffer to move to the engine instead of being copied. */
export function transferBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return transfer(buffer, [buffer])
}

function inProcessEngine(): CatalogEngineApi {
  return createCatalogEngineApi(new CatalogEngine(createIndexedDbCatalogCache()))
}

async function startEngine(): Promise<CatalogEngineApi> {
  const generation = engineGeneration
  if (typeof Worker === 'undefined') {
    currentEngine = inProcessEngine()
    return currentEngine
  }
  let worker: Worker | undefined
  let stop: (() => void) | undefined
  try {
    worker = new Worker(new URL('./catalogEngine.worker.ts', import.meta.url), { type: 'module' })
    const started = worker
    // Comlink's Remote<T> of an all-async API has the same call shape as T.
    const remote = wrap<CatalogEngineApi>(started) as unknown as CatalogEngineApi
    let failure: Error | null = null
    let ready = false
    const pending = new Set<(error: Error) => void>()
    const api = new Proxy(remote, {
      get(target, property) {
        if (property === 'then') return undefined
        return (...args: unknown[]) => new Promise((resolve, reject) => {
          if (failure) {
            reject(failure)
            return
          }
          pending.add(reject)
          Promise.resolve().then(() => {
            if (failure) throw failure
            return Reflect.apply(Reflect.get(target, property), target, args)
          }).then(value => {
            pending.delete(reject)
            resolve(value)
          }, err => {
            pending.delete(reject)
            reject(err)
          })
        })
      },
    }) as CatalogEngineApi
    stop = () => {
      if (failure) return
      failure = new Error('The catalog worker stopped. Refresh the catalog to try again.')
      for (const reject of pending) reject(failure)
      pending.clear()
      started.removeEventListener('error', failed)
      started.removeEventListener('messageerror', failed)
      started.terminate()
    }
    const failed = () => {
      stop?.()
      if (ready && generation === engineGeneration) resetCatalogEngine()
    }
    stopEngine = stop
    started.addEventListener('error', failed)
    started.addEventListener('messageerror', failed)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the worker did not respond')), WORKER_START_TIMEOUT_MS)
      api.ping().then(() => {
        clearTimeout(timer)
        resolve()
      }, err => {
        clearTimeout(timer)
        reject(err)
      })
    })
    if (generation !== engineGeneration) throw new Error('The catalog engine was reset during startup')
    ready = true
    currentEngine = api
    return api
  } catch (err) {
    stop?.()
    if (generation !== engineGeneration) throw err
    console.warn('Catalog worker unavailable; processing the catalog on the main thread:', err)
    worker?.terminate()
    stopEngine = null
    currentEngine = inProcessEngine()
    return currentEngine
  }
}

type DetailsSource = { kind: 'engine'; fingerprint: string } | { kind: 'store' } | { kind: 'pending' }

/** Where the catalog on screen can be reported on right now. */
function detailsSource(): DetailsSource {
  const { allObjectsFingerprint, catalogDetailsFingerprint } = useExplorerStore.getState()
  // Written through setAllObjects: the store objects are already full.
  if (allObjectsFingerprint === null) return { kind: 'store' }
  if (allObjectsFingerprint === catalogDetailsFingerprint) return { kind: 'engine', fingerprint: allObjectsFingerprint }
  return { kind: 'pending' }
}

function isFull(object: ObjectInstance | undefined): object is ObjectInstance {
  return object !== undefined && !isCatalogSkeleton(object) && object.metadata !== undefined
}

/** Thrown when the server could not supply the full object for some of the ids a feature needs. */
export class ObjectDetailsError extends Error {
  constructor(readonly failures: ObjectDetailsFailure[]) {
    const listed = failures.slice(0, 3).map(failure => `${failure.elementId} (${failure.message})`).join(', ')
    const more = failures.length > 3 ? `, and ${failures.length - 3} more` : ''
    super(`Could not load the details of ${failures.length} object${failures.length === 1 ? '' : 's'}: ${listed}${more}. Refresh the catalog and try again.`)
    this.name = 'ObjectDetailsError'
  }
}

/**
 * The full objects (metadata, relationships, description) for these elements.
 * The catalog is listed without them, so anything the store doesn't hold in
 * full comes from the server. Rejects with `ObjectDetailsError` unless every
 * element resolved, so no caller mistakes a skeleton for a full object.
 */
export async function fullObjects(elementIds: Iterable<string>): Promise<Map<string, ObjectInstance>> {
  const { objectIndex } = useExplorerStore.getState()
  const full = new Map<string, ObjectInstance>()
  const missing: string[] = []
  for (const elementId of new Set(elementIds)) {
    const held = objectIndex.get(elementId)
    if (isFull(held)) full.set(elementId, held)
    else missing.push(elementId)
  }
  if (missing.length === 0) return full
  const client = getClient()
  if (!client) throw new Error('Not connected to a server')
  const { objects, failures } = await client.getObjectDetails(missing)
  if (failures.length > 0) throw new ObjectDetailsError(failures)
  for (const object of objects) full.set(object.elementId, object)
  return full
}

function collectElementIds(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectElementIds(item, into)
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.elementId === 'string') into.add(record.elementId)
    for (const child of Object.values(record)) collectElementIds(child, into)
  }
  return into
}

/** JSON for a small value (an object, a branch, a related group), with every object in it made full. */
export async function catalogValueJson(value: unknown): Promise<string> {
  const full = await fullObjects(collectElementIds(value, new Set()))
  return toJson(withCatalogDetails(value, elementId => full.get(elementId)))
}

/** JSON array of the full objects. */
export async function catalogObjectsJson(objects: ObjectInstance[]): Promise<string> {
  const full = await fullObjects(objects.map(object => object.elementId))
  return toJson(objects.map(object => full.get(object.elementId) ?? object))
}

/** Nested `{ ...object, children }` JSON under each root, with full objects. */
export async function catalogSubtreeJson(roots: ObjectInstance[]): Promise<string> {
  const { childrenByParent } = useExplorerStore.getState()
  const visited = new Set<string>()
  return catalogValueJson(roots.map(root => subtreeValue(root, childrenByParent, visited)))
}

export interface CatalogSnapshotRequest {
  appVersion: string
  serverUrl: string
  capturedAt: string
  namespaces: Namespace[]
  objectTypes: ObjectType[]
}

/** The gzipped snapshot file of the catalog on screen, with its objects' metadata fetched in batches. */
export async function catalogSnapshotBlob(request: CatalogSnapshotRequest): Promise<Blob> {
  const { allObjects } = useExplorerStore.getState()
  const full = await fullObjects(allObjects.map(object => object.elementId))
  const objects = allObjects.map(object => full.get(object.elementId) ?? object)
  return compressSnapshotText(serializeSnapshot(createSnapshot({ ...request, objects })))
}

/**
 * Deep-compare keys for the live catalog's objects, from their metadata fetched
 * in batches, or undefined when the store objects are already full (compare them directly).
 */
export async function catalogMetadataKeyer(): Promise<((object: ObjectInstance) => string) | undefined> {
  const { allObjects } = useExplorerStore.getState()
  if (allObjects.every(object => isFull(object))) return undefined
  const full = await fullObjects(allObjects.map(object => object.elementId))
  return object => metadataKey(full.get(object.elementId) ?? object)
}

let insightsInFlight: {
  objects: ObjectInstance[]
  objectTypes: ObjectType[]
  namespaceCount: number
  promise: Promise<InsightsResult | null>
} | null = null

/**
 * Hierarchy stats and model insights for the catalog on screen, computed in the
 * engine when it holds that catalog. Null while the engine is still parsing it
 * (the cache-first window); store-held full objects are computed in-process.
 */
export function catalogInsightsReport(
  objects: ObjectInstance[],
  objectTypes: ObjectType[],
  namespaceCount: number
): Promise<InsightsResult | null> {
  const cached = peekInsightsReport(objects, objectTypes, namespaceCount)
  if (cached) return Promise.resolve(cached)
  if (
    insightsInFlight?.objects === objects &&
    insightsInFlight.objectTypes === objectTypes &&
    insightsInFlight.namespaceCount === namespaceCount
  ) {
    return insightsInFlight.promise
  }
  const promise = computeInsights(objects, objectTypes, namespaceCount)
  insightsInFlight = { objects, objectTypes, namespaceCount, promise }
  const clear = () => {
    if (insightsInFlight?.promise === promise) insightsInFlight = null
  }
  promise.then(clear, clear)
  return promise
}

async function computeInsights(
  objects: ObjectInstance[],
  objectTypes: ObjectType[],
  namespaceCount: number
): Promise<InsightsResult | null> {
  const source = detailsSource()
  if (source.kind === 'store' || objects !== useExplorerStore.getState().allObjects) {
    return getInsightsReport(objects, objectTypes, namespaceCount)
  }
  if (source.kind === 'pending') return null
  const result = await (await getCatalogEngine()).insights(objectTypes, namespaceCount, source.fingerprint)
  return result ? primeInsightsReport(objects, objectTypes, namespaceCount, result) : null
}

export async function clearCatalogCache(): Promise<void> {
  await (await getCatalogEngine()).clearCache()
}
