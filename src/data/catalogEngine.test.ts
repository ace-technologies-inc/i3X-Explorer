import { describe, expect, it } from 'vitest'
import type { CatalogCache, CatalogCacheEntry } from './catalogCache'
import { CatalogEngine, type CatalogSource } from './catalogEngine'
import { installCatalogColumns, isCatalogSkeleton } from './catalogInstaller'

const SOURCE: CatalogSource = { baseUrl: 'http://server', cacheEnabled: false }
const TYPE_NAMESPACES = { SiteType: 'urn:x', LineType: 'urn:y' }

function body(objects: unknown[]): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({ success: true, result: objects })).buffer
}

const parent = {
  elementId: 'site',
  displayName: 'Site',
  typeElementId: 'SiteType',
  parentId: null,
  isComposition: false,
}
const child = {
  elementId: 'line',
  displayName: 'Line',
  typeElementId: 'LineType',
  parentId: 'site',
  isComposition: true,
}

function memoryCache(): CatalogCache & { entries: Map<string, CatalogCacheEntry> } {
  const entries = new Map<string, CatalogCacheEntry>()
  return {
    entries,
    read: async baseUrl => entries.get(baseUrl),
    write: async (baseUrl, entry) => {
      entries.set(baseUrl, entry)
    },
    clear: async () => entries.clear(),
  }
}

