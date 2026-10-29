import { clear, createStore, get, set } from 'idb-keyval'
import type { CatalogColumns } from './catalogColumns'

/**
 * The wire format tag every entry is written with. An entry carrying any other
 * tag (or none) came from a build that spoke a different format and is ignored.
 */
export const CATALOG_CACHE_FORMAT = 'v1'

export interface CatalogCacheEntry {
  fingerprint: string
  apiVersion: string
  savedAt: string
  columns: CatalogColumns
}

/** Last catalog columns per server URL. Light fields only; never credentials. */
export interface CatalogCache {
  read: (baseUrl: string) => Promise<CatalogCacheEntry | undefined>
  write: (baseUrl: string, entry: CatalogCacheEntry) => Promise<void>
  clear: () => Promise<void>
}

const DATABASE_NAME = 'i3x-explorer-catalog'
const STORE_NAME = 'catalogs'

export function createIndexedDbCatalogCache(): CatalogCache | null {
  if (typeof indexedDB === 'undefined') return null
  const store = createStore(DATABASE_NAME, STORE_NAME)
  return {
    read: baseUrl => get<CatalogCacheEntry>(baseUrl, store),
    write: (baseUrl, entry) => set(baseUrl, entry, store),
    clear: () => clear(store),
  }
}
