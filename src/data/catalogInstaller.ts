import { createObjectIndexBuilder, type ObjectCatalog } from '../api/objectCatalog'
import type { ObjectInstance } from '../api/types'
import {
  ABSENT,
  COMPOSITION_FLAG,
  EXTENDED_FLAG,
  createStringReader,
  type CatalogColumns,
} from './catalogColumns'
import { forEachSliced } from './yieldToMain'

// Objects built from columns carry only the light fields; their heavy fields live in the catalog engine.
const skeletons = new WeakSet<ObjectInstance>()

/** True for a catalog object whose metadata, relationships, and description must come from the engine. */
export function isCatalogSkeleton(object: ObjectInstance): boolean {
  return skeletons.has(object)
}

/**
 * Materializes columns into skeleton objects and their indexes without a long
 * main-thread task. A row whose light fields match the installed skeleton for
 * the same elementId reuses that instance, so unchanged objects keep their identity.
 */
export async function installCatalogColumns(
  columns: CatalogColumns,
  installed: { get(elementId: string): ObjectInstance | undefined }
): Promise<ObjectCatalog> {
  const text = createStringReader(columns)
  const objects: ObjectInstance[] = new Array(columns.count)
  const builder = createObjectIndexBuilder()

  await forEachSliced(columns.count, row => {
    const elementId = text(columns.elementId[row])
    const displayName = text(columns.displayName[row])
    const typeId = text(columns.typeId[row])
    const namespaceUri = text(columns.namespaceUri[row])
    const parentIndex = columns.parentId[row]
    const parentId = parentIndex === ABSENT ? null : text(parentIndex)
    const sourceIndex = columns.sourceTypeId[row]
    const sourceTypeId = sourceIndex === ABSENT ? undefined : text(sourceIndex)
    const isComposition = (columns.flags[row] & COMPOSITION_FLAG) !== 0
    const isExtended = (columns.flags[row] & EXTENDED_FLAG) !== 0

    const previous = installed.get(elementId)
    let object: ObjectInstance
    if (
      previous !== undefined &&
      skeletons.has(previous) &&
      previous.displayName === displayName &&
      previous.typeId === typeId &&
      previous.namespaceUri === namespaceUri &&
      previous.parentId === parentId &&
      previous.sourceTypeId === sourceTypeId &&
      previous.isComposition === isComposition &&
      previous.isExtended === isExtended
    ) {
      object = previous
    } else {
      object = { elementId, displayName, typeId, parentId, isComposition, isExtended, namespaceUri, sourceTypeId }
      skeletons.add(object)
    }
    objects[row] = object
    builder.add(object)
  })

  return { objects, fingerprint: columns.fingerprint, ...builder.finish() }
}
