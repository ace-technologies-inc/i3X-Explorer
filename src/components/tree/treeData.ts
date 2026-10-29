import { getClient, type I3XClient } from '../../api/client'
import {
  useExplorerStore, CHILD_PAGE_SIZE, CHILD_PAGE_SLACK, relationshipSourceRowId, parseRelationshipSourceRowId,
  type SelectedItem, type RelationshipInstance, type RelationshipTypeInstances,
} from '../../stores/explorer'
import type { Namespace, ObjectType, ObjectInstance, RelationshipType } from '../../api/types'
import { bucketOf } from '../graph/relationshipColors'
import { ensureAllObjectsLoaded, loadHierarchicalRoots, refreshAllObjects } from '../../services/catalog'

// Special folder IDs
export const NAMESPACES_FOLDER_ID = 'folder:namespaces'
export const OBJECTS_FOLDER_ID = 'folder:objects'
export const HIERARCHICAL_FOLDER_ID = 'folder:hierarchical'

// Max depth for tree rendering to prevent infinite loops
export const MAX_TREE_DEPTH = 20

// Fallback row height until the real one is measured from the first mounted row.
export const ESTIMATED_ROW_HEIGHT = 28

// Resolve chevron state for a set of compositional parents by asking the server
// what /objects/related actually returns, i.e. the same data the render filter
// sees at expansion time. Single batch round trip; only unresolved isComposition
// objects are queried, so callers can pass a superset cheaply.
export async function resolveCompositionFlags(client: I3XClient, loaded: ObjectInstance[]): Promise<void> {
  if (loaded.length === 0) return
  const { compositionCache, compositionErrors, mergeCompositionFlags, setCompositionErrors } = useExplorerStore.getState()
  const toResolve: string[] = []
  for (const obj of loaded) {
    // A failed lookup is retried by expanding the row, not by every scroll.
    if (obj.isComposition && !compositionCache.has(obj.elementId) && !compositionErrors.has(obj.elementId)) {
      toResolve.push(obj.elementId)
    }
  }
  if (toResolve.length === 0) return
  const additions = new Map<string, number>()
  const errors = new Map<string, string | null>()
  try {
    const { related, failures } = await client.getRelatedObjectsBatch(toResolve, 'HasComponent')
    for (const failure of failures) errors.set(failure.elementId, failure.message)
    for (const parentId of toResolve) {
      const children = related.get(parentId)
      // Unresolved keeps the optimistic chevron, so the failure stays reachable by expanding.
      if (!children) continue
      const qualifyingCount = children.filter(c =>
        c.isComposition && c.elementId !== parentId && c.parentId === parentId
      ).length
      additions.set(parentId, qualifyingCount)
      errors.set(parentId, null)
    }
  } catch (err) {
    console.error('Failed to resolve composition flags via /objects/related:', err)
    // Recorded so the visible-window resolver doesn't re-request the whole batch on every scroll.
    const message = err instanceof Error ? err.message : String(err)
    for (const parentId of toResolve) errors.set(parentId, message)
  }
  if (additions.size > 0) mergeCompositionFlags(additions)
  if (errors.size > 0) setCompositionErrors(errors)
}

/** True for the HasParent/HasChildren/HasComponent/InheritedBy/ComponentOf
 * family, i.e. relationships the tree already draws as plain hierarchy. */
export function isHierarchicalRelationship(relationshipType: string | undefined): boolean {
  const bucket = bucketOf(relationshipType)
  return bucket === 'parent' || bucket === 'child'
}

// Retain the full related response: the tree merges outgoing hierarchy edges
// with parentId children and groups the remaining graph edges at render time.
export async function resolveRelationshipGroups(client: I3XClient, loaded: ObjectInstance[], force = false): Promise<void> {
  if (loaded.length === 0) return
  const { relatedObjects, hierarchyComponents, relationshipErrors, mergeRelatedObjects, mergeHierarchyComponents, setRelationshipErrors } = useExplorerStore.getState()
  // A failed lookup is retried by expanding the row or a forced refresh, not by every scroll.
  const toResolve = loaded.filter(o => force ||
    ((!relatedObjects.has(o.elementId) || !hierarchyComponents.has(o.elementId)) && !relationshipErrors.has(o.elementId)))
  if (toResolve.length === 0) return

  const additions = new Map<string, ObjectInstance[]>()
  const components = new Map<string, string[]>()
  const errors = new Map<string, string | null>()
  const collect = (parentId: string, objects: ObjectInstance[]) => {
    additions.set(parentId, objects)
    errors.set(parentId, null)
    components.set(parentId, [...new Set(objects
      .filter(o => o.elementId !== parentId && o.sourceRelationship === 'HasComponent')
      .map(o => o.elementId))].sort())
  }

  try {
    const { related, failures } = await client.getRelatedObjectsBatch(toResolve.map(o => o.elementId))
    for (const failure of failures) errors.set(failure.elementId, failure.message)
    for (const obj of toResolve) {
      const objects = related.get(obj.elementId)
      if (objects) collect(obj.elementId, objects)
    }
  } catch (err) {
    console.error('Failed to resolve relationship groups via /objects/related:', err)
    const message = err instanceof Error ? err.message : String(err)
    for (const obj of toResolve) if (!additions.has(obj.elementId)) errors.set(obj.elementId, message)
  }
  if (additions.size > 0) mergeRelatedObjects(additions)
  if (components.size > 0) mergeHierarchyComponents(components)
  if (errors.size > 0) setRelationshipErrors(errors)
}

/**
 * Group one object's resolved non-hierarchical related objects by relationship
 * type ("Monitors", "InheritsFrom", …; untyped edges fall back to "Related"),
 * groups sorted alphabetically, objects within a group by display label.
 */
export function groupRelatedObjects(objects: ObjectInstance[]): Map<string, ObjectInstance[]> {
  const byType = new Map<string, ObjectInstance[]>()
  for (const obj of objects) {
    const relType = obj.sourceRelationship || 'Related'
    const list = byType.get(relType)
    if (list) list.push(obj)
    else byType.set(relType, [obj])
  }
  const result = new Map<string, ObjectInstance[]>()
  for (const relType of [...byType.keys()].sort((a, b) => a.localeCompare(b))) {
    result.set(relType, [...byType.get(relType)!].sort((a, b) => getObjectLabel(a).localeCompare(getObjectLabel(b))))
  }
  return result
}

