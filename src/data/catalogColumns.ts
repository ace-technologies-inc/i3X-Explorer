import type { ObjectInstance } from '../api/types'

/**
 * The light fields of a full catalog as columns: typed arrays move between
 * threads without a copy, and one flat string copies as a single memcpy. A
 * structured-cloned object graph of the same catalog costs seconds instead.
 */
export interface CatalogColumns {
  fingerprint: string
  count: number
  /** Every distinct string, concatenated. */
  strings: string
  /** distinct + 1 offsets into `strings`, in UTF-16 code units. */
  stringOffsets: Uint32Array
  elementId: Uint32Array
  displayName: Uint32Array
  typeId: Uint32Array
  namespaceUri: Uint32Array
  /** String index, or ABSENT for null. */
  parentId: Int32Array
  /** String index, or ABSENT when the object has none. */
  sourceTypeId: Int32Array
  flags: Uint8Array
}

export const ABSENT = -1
export const COMPOSITION_FLAG = 1
export const EXTENDED_FLAG = 2

export function encodeCatalogColumns(objects: ObjectInstance[], fingerprint: string): CatalogColumns {
  const indexes = new Map<string, number>()
  const parts: string[] = []
  const offsets: number[] = [0]
  let length = 0
  const intern = (value: string): number => {
    let index = indexes.get(value)
    if (index === undefined) {
      index = parts.length
      indexes.set(value, index)
      parts.push(value)
      length += value.length
      offsets.push(length)
    }
    return index
  }

  const count = objects.length
  const elementId = new Uint32Array(count)
  const displayName = new Uint32Array(count)
  const typeId = new Uint32Array(count)
  const namespaceUri = new Uint32Array(count)
  const parentId = new Int32Array(count)
  const sourceTypeId = new Int32Array(count)
  const flags = new Uint8Array(count)

  for (let row = 0; row < count; row++) {
    const object = objects[row]
    elementId[row] = intern(object.elementId)
    displayName[row] = intern(object.displayName ?? '')
    typeId[row] = intern(object.typeId ?? '')
    namespaceUri[row] = intern(object.namespaceUri ?? '')
    parentId[row] = object.parentId == null ? ABSENT : intern(object.parentId)
    sourceTypeId[row] = object.sourceTypeId == null ? ABSENT : intern(object.sourceTypeId)
    flags[row] = (object.isComposition ? COMPOSITION_FLAG : 0) | (object.isExtended ? EXTENDED_FLAG : 0)
  }

  return {
    fingerprint,
    count,
    strings: parts.join(''),
    stringOffsets: Uint32Array.from(offsets),
    elementId,
    displayName,
    typeId,
    namespaceUri,
    parentId,
    sourceTypeId,
    flags,
  }
}

/** The buffers to transfer (not copy) when posting columns to another thread. */
export function catalogColumnTransferables(columns: CatalogColumns): ArrayBuffer[] {
  return [
    columns.stringOffsets,
    columns.elementId,
    columns.displayName,
    columns.typeId,
    columns.namespaceUri,
    columns.parentId,
    columns.sourceTypeId,
    columns.flags,
  ].map(column => column.buffer as ArrayBuffer)
}

/** Memoized string lookup: repeated values (types, namespaces) decode once and share one string. */
export function createStringReader(columns: CatalogColumns): (index: number) => string {
  const decoded: (string | undefined)[] = new Array(columns.stringOffsets.length - 1)
  return index =>
    (decoded[index] ??= columns.strings.slice(columns.stringOffsets[index], columns.stringOffsets[index + 1]))
}
