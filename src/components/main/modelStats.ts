import type { ObjectInstance, ObjectType } from '../../api/types'

/**
 * The model, counted rather than drawn.
 *
 * A node-link map of a whole catalog is a hairball, at the scale this app
 * browses (tens of thousands of objects) it says nothing you can act on. The
 * questions people actually bring to a model overview are statistical: how much
 * of each type is there, and how deep does the hierarchy go. So this module
 * answers those, and it answers them from the store alone (no requests, no caps,
 * no sampling).
 *
 * Everything here is derived from `parentId` links, which are the only edges the
 * client can know without a per-object round trip. That is a real limit and the
 * panel says so out loud rather than implying it has drawn every relationship.
 */

/** A counted category, a type, a namespace, a hierarchy level. */
export interface Tally {
  key: string
  label: string
  count: number
  /** The synthetic "Other (N types)" fold-up row. It names no real category, so it can't be opened. */
  isOther?: boolean
}

/** A pointer at one object, enough to list it and navigate to it. */
export interface ObjectRef {
  elementId: string
  label: string
  typeLabel: string
  children: number
}

export interface ModelStats {
  objects: number
  /** Types with at least one instance, not the number declared. */
  typesInUse: number
  typesDeclared: number
  namespaces: number
  /** parentId links whose parent is actually in the catalog. */
  links: number
  /**
   * Objects you cannot navigate up from: no parent, or a parent outside the
   * catalog. The tops of the loaded hierarchy, level 0 of the depth histogram.
   */
  roots: number
  /** Of those roots, the ones that DO name a parent, the catalog just doesn't hold it. */
  orphans: number
  /** Objects that contain nothing. */
  leaves: number
  compositions: number
  /** Deepest chain, in levels below a root. A root is depth 0. */
  maxDepth: number
  /** Most children held by any one object. */
  maxFanout: number
  /** Mean children per object that has any. */
  avgFanout: number

  /** Objects with no typeId at all, a modeling smell. */
  untyped: number
  /** Declared types with zero instances. */
  unusedTypes: number

  /**
   * The objects holding the most children, and the top-level objects. On a
   * 100k-object catalog these are the only two lists that let you *start*: the
   * hubs are where the structure actually is, and the roots are the way in.
   */
  hubs: ObjectRef[]
  rootObjects: ObjectRef[]

  byType: Tally[]
  byNamespace: Tally[]
  /** Objects per hierarchy level; index is the level. */
  byDepth: Tally[]
}

const NO_PARENT = '/'

/** Enough rows to see the shape, few enough to scan. */
const TOP_N = 8

/** Shared with insightsReport: '', '/' and null all mean "no parent". */
export function hasParent(object: ObjectInstance): boolean {
  return object.parentId != null && object.parentId !== '' && object.parentId !== NO_PARENT
}