export function getGraphRelatedObjects(parentId: string, objects: ObjectInstance[], componentIds: ReadonlySet<string>): ObjectInstance[] {
  return objects.filter(target =>
    target.elementId !== parentId &&
    !isHierarchicalRelationship(target.sourceRelationship) &&
    !(!target.sourceRelationship && componentIds.has(target.elementId))
  )
}

// Coalesce + throttle full "all objects" refetches. On large catalogs a full
// refetch is expensive, so concurrent callers share one in-flight request and
// Past this many sources missing from the store, one full catalog fetch beats
// paging them through /objects/list a chunk at a time.
const SOURCE_LOOKUP_CATALOG_THRESHOLD = 2000

const byLabel = (a: ObjectInstance, b: ObjectInstance) => getObjectLabel(a).localeCompare(getObjectLabel(b))

// /objects/related-by-type names each source by elementId only; resolve the
// objects from the store, then the server. A source the server can't return
// still gets a minimal row, so no relationship is silently dropped.
async function resolveSourceObjects(client: I3XClient, ids: string[]): Promise<Map<string, ObjectInstance>> {
  const missingFrom = (index: Map<string, ObjectInstance>) => ids.filter(id => !index.has(id))
  if (missingFrom(useExplorerStore.getState().objectIndex).length > SOURCE_LOOKUP_CATALOG_THRESHOLD) {
    await refreshAllObjects(client).catch(err => console.error('Failed to load all objects:', err))
  }
  const { objectIndex } = useExplorerStore.getState()
  const resolved = new Map<string, ObjectInstance>()
  for (const id of ids) {
    const obj = objectIndex.get(id)
    if (obj) resolved.set(id, obj)
  }
  const missing = missingFrom(objectIndex)
  if (missing.length > 0) {
    try {
      for (const obj of await client.getObjectsByIds(missing)) resolved.set(obj.elementId, obj)
    } catch (err) {
      console.error('Failed to resolve relationship sources via /objects/list:', err)
    }
  }
  for (const id of missing) {
    if (!resolved.has(id)) {
      resolved.set(id, { elementId: id, displayName: id, typeId: '', parentId: null, isComposition: false, namespaceUri: '' })
    }
  }
  return resolved
}

