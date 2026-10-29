import type { Namespace, ObjectType, ObjectInstance } from '../../api/types'
import { topBy } from '../main/modelStats'

/**
 * The diff engine: two catalogs in, one structural answer out, what was
 * added, what was removed, and what moved under a different parent, type,
 * name, or namespace. Pure data-in/data-out, no React, no stores.
 *
 * Identity is `elementId`, full stop. An elementId present in both catalogs is
 * the same object and its fields are compared; only in the baseline = removed;
 * only in the current = added. Nothing here guesses at renames-with-new-ids,
 * the RFC calls elementId the platform's persistent identifier, so the diff
 * takes it at its word.
 *
 * Cost: one Map build plus one iteration per side, strictly linear in the two
 * catalog sizes, nothing O(n·m). The result stores elementIds and changed
 * field pairs only, never object copies: rows resolve display data through
 * the live objectIndex / the baseline's own map at render time, so a diff of
 * two 100k catalogs is small even when half the model changed.
 *
 * Metadata comparison (`metadata` / `schemaExtensions`, via stable stringify)
 * is opt-in (`deepCompare`) and runs only for objects whose scalar fields all
 * matched, an object already flagged as changed doesn't need a second,
 * costlier reason. So the `metadataOnly` category means exactly that: nothing
 * about the object changed *except* its metadata.
 */

export interface CatalogSide {
  objects: ObjectInstance[]
  objectTypes: ObjectType[]
  namespaces: Namespace[]
  /**
   * Prebuilt elementId → object map (the explorer store's `objectIndex` for
   * the live side, a loaded snapshot's index otherwise). Built here if absent.
   * Must be last-wins over `objects`, both callers' maps are.
   */
  objectIndex?: Map<string, ObjectInstance>
  /**
   * Deep-compare key for this side's objects; `metadataKey` when absent. Both
   * sides must produce comparable keys (the live catalog keys objects fetched
   * from the server, since it holds them without metadata).
   */
  metadataKey?: (object: ObjectInstance) => string
}

export interface FieldDelta {
  from: string | null
  to: string | null
}

/**
 * One object that exists on both sides with at least one tracked difference.
 * Only the deltas are stored; a field key is present exactly when it changed.
 */
export interface ObjectChange {
  elementId: string
  parentId?: FieldDelta
  typeId?: FieldDelta
  displayName?: FieldDelta
  namespaceUri?: FieldDelta
  /** True when the only change is metadata/schemaExtensions (deep compare only). */
  metadataOnly?: boolean
}

export interface CatalogDiff {
  /** elementIds present only in the current catalog. Resolve via the current index. */
  added: string[]
  /** elementIds present only in the baseline. Resolve via the baseline index. */
  removed: string[]
  /** Every changed object, in current-catalog iteration order. */
  changed: ObjectChange[]
  /**
   * Category views: references into `changed`, not copies. Counted
   * independently, one object re-parented AND re-typed appears in both lists,
   * and the UI labels the counts that way.
   */
  reparented: ObjectChange[]
  retyped: ObjectChange[]
  renamed: ObjectChange[]
  movedNamespace: ObjectChange[]
  metadataOnly: ObjectChange[]

  typesAdded: string[]
  typesRemoved: string[]
  namespacesAdded: string[]
  namespacesRemoved: string[]

  /**
   * elementId collisions inside one side's own object list (last entry won).
   * Some servers emit these; the diff can't repair them, only say so.
   */
  duplicates: { baseline: number; current: number }
  /** Whether metadata/schemaExtensions were compared this run. */
  deepCompared: boolean
  /** Convenience: nothing in this diff at all. */
  identical: boolean

  baselineCount: number
  currentCount: number
}

export interface DiffOptions {
  /**
   * Also compare `metadata`/`schemaExtensions` (stable stringify) for objects
   * whose scalars matched. Off by default: it's the one part of the diff whose
   * cost scales with payload size, not object count (see the perf test).
   */
  deepCompare?: boolean
}

const NO_PARENT = '/'

