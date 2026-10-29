import type { ObjectType } from '../api/types'
import { catalogColumnTransferables } from './catalogColumns'
import type { CatalogEngine, CatalogSource, TypeNamespaces } from './catalogEngine'

type Transfer = <T>(value: T, transferables: Transferable[]) => T

const passThrough: Transfer = value => value

/**
 * The engine's message surface, identical in the worker and in-process. Every
 * method is async so a Comlink `Remote` and the local object share one type;
 * `transfer` marks column buffers to move rather than copy (Comlink's
 * `transfer` in the worker, a no-op in-process).
 */
export function createCatalogEngineApi(engine: CatalogEngine, transfer: Transfer = passThrough) {
  return {
    ping: async () => true,
    readCache: async (source: CatalogSource) => {
      const cached = await engine.readCache(source)
      return cached ? transfer(cached, catalogColumnTransferables(cached.columns)) : null
    },
    ingest: async (
      buffer: ArrayBuffer,
      source: CatalogSource,
      installedFingerprint: string | null,
      typeNamespaces: TypeNamespaces
    ) => {
      const result = engine.ingest(buffer, source, installedFingerprint, typeNamespaces)
      return result.columns ? transfer(result, catalogColumnTransferables(result.columns)) : result
    },
    revalidated: async (source: CatalogSource, installedFingerprint: string | null, typeNamespaces: TypeNamespaces) => {
      const result = engine.revalidated(source, installedFingerprint, typeNamespaces)
      return result?.columns ? transfer(result, catalogColumnTransferables(result.columns)) : result
    },
    roots: async (buffer: ArrayBuffer, typeNamespaces: TypeNamespaces) => {
      const columns = engine.roots(buffer, typeNamespaces)
      return transfer(columns, catalogColumnTransferables(columns))
    },
    insights: async (objectTypes: ObjectType[], namespaceCount: number, catalogFingerprint: string) =>
      engine.insights(objectTypes, namespaceCount, catalogFingerprint),
    clearCache: () => engine.clearCache(),
  }
}

export type CatalogEngineApi = ReturnType<typeof createCatalogEngineApi>