describe('CatalogEngine', () => {
  it('returns light columns with each object in its type\'s namespace', async () => {
    const engine = new CatalogEngine(null)
    const result = engine.ingest(body([parent, child]), SOURCE, null, TYPE_NAMESPACES)
    const catalog = await installCatalogColumns(result.columns!, new Map())

    const line = catalog.objectIndex.get('line')!
    expect(line).toMatchObject({ displayName: 'Line', typeId: 'LineType', parentId: 'site', isComposition: true, namespaceUri: 'urn:y' })
    expect(line.metadata).toBeUndefined()
    expect(isCatalogSkeleton(line)).toBe(true)
    expect(catalog.childrenByParent.get('site')).toEqual([line])
  })

  it('keeps a namespace the server lists, and leaves an unknown type without one', async () => {
    const engine = new CatalogEngine(null)
    const listed = { ...parent, metadata: { typeNamespaceUri: 'urn:listed' } }
    const untyped = { ...child, typeElementId: 'Unknown' }
    const result = engine.ingest(body([listed, untyped]), SOURCE, null, TYPE_NAMESPACES)
    const catalog = await installCatalogColumns(result.columns!, new Map())

    expect(catalog.objectIndex.get('site')?.namespaceUri).toBe('urn:listed')
    expect(catalog.objectIndex.get('line')?.namespaceUri).toBe('')
  })

  it('answers nothing for a catalog it no longer holds', () => {
    const engine = new CatalogEngine(null)
    engine.ingest(body([parent]), SOURCE, null, TYPE_NAMESPACES)

    expect(engine.insights([], 1, 'some-other-catalog')).toBeNull()
  })

  it('treats a changed type namespace as a new catalog, even for the same body', async () => {
    const engine = new CatalogEngine(null)
    const listed = { ...parent, metadata: { typeNamespaceUri: 'urn:listed' } }
    const first = engine.ingest(body([listed, child]), SOURCE, null, TYPE_NAMESPACES)

    const second = engine.ingest(body([listed, child]), SOURCE, first.fingerprint, { ...TYPE_NAMESPACES, LineType: 'urn:moved' })
    const catalog = await installCatalogColumns(second.columns!, new Map())

    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(catalog.objectIndex.get('line')?.namespaceUri).toBe('urn:moved')
    expect(catalog.searchIndex.get('line')).toContain('urn:moved')
    expect(catalog.objectIndex.get('site')?.namespaceUri).toBe('urn:listed')
    expect(engine.ingest(body([listed, child]), SOURCE, second.fingerprint, { LineType: 'urn:moved', SiteType: 'urn:x' }).columns).toBeNull()
  })

  it('reapplies type namespaces to a revalidated body, and declines one it does not hold', async () => {
    const engine = new CatalogEngine(null)
    expect(engine.revalidated(SOURCE, null, TYPE_NAMESPACES)).toBeNull()
    const first = engine.ingest(body([parent, child]), SOURCE, null, TYPE_NAMESPACES)

    expect(engine.revalidated(SOURCE, first.fingerprint, TYPE_NAMESPACES)).toEqual({ fingerprint: first.fingerprint, columns: null })
    const moved = engine.revalidated(SOURCE, first.fingerprint, { ...TYPE_NAMESPACES, LineType: 'urn:moved' })!
    const catalog = await installCatalogColumns(moved.columns!, new Map())

    expect(catalog.objectIndex.get('line')?.namespaceUri).toBe('urn:moved')
    expect(engine.insights([], 1, moved.fingerprint)).not.toBeNull()
    expect(engine.revalidated({ ...SOURCE, baseUrl: 'http://other' }, null, TYPE_NAMESPACES)).toBeNull()
  })

  it('computes model insights over the catalog it holds, returning only the result', () => {
    const engine = new CatalogEngine(null)
    const { fingerprint } = engine.ingest(body([parent, child]), SOURCE, null, TYPE_NAMESPACES)

    const result = engine.insights([], 1, fingerprint)!

    expect(Object.keys(result).sort()).toEqual(['report', 'stats'])
    expect(result.stats).toMatchObject({ objects: 2, roots: 1, namespaces: 1 })
  })

  it('returns the roots in a roots body as light columns', async () => {
    const engine = new CatalogEngine(null)

    const columns = engine.roots(body([parent]), TYPE_NAMESPACES)
    const { objects } = await installCatalogColumns(columns, new Map())

    expect(objects.map(object => object.elementId)).toEqual(['site'])
    expect(objects[0].namespaceUri).toBe('urn:x')
  })

  it('reports an unchanged body without columns', () => {
    const engine = new CatalogEngine(null)
    const first = engine.ingest(body([parent]), SOURCE, null, TYPE_NAMESPACES)

    const second = engine.ingest(body([parent]), SOURCE, first.fingerprint, TYPE_NAMESPACES)

    expect(second).toEqual({ fingerprint: first.fingerprint, columns: null })
  })

  it('caches the light columns per server and ignores entries written for another wire format', async () => {
    const cache = memoryCache()
    const engine = new CatalogEngine(cache)
    const source = { ...SOURCE, cacheEnabled: true }
    engine.ingest(body([parent, child]), source, null, TYPE_NAMESPACES)
    await new Promise(resolve => setTimeout(resolve, 0))

    const cached = await engine.readCache(source)
    const catalog = await installCatalogColumns(cached!.columns, new Map())
    expect(catalog.objects.map(object => object.elementId)).toEqual(['site', 'line'])
    expect(cache.entries.get(source.baseUrl)?.apiVersion).toBe('v1')
    expect(await engine.readCache({ ...source, cacheEnabled: false })).toBeNull()
    for (const stale of ['v0', 'v1-beta', undefined]) {
      cache.entries.set(source.baseUrl, { ...cache.entries.get(source.baseUrl)!, apiVersion: stale as unknown as string })
      expect(await engine.readCache(source)).toBeNull()
    }
    cache.entries.set(source.baseUrl, { ...cache.entries.get(source.baseUrl)!, apiVersion: 'v1' })

    const moved = engine.revalidated(source, null, { ...TYPE_NAMESPACES, LineType: 'urn:moved' })!
    await new Promise(resolve => setTimeout(resolve, 0))
    const recached = (await engine.readCache(source))!
    expect(recached.columns.fingerprint).toBe(moved.fingerprint)
    const recachedCatalog = await installCatalogColumns(recached.columns, new Map())
    expect(recachedCatalog.objectIndex.get('line')?.namespaceUri).toBe('urn:moved')
  })
})