/** '', '/', null and undefined all mean "no parent"; don't report a change between them. */
function normalizeParent(id: string | null | undefined): string | null {
  return id == null || id === '' || id === NO_PARENT ? null : id
}

/** '' and absent are the same non-value for typeId / displayName / namespaceUri. */
function normalizeField(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : value
}

/** Last-wins elementId → object map, the same shape the explorer store builds. */
export function buildObjectIndex(objects: ObjectInstance[]): Map<string, ObjectInstance> {
  const index = new Map<string, ObjectInstance>()
  for (const object of objects) index.set(object.elementId, object)
  return index
}

/**
 * Deterministic JSON with keys sorted at every level, so two semantically
 * equal metadata objects stringify identically regardless of key order.
 * (undefined values serialize as the literal `undefined`, not valid JSON,
 * but this string is only ever compared, never parsed.)
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined'
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return '{' + keys.map(key => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') + '}'
}

// NUL separator: JSON.stringify escapes control characters, so this byte can
// never appear inside either stringified half and the two can't bleed together.
const METADATA_SEPARATOR = String.fromCharCode(0)

export function metadataKey(object: ObjectInstance): string {
  return (
    stableStringify(object.metadata ?? null) +
    METADATA_SEPARATOR +
    stableStringify(object.schemaExtensions ?? null)
  )
}

export function diffCatalogs(
  baseline: CatalogSide,
  current: CatalogSide,
  options: DiffOptions = {}
): CatalogDiff {
  const deepCompare = options.deepCompare ?? false
  const baseKey = baseline.metadataKey ?? metadataKey
  const currKey = current.metadataKey ?? metadataKey

  const baseIndex = baseline.objectIndex ?? buildObjectIndex(baseline.objects)
  const currIndex = current.objectIndex ?? buildObjectIndex(current.objects)

  const added: string[] = []
  const removed: string[] = []
  const changed: ObjectChange[] = []
  const reparented: ObjectChange[] = []
  const retyped: ObjectChange[] = []
  const renamed: ObjectChange[] = []
  const movedNamespace: ObjectChange[] = []
  const metadataOnly: ObjectChange[] = []

  // One pass over the current side: adds and field changes.
  for (const [elementId, currObject] of currIndex) {
    const baseObject = baseIndex.get(elementId)
    if (!baseObject) {
      added.push(elementId)
      continue
    }

    let change: ObjectChange | null = null

    const baseParent = normalizeParent(baseObject.parentId)
    const currParent = normalizeParent(currObject.parentId)
    if (baseParent !== currParent) {
      change = { elementId, parentId: { from: baseParent, to: currParent } }
      reparented.push(change)
    }

    const baseType = normalizeField(baseObject.typeId)
    const currType = normalizeField(currObject.typeId)
    if (baseType !== currType) {
      change = change ?? { elementId }
      change.typeId = { from: baseType, to: currType }
      retyped.push(change)
    }

    const baseName = normalizeField(baseObject.displayName)
    const currName = normalizeField(currObject.displayName)
    if (baseName !== currName) {
      change = change ?? { elementId }
      change.displayName = { from: baseName, to: currName }
      renamed.push(change)
    }

    const baseNs = normalizeField(baseObject.namespaceUri)
    const currNs = normalizeField(currObject.namespaceUri)
    if (baseNs !== currNs) {
      change = change ?? { elementId }
      change.namespaceUri = { from: baseNs, to: currNs }
      movedNamespace.push(change)
    }

    // Deep compare only for objects the cheap checks passed: a scalar change
    // already put the object in the diff, no need to pay a stringify for it.
    if (!change && deepCompare && baseKey(baseObject) !== currKey(currObject)) {
      change = { elementId, metadataOnly: true }
      metadataOnly.push(change)
    }

    if (change) changed.push(change)
  }

  // One pass over the baseline: removals.
  for (const elementId of baseIndex.keys()) {
    if (!currIndex.has(elementId)) removed.push(elementId)
  }

  const types = diffIds(
    baseline.objectTypes.map(type => type.elementId),
    current.objectTypes.map(type => type.elementId)
  )
  const namespaces = diffIds(
    baseline.namespaces.map(ns => ns.uri),
    current.namespaces.map(ns => ns.uri)
  )

  const identical =
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    types.added.length === 0 &&
    types.removed.length === 0 &&
    namespaces.added.length === 0 &&
    namespaces.removed.length === 0

  return {
    added,
    removed,
    changed,
    reparented,
    retyped,
    renamed,
    movedNamespace,
    metadataOnly,
    typesAdded: types.added,
    typesRemoved: types.removed,
    namespacesAdded: namespaces.added,
    namespacesRemoved: namespaces.removed,
    duplicates: {
      baseline: baseline.objects.length - baseIndex.size,
      current: current.objects.length - currIndex.size,
    },
    deepCompared: deepCompare,
    identical,
    baselineCount: baseIndex.size,
    currentCount: currIndex.size,
  }
}

function diffIds(baseline: string[], current: string[]): { added: string[]; removed: string[] } {
  const baseSet = new Set(baseline)
  const currSet = new Set(current)
  const added: string[] = []
  const removed: string[] = []
  for (const id of currSet) if (!baseSet.has(id)) added.push(id)
  for (const id of baseSet) if (!currSet.has(id)) removed.push(id)
  return { added, removed }
}

/* ── Most-changed subtrees ────────────────────────────────────────────────── */

