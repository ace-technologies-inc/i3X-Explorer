import { parseJsonArrayInBatches } from './jsonArrayBatches'
import { normalizeV1Object, unwrapV1Envelope } from './normalize'
import type { ObjectInstance } from './types'

// V8 caps a string near 512M characters; a body past this is parsed a batch at a time instead.
const WHOLE_BODY_PARSE_MAX_BYTES = 128 * 1024 * 1024
const BATCH_PARSE_BYTES = 16 * 1024 * 1024

export interface ProcessedObjectList {
  objects: ObjectInstance[]
}

export interface ObjectCatalogIndexes {
  childrenByParent: Map<string, ObjectInstance[]>
  objectIndex: Map<string, ObjectInstance>
  searchIndex: Map<string, string>
  objectCountByType: Map<string, number>
  catalogObjectsByType: Map<string, ObjectInstance[]>
}

/** A full catalog ready for the store: the objects, their indexes, and the body's content fingerprint. */
export interface ObjectCatalog extends ObjectCatalogIndexes {
  objects: ObjectInstance[]
  fingerprint: string
}

export interface ProcessedObjectCatalog extends ProcessedObjectList, ObjectCatalog {}

export interface ProcessObjectResponseOptions {
  buildIndexes: boolean
}

export type ProcessedObjectResult = ProcessedObjectList | ProcessedObjectCatalog

/** Builds the catalog indexes one object at a time, so a large install can yield between batches. */
export function createObjectIndexBuilder() {
  const childrenByParent = new Map<string, ObjectInstance[]>()
  const objectIndex = new Map<string, ObjectInstance>()
  const searchIndex = new Map<string, string>()
  const objectCountByType = new Map<string, number>()
  const catalogObjectsByType = new Map<string, ObjectInstance[]>()

  return {
    add(object: ObjectInstance): void {
      objectIndex.set(object.elementId, object)
      searchIndex.set(object.elementId, `${object.displayName} ${object.elementId} ${object.namespaceUri}`.toLowerCase())
      objectCountByType.set(object.typeId, (objectCountByType.get(object.typeId) ?? 0) + 1)
      const ofType = catalogObjectsByType.get(object.typeId)
      if (ofType) ofType.push(object)
      else catalogObjectsByType.set(object.typeId, [object])
      if (!object.parentId) return
      const siblings = childrenByParent.get(object.parentId)
      if (siblings) siblings.push(object)
      else childrenByParent.set(object.parentId, [object])
    },
    finish(): ObjectCatalogIndexes {
      return { childrenByParent, objectIndex, searchIndex, objectCountByType, catalogObjectsByType }
    },
  }
}

export function buildObjectIndexes(objects: ObjectInstance[]): ObjectCatalogIndexes {
  const builder = createObjectIndexBuilder()
  for (const object of objects) builder.add(object)
  return builder.finish()
}

export function processObjectResponse(
  buffer: ArrayBuffer,
  options: ProcessObjectResponseOptions & { buildIndexes: true }
): ProcessedObjectCatalog
export function processObjectResponse(
  buffer: ArrayBuffer,
  options: ProcessObjectResponseOptions & { buildIndexes: false }
): ProcessedObjectList
export function processObjectResponse(
  buffer: ArrayBuffer,
  options: ProcessObjectResponseOptions
): ProcessedObjectResult
export function processObjectResponse(
  buffer: ArrayBuffer,
  options: ProcessObjectResponseOptions
): ProcessedObjectResult {
  const list = parseObjectList(buffer)
  if (!options.buildIndexes) return list
  return { ...list, ...buildObjectIndexes(list.objects), fingerprint: fingerprint(buffer) }
}

function parseRawObjects(buffer: ArrayBuffer): unknown {
  if (buffer.byteLength > WHOLE_BODY_PARSE_MAX_BYTES) {
    const batched = parseJsonArrayInBatches(buffer, 'result', BATCH_PARSE_BYTES)
    if (batched) return batched
    // A server may answer with a bare array.
    return parseJsonArrayInBatches(buffer, 'root', BATCH_PARSE_BYTES)
  }
  return unwrapV1Envelope(JSON.parse(new TextDecoder().decode(buffer)))
}

export function parseObjectList(buffer: ArrayBuffer): ProcessedObjectList {
  const rawObjects = parseRawObjects(buffer)

  const objects = Array.isArray(rawObjects)
    ? rawObjects.map(object => normalizeV1Object(object as Record<string, unknown>))
    : []
  return { objects }
}

/** Content identity of a response body, hashed over 32-bit words so large catalogs stay cheap. */
export function fingerprint(buffer: ArrayBuffer): string {
  const wordCount = buffer.byteLength >>> 2
  const words = new Uint32Array(buffer, 0, wordCount)
  const tail = new Uint8Array(buffer, wordCount * 4)
  let first = 2166136261
  let second = 2246822519
  for (let index = 0; index < words.length; index++) {
    first = Math.imul(first ^ words[index], 16777619)
    second = Math.imul(second ^ words[index], 3266489917)
  }
  for (let index = 0; index < tail.length; index++) {
    first = Math.imul(first ^ tail[index], 16777619)
    second = Math.imul(second ^ tail[index], 3266489917)
  }
  return `${buffer.byteLength}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`
}