export function computeModelStats(
  objects: ObjectInstance[],
  objectTypes: ObjectType[],
  namespaceCount: number,
  // Optional pre-built artifacts so getInsightsReport can run the index build
  // and the depth walk ONCE for both this and the insights report. When shared
  // depths come from the deduped catalog, the histogram differs from a raw walk
  // only on catalogs with duplicate elementIds, which the insights quality hub
  // surfaces anyway.
  shared?: { index: Map<string, ObjectInstance>; depths: Map<string, number> }
): ModelStats {
  const typeLabels = new Map(objectTypes.map(type => [type.elementId, type.displayName || type.elementId]))
  const labelOf = (typeId: string) => typeLabels.get(typeId) ?? typeId ?? '(untyped)'

  let index = shared?.index
  if (!index) {
    index = new Map<string, ObjectInstance>()
    for (const object of objects) index.set(object.elementId, object)
  }

  const childCount = new Map<string, number>()
  const typeTally = new Map<string, number>()
  const namespaceTally = new Map<string, number>()

  const rootList: ObjectInstance[] = []

  let links = 0
  let roots = 0
  let orphans = 0
  let compositions = 0
  let untyped = 0

  for (const object of objects) {
    const typeId = object.typeId ?? ''
    if (!typeId) untyped++
    typeTally.set(typeId, (typeTally.get(typeId) ?? 0) + 1)
    if (object.namespaceUri) {
      namespaceTally.set(object.namespaceUri, (namespaceTally.get(object.namespaceUri) ?? 0) + 1)
    }
    if (object.isComposition) compositions++

    const parent = hasParent(object) ? index.get(object.parentId as string) : undefined

    if (!parent) {
      // No parent at all, or a parentId naming something outside the catalog,
      // either way you cannot navigate UP from here, so it is a top of the loaded
      // hierarchy and belongs in the entry-point list. Counting only the former as
      // a root would contradict the depth histogram, which has to place orphans at
      // level 0 for want of anywhere else to put them.
      //
      // The orphan case is still tallied on its own: it usually means a partial
      // load, or a server that reports parents it won't list, and that is worth
      // saying out loud.
      if (hasParent(object)) orphans++
      roots++
      rootList.push(object)
      continue
    }

    links++
    childCount.set(parent.elementId, (childCount.get(parent.elementId) ?? 0) + 1)
  }

  const depths = shared?.depths ?? computeDepths(objects, index)
  const depthTally = new Map<number, number>()
  let maxDepth = 0
  for (const depth of depths.values()) {
    depthTally.set(depth, (depthTally.get(depth) ?? 0) + 1)
    if (depth > maxDepth) maxDepth = depth
  }

  // A loop, not Math.max(...): spreading one argument per parent overflows the stack on large catalogs.
  let maxFanout = 0
  let totalFanout = 0
  for (const count of childCount.values()) {
    if (count > maxFanout) maxFanout = count
    totalFanout += count
  }
  const avgFanout = childCount.size ? totalFanout / childCount.size : 0

  const refOf = (object: ObjectInstance): ObjectRef => ({
    elementId: object.elementId,
    label: object.displayName || object.elementId,
    typeLabel: labelOf(object.typeId ?? ''),
    children: childCount.get(object.elementId) ?? 0,
  })

  // Partial selection, not a full sort: on a 100k catalog with 40k roots, sorting
  // the whole list to show eight rows is wasted work.
  const hubs = topBy(
    [...childCount.keys()],
    id => childCount.get(id) ?? 0,
    TOP_N
  ).map(id => refOf(index.get(id)!))

  const rootObjects = topBy(
    rootList,
    object => childCount.get(object.elementId) ?? 0,
    TOP_N
  ).map(refOf)

  return {
    objects: objects.length,
    typesInUse: typeTally.size,
    typesDeclared: objectTypes.length,
    namespaces: namespaceCount,
    links,
    roots,
    orphans,
    leaves: objects.length - childCount.size,
    compositions,
    maxDepth,
    maxFanout,
    avgFanout,

    untyped,
    unusedTypes: objectTypes.filter(type => !typeTally.has(type.elementId)).length,
    hubs,
    rootObjects,

    byType: rank(typeTally, labelOf),
    byNamespace: rank(namespaceTally, uri => uri),
    byDepth: [...depthTally.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, count]) => ({
        key: String(depth),
        label: depth === 0 ? 'Root' : `Level ${depth}`,
        count,
      })),
  }
}

/**
 * Level below the nearest root, memoised across the walk so a deep chain is
 * costed once. A parentId cycle (which some servers do emit) would otherwise
 * spin forever, so the in-progress set breaks it and treats the entry point as a
 * root. (Exported for insightsReport's per-type depth ranges.)
 */
export function computeDepths(
  objects: ObjectInstance[],
  index: Map<string, ObjectInstance>
): Map<string, number> {
  const depths = new Map<string, number>()

  const depthOf = (object: ObjectInstance, seen: Set<string>): number => {
    const cached = depths.get(object.elementId)
    if (cached !== undefined) return cached
    if (seen.has(object.elementId)) return 0

    if (!hasParent(object)) {
      depths.set(object.elementId, 0)
      return 0
    }
    const parent = index.get(object.parentId as string)
    if (!parent) {
      // Orphan: its ancestors aren't here, so the only honest level is 0.
      depths.set(object.elementId, 0)
      return 0
    }

    seen.add(object.elementId)
    const depth = depthOf(parent, seen) + 1
    seen.delete(object.elementId)
    depths.set(object.elementId, depth)
    return depth
  }

  for (const object of objects) depthOf(object, new Set())
  return depths
}

/**
 * The `limit` largest items by `score`, highest first. A linear scan keeping a
 * small sorted buffer, sorting the whole array to read the top eight is O(n log n)
 * for nothing, and this list can be 100k long. (Exported for tests.)
 */
export function topBy<T>(items: T[], score: (item: T) => number, limit: number): T[] {
  const best: T[] = []

  for (const item of items) {
    const value = score(item)
    if (best.length === limit && value <= score(best[best.length - 1])) continue

    let at = best.length
    while (at > 0 && score(best[at - 1]) < value) at--
    best.splice(at, 0, item)
    if (best.length > limit) best.pop()
  }

  return best
}

function rank(tally: Map<string, number>, labelOf: (key: string) => string): Tally[] {
  return [...tally.entries()]
    .map(([key, count]) => ({ key, label: labelOf(key) || '(untyped)', count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Fold a ranked list down to `limit` rows plus an "Other" row, so a catalog with
 * 300 types doesn't render 300 bars. Returns the list unchanged when it fits.
 */
export function withOther(tallies: Tally[], limit: number): Tally[] {
  if (tallies.length <= limit) return tallies
  const head = tallies.slice(0, limit)
  const tail = tallies.slice(limit)
  const rest = tail.reduce((sum, item) => sum + item.count, 0)
  return [...head, { key: '\u0000other', label: `Other (${tail.length})`, count: rest, isOther: true }]
}