export interface ChangedSubtree {
  rootId: string
  label: string
  /** Which catalog resolves the root, 'baseline' when the whole subtree is gone. */
  side: 'current' | 'baseline'
  changes: number
}

/**
 * Group every diff entry under its root-level ancestor and keep the busiest
 * roots, "where in the model did the change land". Adds and field changes
 * walk the *current* parent chain, removals the *baseline* chain (their
 * parents may not exist anymore). Partial selection via topBy, not a full
 * sort, and the upward walks carry a visited set: some servers emit parentId
 * cycles and a grouping that spins forever is worse than none.
 */
export function topChangedSubtrees(
  diff: CatalogDiff,
  baselineIndex: Map<string, ObjectInstance>,
  currentIndex: Map<string, ObjectInstance>,
  limit = 8
): ChangedSubtree[] {
  const tally = new Map<string, number>()
  // Memoized per side, a thousand changes under one deep branch cost one walk.
  const baseRoots = new Map<string, string>()
  const currRoots = new Map<string, string>()

  const bump = (rootId: string) => tally.set(rootId, (tally.get(rootId) ?? 0) + 1)

  for (const elementId of diff.added) bump(rootOf(elementId, currentIndex, currRoots))
  for (const change of diff.changed) bump(rootOf(change.elementId, currentIndex, currRoots))
  for (const elementId of diff.removed) bump(rootOf(elementId, baselineIndex, baseRoots))

  return topBy([...tally.entries()], entry => entry[1], limit).map(([rootId, changes]) => {
    const live = currentIndex.get(rootId)
    const object = live ?? baselineIndex.get(rootId)
    return {
      rootId,
      label: object?.displayName || rootId,
      side: live ? 'current' : 'baseline',
      changes,
    }
  })
}

function rootOf(
  elementId: string,
  index: Map<string, ObjectInstance>,
  cache: Map<string, string>
): string {
  const path: string[] = []
  const visited = new Set<string>()
  let currentId = elementId

  while (true) {
    const cached = cache.get(currentId)
    if (cached !== undefined) {
      currentId = cached
      break
    }
    const object = index.get(currentId)
    const parentId = object ? normalizeParent(object.parentId) : null
    // Stop at a true root, an orphan (parent not in this catalog), or a cycle
    // re-entry, in all three cases this is the highest honest ancestor.
    if (!object || parentId === null || !index.has(parentId) || visited.has(parentId)) break
    visited.add(currentId)
    path.push(currentId)
    currentId = parentId
  }

  for (const id of path) cache.set(id, currentId)
  cache.set(elementId, currentId)
  return currentId
}
