import { fingerprint, parseObjectList } from '../api/objectCatalog'
import type { ObjectInstance, ObjectType } from '../api/types'
import { getInsightsReport, type InsightsResult } from '../components/main/insightsReport'
import { CATALOG_CACHE_FORMAT, type CatalogCache } from './catalogCache'
import { encodeCatalogColumns, type CatalogColumns } from './catalogColumns'

export interface CatalogSource {
  baseUrl: string
  cacheEnabled: boolean
}

/** typeId → namespaceUri, for objects listed without metadata. */
export type TypeNamespaces = Record<string, string>

export interface CatalogIngestResult {
  fingerprint: string
  /** Columns to install; null when the caller already shows this exact catalog. */
  columns: CatalogColumns | null
}

export interface CachedCatalog {
  savedAt: string
  columns: CatalogColumns
}

function parseCatalogObjects(buffer: ArrayBuffer, typeNamespaces: TypeNamespaces) {
  const list = parseObjectList(buffer)
  for (const object of list.objects) {
    if (!object.namespaceUri) object.namespaceUri = typeNamespaces[object.typeId] ?? ''
  }
  return list
}

/** Content identity of a namespace map, independent of key order. */
function namespacesIdentity(typeNamespaces: TypeNamespaces): string {
  const entries = Object.entries(typeNamespaces).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return fingerprint(new TextEncoder().encode(JSON.stringify(entries)).buffer as ArrayBuffer)
}

/**
 * Owns the catalog's objects: fingerprints and parses `/objects` bodies (listed
 * without metadata), keeps the objects, hands out light columns, and computes
 * whole-catalog reports. Thread-agnostic: it runs in the catalog worker, or
 * in-process when no worker is available. A report request names the
 * fingerprint the caller shows and gets null when the engine holds a different catalog.
 *
 * The catalog's fingerprint covers the body and the type namespaces its
 * objects took, so a namespace change alone is a new catalog too.
 */
export class CatalogEngine {
  private baseUrl: string | null = null
  private bodyFingerprint: string | null = null
  private namespacesFingerprint: string | null = null
  private catalogFingerprint: string | null = null
  private objects: ObjectInstance[] = []
  /** Rows the server listed no namespace for, which take their type's. */
  private derivedNamespaceRows: number[] = []

  constructor(private readonly cache: CatalogCache | null) {}

  async readCache(source: CatalogSource): Promise<CachedCatalog | null> {
    if (!source.cacheEnabled || !this.cache) return null
    const entry = await this.cache.read(source.baseUrl)
    if (!entry || entry.apiVersion !== CATALOG_CACHE_FORMAT) return null
    return { savedAt: entry.savedAt, columns: entry.columns }
  }

  ingest(
    buffer: ArrayBuffer,
    source: CatalogSource,
    installedFingerprint: string | null,
    typeNamespaces: TypeNamespaces
  ): CatalogIngestResult {
    const bodyFingerprint = fingerprint(buffer)
    if (source.baseUrl !== this.baseUrl || bodyFingerprint !== this.bodyFingerprint) {
      this.adopt(parseObjectList(buffer).objects, source.baseUrl, bodyFingerprint)
    }
    return this.publish(source, installedFingerprint, typeNamespaces)
  }

  /**
   * The catalog after the server confirmed its body is unchanged (a 304), with
   * the current type namespaces applied; null when the engine doesn't hold that body.
   */
  revalidated(
    source: CatalogSource,
    installedFingerprint: string | null,
    typeNamespaces: TypeNamespaces
  ): CatalogIngestResult | null {
    if (source.baseUrl !== this.baseUrl || this.bodyFingerprint === null) return null
    return this.publish(source, installedFingerprint, typeNamespaces)
  }

  /** The hierarchy roots in a roots body, as light columns. */
  roots(buffer: ArrayBuffer, typeNamespaces: TypeNamespaces): CatalogColumns {
    const list = parseCatalogObjects(buffer, typeNamespaces)
    const columnsFingerprint = `${fingerprint(buffer)}:${namespacesIdentity(typeNamespaces)}`
    return encodeCatalogColumns(list.objects, columnsFingerprint)
  }

  /** Hierarchy stats and model insights over the catalog, or null when the engine holds a different one. */
  insights(objectTypes: ObjectType[], namespaceCount: number, catalogFingerprint: string): InsightsResult | null {
    if (!this.holds(catalogFingerprint)) return null
    // Only the result crosses back; the memo entry also carries the whole catalog.
    const { stats, report } = getInsightsReport(this.objects, objectTypes, namespaceCount)
    return { stats, report }
  }

  async clearCache(): Promise<void> {
    await this.cache?.clear()
  }

  private holds(catalogFingerprint: string): boolean {
    return this.catalogFingerprint === catalogFingerprint
  }

  private adopt(objects: ObjectInstance[], baseUrl: string, bodyFingerprint: string): void {
    this.baseUrl = baseUrl
    this.bodyFingerprint = bodyFingerprint
    this.namespacesFingerprint = null
    this.catalogFingerprint = null
    this.objects = objects
    this.derivedNamespaceRows = []
    objects.forEach((object, row) => {
      if (!object.namespaceUri) this.derivedNamespaceRows.push(row)
    })
  }

  private publish(
    source: CatalogSource,
    installedFingerprint: string | null,
    typeNamespaces: TypeNamespaces
  ): CatalogIngestResult {
    const namespacesFingerprint = namespacesIdentity(typeNamespaces)
    if (namespacesFingerprint !== this.namespacesFingerprint) {
      for (const row of this.derivedNamespaceRows) {
        const object = this.objects[row]
        object.namespaceUri = typeNamespaces[object.typeId] ?? ''
      }
      this.namespacesFingerprint = namespacesFingerprint
      this.catalogFingerprint = `${this.bodyFingerprint}:${namespacesFingerprint}`
      if (source.cacheEnabled && this.cache) this.scheduleCacheWrite(source, this.catalogFingerprint)
    }
    const catalogFingerprint = this.catalogFingerprint!
    if (catalogFingerprint === installedFingerprint) return { fingerprint: catalogFingerprint, columns: null }
    return { fingerprint: catalogFingerprint, columns: encodeCatalogColumns(this.objects, catalogFingerprint) }
  }

  // Encodes its own copy after the ingest returns: the returned columns are transferred away.
  private scheduleCacheWrite(source: CatalogSource, catalogFingerprint: string): void {
    setTimeout(() => {
      if (this.catalogFingerprint !== catalogFingerprint || !this.cache) return
      this.cache.write(source.baseUrl, {
        fingerprint: catalogFingerprint,
        apiVersion: CATALOG_CACHE_FORMAT,
        savedAt: new Date().toISOString(),
        columns: encodeCatalogColumns(this.objects, catalogFingerprint),
      }).catch(err => console.warn('Catalog cache write failed:', err))
    }, 0)
  }
}
