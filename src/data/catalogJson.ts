import type { ObjectInstance } from '../api/types'

/** Pretty JSON, the shape every copy action writes to the clipboard. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** parentId → children, the same edges the Hierarchy view walks. */
export function childrenByParentOf(objects: ObjectInstance[]): Map<string, ObjectInstance[]> {
  const children = new Map<string, ObjectInstance[]>()
  for (const object of objects) {
    if (!object.parentId) continue
    const siblings = children.get(object.parentId)
    if (siblings) siblings.push(object)
    else children.set(object.parentId, [object])
  }
  return children
}

/**
 * Nested JSON for an object and everything under it: each node is the object
 * plus a `children` array. Cycle-guarded through `visited`, which callers share
 * across sibling roots so a node reachable twice is emitted once.
 */
export function subtreeValue(
  object: ObjectInstance,
  childrenByParent: Map<string, ObjectInstance[]>,
  visited: Set<string>
): Record<string, unknown> {
  visited.add(object.elementId)
  const children: Record<string, unknown>[] = []
  for (const child of childrenByParent.get(object.elementId) ?? []) {
    if (visited.has(child.elementId)) continue
    children.push(subtreeValue(child, childrenByParent, visited))
  }
  return { ...object, children }
}

/**
 * Deep copy of `value` where every object carrying a known `elementId` gains
 * the catalog's authoritative fields, retaining contextual children and
 * sourceRelationship from the value.
 */
export function withCatalogDetails(
  value: unknown,
  lookup: (elementId: string) => ObjectInstance | undefined
): unknown {
  if (Array.isArray(value)) return value.map(item => withCatalogDetails(item, lookup))
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const mapped: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) mapped[key] = withCatalogDetails(child, lookup)
  const full = typeof record.elementId === 'string' ? lookup(record.elementId) : undefined
  return full ? {
    ...mapped,
    ...full,
    ...(mapped.sourceRelationship !== undefined ? { sourceRelationship: mapped.sourceRelationship } : {}),
  } : mapped
}