/** Fetch a relationship type's instances (always fresh) into the store. */
export async function loadRelationshipInstances(client: I3XClient, relationshipType: RelationshipType): Promise<void> {
  const { setRelationshipInstances } = useExplorerStore.getState()
  try {
    const { entries, failures } = await client.getRelatedObjectsByType(relationshipType.elementId)
    const sources = await resolveSourceObjects(client, entries.map(e => e.sourceId))
    const instances: RelationshipInstance[] = entries.map(e => ({
      source: sources.get(e.sourceId)!,
      targets: [...e.related].sort(byLabel),
    }))
    instances.sort((a, b) => b.targets.length - a.targets.length || byLabel(a.source, b.source))
    setRelationshipInstances(relationshipType.elementId, failures.length > 0 ? { instances, failures } : { instances })
  } catch (err) {
    console.error('Failed to load objects for relationship type:', err)
    setRelationshipInstances(relationshipType.elementId, {
      instances: [],
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Chevron predicate: consult the compositionCache, which holds the actual child
// count resolved via batched /objects/related. If we haven't resolved this
// object yet, fall back to its isComposition flag (chevron may show momentarily
// until the resolver lands).
export function hasCompositionChildren(obj: ObjectInstance, cache: Map<string, number>): boolean {
  if (!obj.isComposition) return false
  const cached = cache.get(obj.elementId)
  return cached === undefined ? true : cached > 0
}

// Get display label for an object, handling special cases like root "/"
export function getObjectLabel(obj: ObjectInstance): string {
  if (obj.displayName && obj.displayName.trim()) {
    return obj.displayName
  }
  // Fallback to elementId for objects with empty displayName (e.g., root "/")
  return obj.elementId
}

// Per the i3X Implementation Guide: schema.type is the sole authoritative leaf
// signal. A scalar type (number/integer/string/boolean) is a leaf "variable";
// everything else is a branch object. schema.type may be a union array
// (e.g. ["number","null"]): treat as leaf if any member is scalar. Shared by
// the tree row icons and the search modal so the two can never disagree.
const SCALAR_TYPES = new Set(['number', 'integer', 'string', 'boolean'])
export function isScalarSchemaType(raw: unknown): boolean {
  const schemaType = Array.isArray(raw)
    ? (raw as string[]).find(t => SCALAR_TYPES.has(t)) ?? ''
    : String(raw ?? '')
  return SCALAR_TYPES.has(schemaType)
}

// ── Flattened tree rows ─────────────────────────────────────────────────────
// The ENTIRE sidebar tree (Namespaces, Objects, Hierarchy) is flattened into
// one ordered array of uniform-height rows and windowed by a single
// virtualizer in TreeView. Nothing renders recursively: a hierarchy node with
// 20k children costs the same DOM as one with 2. Rows carry a parentIndex so
// the sticky ancestor header can walk up from any visible row in O(depth).

export interface NodeRow {
  kind: 'node'
  key: string
  /** Expansion/selection id: 'folder:…', 'ns:…', 'type:…', 'reltype:…', 'obj:…', 'hier:…', 'relobj:…', 'relgroup:…'. */
  id: string
  nodeType: 'folder' | 'namespace' | 'objectType' | 'object' | 'relationshipType' | 'relationshipGroup'
  label: string
  data?: Namespace | ObjectType | ObjectInstance | RelationshipType
  depth: number
  hasChildren: boolean
  isExpanded: boolean
  count?: number
  /** True when the count reflects filter matches rather than totals. */
  filtered?: boolean
  /** This occurrence is reached through its parent's HasComponent edge. */
  isComponent?: boolean
  /** Index of the parent row within the flattened array; -1 at the root. */
  parentIndex: number
  /**
   * Only set for nodeType 'relationshipGroup': the server relationship type
   * this row groups ("Monitors", "Related", …) and the elementId it hangs off.
   * A synthetic row with no `data`, purely a grouping header under an object.
   */
  relationshipType?: string
  relationshipParentId?: string
}

export interface MarkerRow {
  kind: 'marker'
  key: string
  depth: number
  message: string
  parentIndex: number
}

/**
 * "Show N more" row, emitted when a parent's child list is paged. The paging
 * exists for the reader, not the renderer: virtualization makes 20k rows cheap
 * to draw, but they still bury the parent's siblings under a scroll marathon.
 */
export interface MoreRow {
  kind: 'more'
  key: string
  depth: number
  /** Node id whose child list is truncated (the childPageLimits key). */
  parentId: string
  shown: number
  hidden: number
  parentIndex: number
}

export type TreeRow = NodeRow | MarkerRow | MoreRow

// Shared by every top-level walk; walks only read it and copy before adding.
const NO_ANCESTORS: ReadonlySet<string> = new Set()

export interface TreeBuildInput {
  hierarchyComponents: Map<string, string[]>
  namespaces: Namespace[]
  objectTypes: ObjectType[]
  relationshipTypes: RelationshipType[]
  /** Objects fetched per object type, keyed by typeId (loaded on type expand). */
  objectsByType: Map<string, ObjectInstance[]>
  allObjects: ObjectInstance[]
  hierarchicalRoots: ObjectInstance[]
  /** Compositional children fetched via /objects/related, keyed by parent. */
  childObjects: Map<string, ObjectInstance[]>
  /** parentId index over allObjects (store-maintained). */
  childrenByParent: Map<string, ObjectInstance[]>
  compositionCache: Map<string, number>
  expandedNodes: Set<string>
  childPageLimits: Map<string, number>
  /** Lowercased filter text; '' disables filtering. */
  filterText: string
  /** Current selection (store id). Rows on its path are exempt from paging. */
  selectedId: string | null
  /** elementId index over allObjects (store-maintained), for ancestor walks. */
  objectIndex: Map<string, ObjectInstance>
  /** elementId → pre-lowercased filter blob (store-maintained). */
  searchIndex: Map<string, string>
  /** typeId → instance count over allObjects (store-maintained). */
  objectCountByType: Map<string, number>
  /** typeId → its instances in allObjects (store-maintained); preferred over objectsByType once loaded. */
  catalogObjectsByType: Map<string, ObjectInstance[]>
  /**
   * Whether the Hierarchy folder also draws non-hierarchical relationships,
   * grouped by relationship type, under each object alongside its plain
   * children. Off by default; a user toggle above the tree.
   */
  showRelationshipsInTree: boolean
  /** Whether to include HasComponent edges in the hierarchy. On by default. */
  showComponentsInTree: boolean
  /** elementId → all resolved related objects (store-maintained,
   * lazily filled for visible rows). Absent = not yet resolved. */
  relatedObjects: Map<string, ObjectInstance[]>
  /** relationship type elementId → its loaded instances (on reltype expand). */
  relationshipInstances: Map<string, RelationshipTypeInstances>
  /** elementId → why its HasComponent children lookup failed (store-maintained); read by obj: rows. */
  compositionErrors?: Map<string, string>
  /** elementId → why its all-relationships lookup failed (store-maintained); read by hier: rows. */
  relationshipErrors?: Map<string, string>
}

export function getHierarchyChildren(
  parentId: string,
  input: Pick<TreeBuildInput, 'childrenByParent' | 'relatedObjects' | 'hierarchyComponents' | 'objectIndex' | 'showComponentsInTree'>
): { children: ObjectInstance[]; componentIds: Set<string> } {
  const related = input.relatedObjects.get(parentId) ?? []
  const componentIds = new Set(input.hierarchyComponents.get(parentId))
  for (const target of related) {
    if (target.sourceRelationship === 'HasComponent') componentIds.add(target.elementId)
  }
  const byId = new Map((input.childrenByParent.get(parentId) ?? []).map(child => [child.elementId, child]))
  for (const target of related) {
    const outgoing = bucketOf(target.sourceRelationship) === 'child' ||
      (!target.sourceRelationship && componentIds.has(target.elementId))
    if (target.elementId !== parentId && outgoing && !byId.has(target.elementId)) {
      byId.set(target.elementId, input.objectIndex.get(target.elementId) ?? target)
    }
  }
  const children = [...byId.values()].filter(child => input.showComponentsInTree ||
    !(componentIds.has(child.elementId) || child.sourceRelationship === 'HasComponent'))
  return { children, componentIds }
}

/**
 * Produce the ordered, visible rows of the whole sidebar tree: expansion,
 * filtering (with ancestor keep-alive), per-parent paging, and cycle/depth
 * guards all resolve here, in one pure pass over store data. TreeView memoizes
 * the result and only windows it.
 */
export function buildTreeRows(input: TreeBuildInput): TreeRow[] {
  const {
    namespaces, objectTypes, relationshipTypes, objectsByType, allObjects, hierarchicalRoots,
    childObjects, compositionCache, expandedNodes,
    childPageLimits, filterText, selectedId, objectIndex, searchIndex, objectCountByType, catalogObjectsByType,
    showRelationshipsInTree, relatedObjects, relationshipInstances,
    compositionErrors = new Map<string, string>(), relationshipErrors = new Map<string, string>(),
  } = input

  const rows: TreeRow[] = []
  const isExpanded = (id: string) => expandedNodes.has(id)
  const typeLabels = new Map(objectTypes.map(type => [type.elementId, type.displayName || type.elementId]))

  // Prebuilt blob when the object came through allObjects (the common case);
  // inline lowercasing only for objects fetched via other endpoints.
  const objMatches = (obj: ObjectInstance) => {
    const blob = searchIndex.get(obj.elementId)
    if (blob !== undefined) return blob.includes(filterText)
    return (
      obj.displayName.toLowerCase().includes(filterText) ||
      obj.elementId.toLowerCase().includes(filterText) ||
      obj.namespaceUri.toLowerCase().includes(filterText)
    )
  }

  const hierarchyChildrenOf = (parentId: string) => getHierarchyChildren(parentId, input)

  // Filter support sets. To make deep matches surface their ancestors:
  //   matchingTypeIds: type IDs with ≥1 matching object (keeps the type and its
  //     parent namespace visible even when their own names don't match)
  //   hierarchyVisibleIds: every match plus every ancestor up the parentId chain
  //   matchedNamespaceUris: namespace URIs reached transitively via matching
  //     types/objects
  const matchingTypeIds = new Set<string>()
  const hierarchyVisibleIds = new Set<string>()
  const matchedNamespaceUris = new Set<string>()
  let matchTotal = 0
  if (filterText) {
    const relatedParents = new Map<string, Set<string>>()
    const relatedIndex = new Map<string, ObjectInstance>()
    for (const parentId of relatedObjects.keys()) {
      for (const child of hierarchyChildrenOf(parentId).children) {
        const parents = relatedParents.get(child.elementId) ?? new Set<string>()
        parents.add(parentId)
        relatedParents.set(child.elementId, parents)
        relatedIndex.set(child.elementId, child)
      }
    }
    const pending: string[] = []
    for (const obj of allObjects) {
      if (!objMatches(obj)) continue
      matchTotal++
      matchingTypeIds.add(obj.typeId)
      pending.push(obj.elementId)
    }
    for (const obj of relatedIndex.values()) {
      if (objMatches(obj)) pending.push(obj.elementId)
    }
    while (pending.length > 0) {
      const id = pending.pop()!
      if (hierarchyVisibleIds.has(id)) continue
      hierarchyVisibleIds.add(id)
      const object = objectIndex.get(id) ?? relatedIndex.get(id)
      if (object?.parentId) pending.push(object.parentId)
      for (const parentId of relatedParents.get(id) ?? []) pending.push(parentId)
    }
    for (const type of objectTypes) {
      const typeMatches =
        type.displayName.toLowerCase().includes(filterText) ||
        type.elementId.toLowerCase().includes(filterText) ||
        matchingTypeIds.has(type.elementId)
      if (typeMatches) matchedNamespaceUris.add(type.namespaceUri)
    }
    for (const relationship of relationshipTypes) {
      const relationshipMatches =
        relationship.displayName.toLowerCase().includes(filterText) ||
        relationship.elementId.toLowerCase().includes(filterText) ||
        relationship.reverseOf.toLowerCase().includes(filterText)
      if (relationshipMatches) matchedNamespaceUris.add(relationship.namespaceUri)
    }
  }

  // Per-parent paging. Trivial overflows are not truncated (a "Show 12 more"
  // row costs more attention than the 12 rows it hides).
  const pageLimit = (parentId: string, total: number) => {
    const limit = childPageLimits.get(parentId) ?? CHILD_PAGE_SIZE
    return total <= limit + CHILD_PAGE_SLACK ? total : Math.min(limit, total)
  }

  // Rows on the path to the current selection are exempt from paging: reveal
  // (a search jump, Back/Forward) must always find the selected row, even at
  // position 1,200 of a paged child list. The exempt entry is emitted after
  // the "Show more" row, out of sequence, but present and scrollable-to.
  const mustShowIds = new Set<string>()
  // Object rows on the path as raw elementIds, so scanning a paged-out tail of 100k+ rows allocates no ids.
  const pathObjIds = new Set<string>()
  const pathHierIds = new Set<string>()
  if (selectedId) {
    mustShowIds.add(selectedId)
    const prefix = selectedId.startsWith('hier:') ? 'hier:'
      : selectedId.startsWith('obj:') ? 'obj:' : null
    if (prefix) {
      const pathIds = prefix === 'hier:' ? pathHierIds : pathObjIds
      pathIds.add(selectedId.slice(prefix.length))
      // Every ancestor up the parentId chain, so a deep selection can't have
      // an ancestor paged out from under it either.
      const visited = new Set<string>()
      let current = objectIndex.get(selectedId.slice(prefix.length))
      while (current?.parentId && current.parentId !== '/' && !visited.has(current.elementId)) {
        visited.add(current.elementId)
        const parent = objectIndex.get(current.parentId)
        if (!parent) break
        mustShowIds.add(`${prefix}${parent.elementId}`)
        pathIds.add(parent.elementId)
        current = parent
      }
    } else if (selectedId.startsWith('type:')) {
      const type = objectTypes.find(t => `type:${t.elementId}` === selectedId)
      if (type) mustShowIds.add(`ns:${type.namespaceUri}`)
    } else {
      const relationshipTypeId = selectedId.startsWith('reltype:')
        ? selectedId.slice('reltype:'.length)
        : parseRelationshipSourceRowId(selectedId)?.relationshipTypeId
      const relationship = relationshipTypes.find(r => r.elementId === relationshipTypeId)
      if (relationship) {
        mustShowIds.add(`ns:${relationship.namespaceUri}`)
        mustShowIds.add(`reltype:${relationship.elementId}`)
      }
    }
  }

  // Emit the paged-out entries of a truncated list that are on the selection
  // path. Scans only the hidden tail, and only while something is selected.
  const emitForced = <T,>(list: T[], limit: number, idOf: (item: T) => string, emit: (item: T) => void) => {
    if (limit >= list.length || mustShowIds.size === 0) return
    for (let i = limit; i < list.length; i++) {
      if (mustShowIds.has(idOf(list[i]))) emit(list[i])
    }
  }
  const emitForcedObjects = (list: ObjectInstance[], limit: number, pathIds: ReadonlySet<string>, emit: (item: ObjectInstance) => void) => {
    if (limit >= list.length || pathIds.size === 0) return
    for (let i = limit; i < list.length; i++) {
      if (pathIds.has(list[i].elementId)) emit(list[i])
    }
  }
  const pushMore = (parentId: string, parentKey: string, depth: number, shown: number, total: number, parentIndex: number) => {
    rows.push({
      kind: 'more', key: `${parentKey}#more`, depth, parentId,
      shown, hidden: total - shown, parentIndex,
    })
  }
  const pushMarker = (key: string, depth: number, message: string, parentIndex: number) => {
    rows.push({ kind: 'marker', key, depth, message, parentIndex })
  }

  // ── Composition walk ('obj:' ids): objects under a type node and the flat
  // Objects folder, expanding through fetched compositional children.
  const walkObj = (obj: ObjectInstance, depth: number, ancestors: ReadonlySet<string>, path: string, parentIndex: number) => {
    const key = `${path}/${obj.elementId}`
    if (depth > MAX_TREE_DEPTH || ancestors.has(obj.elementId)) {
      pushMarker(`${key}#stop`, depth, ancestors.has(obj.elementId) ? '(cycle detected)' : '(max depth reached)', parentIndex)
      return
    }
    const id = `obj:${obj.elementId}`
    const children = childObjects.get(obj.elementId) ?? []
    const cachedCount = compositionCache.get(obj.elementId)
    const childCount = children.length > 0 ? children.length : cachedCount
    const expanded = isExpanded(id)
    const index = rows.length
    // Only composition objects fetch children, so only they can carry (and clear) a composition error.
    const childrenError = obj.isComposition ? compositionErrors.get(obj.elementId) : undefined
    rows.push({
      kind: 'node', key, id, nodeType: 'object', label: getObjectLabel(obj),
      data: obj, depth, hasChildren: hasCompositionChildren(obj, compositionCache) || childrenError !== undefined,
      isExpanded: expanded,
      count: childCount && childCount > 0 ? childCount : undefined,
      parentIndex,
    })
    if (expanded && childrenError !== undefined) {
      pushMarker(`${key}#error`, depth + 1, `(failed to load children: ${childrenError})`, index)
    }
    if (!expanded || children.length === 0) return
    const visible = filterText ? children.filter(objMatches) : children
    const limit = pageLimit(id, visible.length)
    const childAncestors = new Set(ancestors)
    childAncestors.add(obj.elementId)
    for (let i = 0; i < limit; i++) walkObj(visible[i], depth + 1, childAncestors, key, index)
    if (limit < visible.length) pushMore(id, key, depth + 1, limit, visible.length, index)
    emitForcedObjects(visible, limit, pathObjIds, c => walkObj(c, depth + 1, childAncestors, key, index))
  }

  // ── Hierarchy walk ('hier:' ids): merge parentId children with resolved
  // outgoing hierarchy edges, deduplicating by elementId. When showRelationshipsInTree
  // is on (and no filter is active), each object also draws its resolved
  // non-hierarchical relationships as extra "relationshipGroup" rows below its
  // plain children, one per relationship type, expanding to the related
  // objects (which recurse through this same walk, so a related element can
  // itself be expanded into its own children and relationship groups).
  const showRelated = showRelationshipsInTree && !filterText
  const walkHier = (obj: ObjectInstance, depth: number, ancestors: ReadonlySet<string>, path: string, parentIndex: number, isComponent = false) => {
    const key = `${path}/${obj.elementId}`
    if (depth > MAX_TREE_DEPTH || ancestors.has(obj.elementId)) {
      pushMarker(`${key}#stop`, depth, ancestors.has(obj.elementId) ? '(cycle detected)' : '(max depth reached)', parentIndex)
      return
    }
    const id = `hier:${obj.elementId}`
    const { children, componentIds } = hierarchyChildrenOf(obj.elementId)
    const isComponentChild = (child: ObjectInstance) =>
      componentIds.has(child.elementId) || child.sourceRelationship === 'HasComponent'
    const related = showRelated
      ? getGraphRelatedObjects(obj.elementId, relatedObjects.get(obj.elementId) ?? [], componentIds)
      : undefined
    const relGroups = related && related.length > 0 ? groupRelatedObjects(related) : null
    const relatedError = relationshipErrors.get(obj.elementId)
    const expanded = isExpanded(id)
    const index = rows.length
    rows.push({
      kind: 'node', key, id, nodeType: 'object', label: getObjectLabel(obj),
      data: obj, depth, hasChildren: children.length > 0 || !!relGroups || relatedError !== undefined, isExpanded: expanded,
      count: children.length > 0 ? children.length : undefined,
      parentIndex, isComponent,
    })
    if (!expanded) return
    if (relatedError !== undefined) {
      pushMarker(`${key}#error`, depth + 1, `(failed to load relationships: ${relatedError})`, index)
    }
    const childAncestors = new Set(ancestors)
    childAncestors.add(obj.elementId)
    if (children.length > 0) {
      const matching = filterText ? children.filter(c => hierarchyVisibleIds.has(c.elementId)) : children
      const ordinary = matching.filter(child => !isComponentChild(child))
      const components = matching.filter(isComponentChild).sort((a, b) =>
        (typeLabels.get(a.typeId) ?? a.typeId).localeCompare(typeLabels.get(b.typeId) ?? b.typeId) ||
        a.typeId.localeCompare(b.typeId) || byLabel(a, b) || a.elementId.localeCompare(b.elementId)
      )
      const visible = [...ordinary, ...components]
      const limit = pageLimit(id, visible.length)
      const emitChild = (child: ObjectInstance) =>
        walkHier(child, depth + 1, childAncestors, key, index, isComponentChild(child))
      for (let i = 0; i < limit; i++) emitChild(visible[i])
      if (limit < visible.length) pushMore(id, key, depth + 1, limit, visible.length, index)
      emitForcedObjects(visible, limit, pathHierIds, emitChild)
    }
    if (relGroups) {
      for (const [relType, relatedObjs] of relGroups) {
        const relGroupId = `relgroup:${obj.elementId}:${relType}`
        const relKey = `${key}#rel#${relType}`
        const relExpanded = isExpanded(relGroupId)
        const relIndex = rows.length
        rows.push({
          kind: 'node', key: relKey, id: relGroupId, nodeType: 'relationshipGroup',
          label: relType, depth: depth + 1, hasChildren: true, isExpanded: relExpanded,
          count: relatedObjs.length, parentIndex: index,
          relationshipType: relType, relationshipParentId: obj.elementId,
        })
        if (!relExpanded) continue
        const relLimit = pageLimit(relGroupId, relatedObjs.length)
        for (let i = 0; i < relLimit; i++) walkHier(relatedObjs[i], depth + 2, childAncestors, relKey, relIndex)
        if (relLimit < relatedObjs.length) pushMore(relGroupId, relKey, depth + 2, relLimit, relatedObjs.length, relIndex)
      }
    }
  }

  // ── 1. Namespaces folder ──────────────────────────────────────────────────
  // Computed before the folder row so a filtered count can sit on it even
  // while the folder is collapsed.
  const visibleNamespaces = namespaces.filter(ns => {
    if (!filterText) return true
    if (
      ns.displayName.toLowerCase().includes(filterText) ||
      ns.uri.toLowerCase().includes(filterText)
    ) return true
    return matchedNamespaceUris.has(ns.uri)
  })
  const namespacesExpanded = isExpanded(NAMESPACES_FOLDER_ID)
  const namespacesIndex = rows.length
  rows.push({
    kind: 'node', key: NAMESPACES_FOLDER_ID, id: NAMESPACES_FOLDER_ID,
    nodeType: 'folder', label: 'Namespaces', depth: 0,
    hasChildren: namespaces.length > 0, isExpanded: namespacesExpanded,
    count: filterText ? visibleNamespaces.length : namespaces.length > 0 ? namespaces.length : undefined,
    filtered: filterText ? true : undefined,
    parentIndex: -1,
  })
  if (namespacesExpanded) {
    // Group object types by namespace; keep types whose name matches OR whose
    // descendant objects match.
    const typesByNamespace = new Map<string, ObjectType[]>()
    for (const type of objectTypes) {
      const keep =
        !filterText ||
        type.displayName.toLowerCase().includes(filterText) ||
        type.elementId.toLowerCase().includes(filterText) ||
        matchingTypeIds.has(type.elementId)
      if (!keep) continue
      const types = typesByNamespace.get(type.namespaceUri)
      if (types) types.push(type)
      else typesByNamespace.set(type.namespaceUri, [type])
    }

    const relationshipTypesByNamespace = new Map<string, RelationshipType[]>()
    const relationshipTypeById = new Map<string, RelationshipType>()
    for (const relationship of relationshipTypes) {
      relationshipTypeById.set(relationship.elementId, relationship)
      if (relationship.relationshipId) relationshipTypeById.set(relationship.relationshipId, relationship)
      const keep =
        !filterText ||
        relationship.displayName.toLowerCase().includes(filterText) ||
        relationship.elementId.toLowerCase().includes(filterText) ||
        relationship.reverseOf.toLowerCase().includes(filterText)
      if (!keep) continue
      const types = relationshipTypesByNamespace.get(relationship.namespaceUri)
      if (types) types.push(relationship)
      else relationshipTypesByNamespace.set(relationship.namespaceUri, [relationship])
    }

    const emitType = (type: ObjectType, nsIndex: number) => {
      const typeId = `type:${type.elementId}`
      const typeExpanded = isExpanded(typeId)
      const instanceCount = objectCountByType.get(type.elementId)
      const typeIndex = rows.length
      rows.push({
        kind: 'node', key: typeId, id: typeId, nodeType: 'objectType',
        label: type.displayName, data: type, depth: 2,
        hasChildren: true, isExpanded: typeExpanded,
        count: instanceCount && instanceCount > 0 ? instanceCount : undefined,
        parentIndex: nsIndex,
      })
      if (!typeExpanded) return

      const typeObjects = allObjects.length > 0
        ? catalogObjectsByType.get(type.elementId) ?? []
        : objectsByType.get(type.elementId) ?? []
      const visibleObjects = filterText ? typeObjects.filter(objMatches) : typeObjects
      const objLimit = pageLimit(typeId, visibleObjects.length)
      for (let o = 0; o < objLimit; o++) {
        walkObj(visibleObjects[o], 3, NO_ANCESTORS, typeId, typeIndex)
      }
      if (objLimit < visibleObjects.length) {
        pushMore(typeId, typeId, 3, objLimit, visibleObjects.length, typeIndex)
      }
      emitForcedObjects(visibleObjects, objLimit, pathObjIds,
        o => walkObj(o, 3, NO_ANCESTORS, typeId, typeIndex))
    }

    const emitRelationshipSource = (relationship: RelationshipType, instance: RelationshipInstance, parentIndex: number) => {
      const { source } = instance
      const id = relationshipSourceRowId(relationship.elementId, source.elementId)
      const expanded = isExpanded(id)
      const index = rows.length
      rows.push({
        kind: 'node', key: id, id, nodeType: 'object', label: getObjectLabel(source),
        data: source, depth: 3, hasChildren: instance.targets.length > 0, isExpanded: expanded,
        count: instance.targets.length > 0 ? instance.targets.length : undefined,
        parentIndex,
      })
      if (!expanded) return
      // A matching source keeps all its targets; otherwise only matching targets show.
      const targets = filterText && !objMatches(source) ? instance.targets.filter(objMatches) : instance.targets
      const limit = pageLimit(id, targets.length)
      const ancestors = new Set([source.elementId])
      for (let i = 0; i < limit; i++) walkObj(targets[i], 4, ancestors, id, index)
      if (limit < targets.length) pushMore(id, id, 4, limit, targets.length, index)
      emitForcedObjects(targets, limit, pathObjIds, t => walkObj(t, 4, ancestors, id, index))
    }

    const emitRelationshipType = (relationship: RelationshipType, nsIndex: number) => {
      const relationshipTypeId = `reltype:${relationship.elementId}`
      const inverse = relationshipTypeById.get(relationship.reverseOf)
      const inverseLabel = inverse?.displayName ?? relationship.reverseOf
      const loaded = relationshipInstances.get(relationship.elementId)
      const expanded = isExpanded(relationshipTypeId)
      const relIndex = rows.length
      rows.push({
        kind: 'node', key: relationshipTypeId, id: relationshipTypeId, nodeType: 'relationshipType',
        label: inverseLabel ? `${relationship.displayName} → ${inverseLabel}` : relationship.displayName,
        data: relationship, depth: 2, hasChildren: true, isExpanded: expanded,
        count: loaded && loaded.instances.length > 0 ? loaded.instances.length : undefined,
        parentIndex: nsIndex,
      })
      // Not loaded yet: the expand's fetch is in flight.
      if (!expanded || !loaded) return
      if (loaded.error) {
        pushMarker(`${relationshipTypeId}#error`, 3, `(failed to load: ${loaded.error})`, relIndex)
        return
      }
      if (loaded.failures && loaded.failures.length > 0) {
        const [first] = loaded.failures
        const more = loaded.failures.length > 1 ? ` (+${loaded.failures.length - 1} more)` : ''
        pushMarker(`${relationshipTypeId}#failures`, 3, `(failed to load ${first.elementId}: ${first.message}${more})`, relIndex)
      }
      const visible = filterText
        ? loaded.instances.filter(i => objMatches(i.source) || i.targets.some(objMatches))
        : loaded.instances
      if (visible.length === 0) {
        pushMarker(`${relationshipTypeId}#empty`, 3, filterText ? 'No matching objects' : 'No objects', relIndex)
        return
      }
      const limit = pageLimit(relationshipTypeId, visible.length)
      for (let i = 0; i < limit; i++) emitRelationshipSource(relationship, visible[i], relIndex)
      if (limit < visible.length) pushMore(relationshipTypeId, relationshipTypeId, 3, limit, visible.length, relIndex)
      emitForced(visible, limit, i => relationshipSourceRowId(relationship.elementId, i.source.elementId),
        i => emitRelationshipSource(relationship, i, relIndex))
    }

    const emitNamespace = (namespace: Namespace) => {
      const nsId = `ns:${namespace.uri}`
      const nsTypes = typesByNamespace.get(namespace.uri) ?? []
      const nsRelationshipTypes = relationshipTypesByNamespace.get(namespace.uri) ?? []
      const nsChildren = [
        ...nsTypes.map(type => ({ kind: 'objectType' as const, value: type })),
        ...nsRelationshipTypes.map(type => ({ kind: 'relationshipType' as const, value: type })),
      ]
      const nsExpanded = isExpanded(nsId)
      const nsIndex = rows.length
      rows.push({
        kind: 'node', key: nsId, id: nsId, nodeType: 'namespace',
        label: namespace.displayName, data: namespace, depth: 1,
        hasChildren: nsChildren.length > 0, isExpanded: nsExpanded,
        count: nsChildren.length > 0 ? nsChildren.length : undefined,
        parentIndex: namespacesIndex,
      })
      if (!nsExpanded) return

      const childLimit = pageLimit(nsId, nsChildren.length)
      const emitNamespaceChild = (child: typeof nsChildren[number]) => {
        if (child.kind === 'objectType') emitType(child.value, nsIndex)
        else emitRelationshipType(child.value, nsIndex)
      }
      for (let c = 0; c < childLimit; c++) emitNamespaceChild(nsChildren[c])
      if (childLimit < nsChildren.length) pushMore(nsId, nsId, 2, childLimit, nsChildren.length, nsIndex)
      emitForced(
        nsChildren,
        childLimit,
        child => child.kind === 'objectType' ? `type:${child.value.elementId}` : `reltype:${child.value.elementId}`,
        emitNamespaceChild
      )
    }

    const nsLimit = pageLimit(NAMESPACES_FOLDER_ID, visibleNamespaces.length)
    for (let n = 0; n < nsLimit; n++) emitNamespace(visibleNamespaces[n])
    if (nsLimit < visibleNamespaces.length) {
      pushMore(NAMESPACES_FOLDER_ID, NAMESPACES_FOLDER_ID, 1, nsLimit, visibleNamespaces.length, namespacesIndex)
    }
    emitForced(visibleNamespaces, nsLimit, ns => `ns:${ns.uri}`, emitNamespace)
  }

  // ── 2. Objects folder (flat list) ─────────────────────────────────────────
  // Deliberately unpaged at the top level: browsing the entire catalog is the
  // folder's purpose, and the virtualizer makes its size irrelevant to the DOM.
  const objectsExpanded = isExpanded(OBJECTS_FOLDER_ID)
  const objectsIndex = rows.length
  rows.push({
    kind: 'node', key: OBJECTS_FOLDER_ID, id: OBJECTS_FOLDER_ID,
    nodeType: 'folder', label: 'Objects', depth: 0,
    hasChildren: true, isExpanded: objectsExpanded,
    count: filterText ? matchTotal : allObjects.length > 0 ? allObjects.length : undefined,
    filtered: filterText ? true : undefined,
    parentIndex: -1,
  })
  if (objectsExpanded) {
    const visibleRoots = filterText ? allObjects.filter(objMatches) : allObjects
    for (const obj of visibleRoots) walkObj(obj, 1, NO_ANCESTORS, 'all', objectsIndex)
    if (allObjects.length > 0 && visibleRoots.length === 0) {
      pushMarker('all#empty', 1, 'No matching objects', objectsIndex)
    }
  }

  // ── 3. Hierarchy folder (parent/child structure) ──────────────────────────
  const visibleRoots = filterText
    ? hierarchicalRoots.filter(obj => hierarchyVisibleIds.has(obj.elementId))
    : hierarchicalRoots
  const hierExpanded = isExpanded(HIERARCHICAL_FOLDER_ID)
  const hierIndex = rows.length
  rows.push({
    kind: 'node', key: HIERARCHICAL_FOLDER_ID, id: HIERARCHICAL_FOLDER_ID,
    nodeType: 'folder', label: 'Hierarchy', depth: 0,
    hasChildren: true, isExpanded: hierExpanded,
    count: filterText ? visibleRoots.length : hierarchicalRoots.length > 0 ? hierarchicalRoots.length : undefined,
    filtered: filterText ? true : undefined,
    parentIndex: -1,
  })
  if (hierExpanded) {
    const rootLimit = pageLimit(HIERARCHICAL_FOLDER_ID, visibleRoots.length)
    for (let i = 0; i < rootLimit; i++) {
      walkHier(visibleRoots[i], 1, NO_ANCESTORS, 'hier', hierIndex)
    }
    if (rootLimit < visibleRoots.length) {
      pushMore(HIERARCHICAL_FOLDER_ID, 'hier', 1, rootLimit, visibleRoots.length, hierIndex)
    }
    emitForcedObjects(visibleRoots, rootLimit, pathHierIds,
      o => walkHier(o, 1, NO_ANCESTORS, 'hier', hierIndex))
    if (allObjects.length > 0 && visibleRoots.length === 0) {
      pushMarker('hier#empty', 1, filterText ? 'No matching objects' : 'No root objects found', hierIndex)
    }
  }

  return rows
}

// ── Row activation ──────────────────────────────────────────────────────────
// Shared by mouse (TreeNode click) and keyboard (TreeView key handling), so
// both paths select, expand, and fetch identically.

/**
 * Fetch whatever a just-expanded row needs from the server. Fire-and-forget
 * from the caller's perspective; results land in the store and re-render.
 * Rows whose child list only exists after the fetch are flagged loading
 * meanwhile, so the tree can show a spinner in place of their icon.
 */
export async function loadChildrenFor(row: NodeRow): Promise<void> {
  const client = getClient()
  if (!client) return
  const { id, nodeType, data } = row
  const lazy =
    nodeType === 'objectType' ||
    nodeType === 'relationshipType' ||
    id === OBJECTS_FOLDER_ID ||
    id === HIERARCHICAL_FOLDER_ID ||
    (id.startsWith('obj:') && !!(data as ObjectInstance | undefined)?.isComposition) ||
    (id.startsWith('hier:') && useExplorerStore.getState().relationshipErrors.has((data as ObjectInstance).elementId))
  if (!lazy) return fetchChildrenFor(client, row)
  const { setNodeLoading } = useExplorerStore.getState()
  setNodeLoading(id, true)
  try {
    await fetchChildrenFor(client, row)
  } finally {
    setNodeLoading(id, false)
  }
}

async function fetchChildrenFor(client: I3XClient, row: NodeRow): Promise<void> {
  const { setObjects, setChildObjects, mergeCompositionFlags, setCompositionErrors } = useExplorerStore.getState()
  const { id, nodeType, data } = row

  // Synthetic grouping row: its related objects are resolved by the tree's
  // lazy visible-window effect (resolveRelationshipGroups), not by expanding it.
  if (nodeType === 'relationshipGroup') return

  if (nodeType === 'relationshipType') {
    await loadRelationshipInstances(client, data as RelationshipType)
    return
  }

  // A relationship's source row lists its targets, which arrived with the type.
  if (id.startsWith('relobj:')) return

  // Re-fetch objects for this type whenever expanding (always fresh)
  if (nodeType === 'objectType') {
    // The loaded catalog already holds the type's instances; a per-type list of 100k+ would parse on the main thread.
    if (useExplorerStore.getState().allObjectsLoaded) {
      try {
        await refreshAllObjects(client)
      } catch (err) {
        console.error('Failed to refresh all objects:', err)
      }
      return
    }
    try {
      const objectType = data as ObjectType
      const objects = await client.getObjects(objectType.elementId)
      await resolveCompositionFlags(client, objects)
      setObjects(objectType.elementId, objects)
    } catch (err) {
      console.error('Failed to load objects:', err)
    }
    return
  }

  // Reuse the shared connection/search/folder load; poll and Refresh now force it.
  if (id === OBJECTS_FOLDER_ID || id === HIERARCHICAL_FOLDER_ID) {
    try {
      await ensureAllObjectsLoaded(client)
    } catch (err) {
      console.error('Failed to load all objects:', err)
    }
    // For the Hierarchy folder, also fetch root objects via root=true so the
    // server determines what counts as a root (avoids relying on
    // parentId === '/' locally).
    if (id === HIERARCHICAL_FOLDER_ID) {
      try {
        await loadHierarchicalRoots(client)
      } catch (err) {
        console.error('Failed to load root objects:', err)
      }
    }
    return
  }

  // Hierarchy children merge the catalog index with the visible-window related
  // cache; both are refreshed by the tree's background poll. A failed lookup is retried now.
  if (id.startsWith('hier:')) {
    const obj = data as ObjectInstance
    if (useExplorerStore.getState().relationshipErrors.has(obj.elementId)) {
      await resolveRelationshipGroups(client, [obj], true)
    }
    return
  }

  // Compositional object: re-fetch child objects (always fresh)
  if (nodeType === 'object') {
    const obj = data as ObjectInstance
    if (!obj.isComposition) return
    try {
      const related = await client.getRelatedObjects(obj.elementId, 'HasComponent')
      const compositionalChildren = related.filter(child =>
        child.isComposition &&
        child.elementId !== obj.elementId &&
        child.parentId === obj.elementId
      )
      await resolveCompositionFlags(client, compositionalChildren)
      setChildObjects(obj.elementId, compositionalChildren)
      // Reflect the real qualifying-child count on the parent so an optimistic
      // chevron self-corrects to "no chevron" when a click reveals nothing.
      mergeCompositionFlags([[obj.elementId, compositionalChildren.length]])
      setCompositionErrors([[obj.elementId, null]])
    } catch (err) {
      console.error('Failed to load child objects:', err)
      setCompositionErrors([[obj.elementId, err instanceof Error ? err.message : String(err)]])
    }
  }
}

/** The full click/Enter behavior for a node row: select, toggle, fetch. */
export function activateRow(row: NodeRow): void {
  const { toggleNode, selectItem } = useExplorerStore.getState()
  // A relationship-type grouping row is not a real element: toggle only.
  if (row.nodeType === 'relationshipGroup') {
    toggleNode(row.id)
    return
  }
  if (row.data && row.nodeType !== 'folder') {
    selectItem({ type: row.nodeType, id: row.id, data: row.data } as SelectedItem)
  }
  if (row.hasChildren) {
    toggleNode(row.id)
    if (!row.isExpanded) void loadChildrenFor(row)
  }
}

/** Expand without selecting (ArrowRight). No-op if already expanded. */
export function expandRow(row: NodeRow): void {
  if (!row.hasChildren || row.isExpanded) return
  useExplorerStore.getState().expandNode(row.id)
  void loadChildrenFor(row)
}
