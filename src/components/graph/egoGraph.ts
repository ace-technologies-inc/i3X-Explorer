import type { ElementFailure, I3XClient } from '../../api/client'
import type { ObjectInstance } from '../../api/types'
import { BUCKET_ORDER, bucketOf, type RelationshipBucket } from './relationshipColors'

/**
 * How far the walk deepens past the root.
 *
 * 'hierarchy' descends through composition/child edges only, the I3X maxDepth
 * meaning of depth (containment depth). 'references' also follows lateral 'other'
 * edges (custom Has* relationship types) downward, so context modeled as graph
 * edges deepens with the depth control. Neither ever walks back up
 * (parent/inherits): direction, not a name allowlist, is what keeps a deep walk
 * from exploding sideways.
 */
export type Traversal = 'hierarchy' | 'references'

/**
 * The ego graph: everything reachable from one element within N relationship
 * hops. This is what makes the Relationships tab worth having. A single hop is
 * just the list rendered as circles; the structure only appears past the first
 * level.
 *
 * Edges come from POST /objects/related, which returns all relationship kinds
 * (compositional and not). Walking it breadth-first gives depth N in N round
 * trips, because the client can ask for a whole frontier in one call
 * (getRelatedObjectsBatch).
 */

/** How some object is related to a neighbor of it. */
export interface Neighbor {
  object: ObjectInstance
  /** The server's relationship type, e.g. HasComponent / Monitors. */
  relationshipType?: string
}

export interface EgoNode {
  object: ObjectInstance
  /** Hops from the root; 0 is the root itself. */
  depth: number
  /** The node this one was first reached from (the BFS tree edge). Root: undefined. */
  via?: string
  /**
   * Relationship bucket of the edge it was first reached through, so the layout
   * knows the direction: a 'parent' edge is upstream (draw left), everything else
   * is downstream (draw right). Root: undefined.
   */
  viaBucket?: RelationshipBucket
  /**
   * When leaves are collapsed (a map setting), the count of scalar-leaf children
   * this node had that were folded away, so the renderer can tag it "+N". Unset
   * otherwise.
   */
  collapsedLeaves?: number
}

export interface EgoEdge {
  /**
   * The endpoint the edge was discovered FROM, which BFS guarantees is the
   * shallower of the two. So an edge always reads outward from the root, and its
   * bucket is the relationship as seen from the inner node.
   */
  source: string
  target: string
  relationshipType?: string
  bucket: RelationshipBucket
}

export interface EgoGraph {
  nodes: EgoNode[]
  edges: EgoEdge[]
  /** Elements whose relationships the server could not return; they are drawn as leaves. */
  failures?: ElementFailure[]
}

/** The slices of the explorer store the walk reads. */
export interface StoreView {
  objectIndex: Map<string, ObjectInstance>
  childrenByParent: Map<string, ObjectInstance[]>
}

/**
 * Every direct relationship of `object`: what the server returned, unioned with
 * the compositional parent and children the store already knows.
 *
 * The union matters because servers differ in what /objects/related reports:
 * some omit the hierarchy, some omit everything else. The API entry wins on
 * conflict: it carries the true sourceRelationship, where the store can only
 * infer HasParent/HasComponent from parentId.
 */
export function directNeighbors(
  object: ObjectInstance,
  related: ObjectInstance[],
  store: StoreView
): Neighbor[] {
  const byId = new Map<string, Neighbor>()

  for (const neighbor of related) {
    if (neighbor.elementId === object.elementId) continue
    byId.set(neighbor.elementId, {
      object: neighbor,
      relationshipType: neighbor.sourceRelationship,
    })
  }

  const parentId = object.parentId && object.parentId !== '/' ? object.parentId : null
  const parent = parentId ? store.objectIndex.get(parentId) : undefined
  if (parent && !byId.has(parent.elementId)) {
    byId.set(parent.elementId, { object: parent, relationshipType: 'HasParent' })
  }

  for (const child of store.childrenByParent.get(object.elementId) ?? []) {
    if (child.elementId === object.elementId) continue
    if (!byId.has(child.elementId)) {
      byId.set(child.elementId, { object: child, relationshipType: 'HasComponent' })
    }
  }

  return sortNeighbors([...byId.values()])
}

/**
 * `rootId` and everything reached through it in the walk's BFS tree (each node's
 * `via` is the node it was first reached from).
 *
 * This is what "focus on this and its children" frames and lights up: it is the
 * branch as *drawn*, so the highlight can never claim more than the picture
 * shows. Iterative and visited-guarded, a server emitting a parentId cycle
 * cannot spin it.
 */
export function descendantIds(nodes: EgoNode[], rootId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.via) continue
    const siblings = children.get(node.via)
    if (siblings) siblings.push(node.object.elementId)
    else children.set(node.via, [node.object.elementId])
  }

  const ids = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length > 0) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (ids.has(child)) continue
      ids.add(child)
      stack.push(child)
    }
  }
  return ids
}

/** Parent first, then children, then inheritance, then the rest; alphabetical within a bucket. */
export function sortNeighbors(neighbors: Neighbor[]): Neighbor[] {
  return [...neighbors].sort((a, b) => {
    const rank = BUCKET_ORDER[bucketOf(a.relationshipType)] - BUCKET_ORDER[bucketOf(b.relationshipType)]
    if (rank !== 0) return rank
    return a.object.displayName.localeCompare(b.object.displayName)
  })
}

/**
 * One line per pair per relationship family.
 *
 * HasComponent(A→B) and ComponentOf(B→A) are one physical edge seen from both
 * ends, so both land on the same `hier` key and only the first survives (the one
 * discovered from the shallower node). Without this, every hierarchy edge would
 * be drawn twice, in two different colors, once the walk reached its far end.
 */
export function edgeKey(a: string, b: string, bucket: RelationshipBucket): string {
  const family = bucket === 'parent' || bucket === 'child' ? 'hier' : bucket
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return `${lo}\u0000${hi}\u0000${family}`
}

/** Neighbors for a whole BFS frontier: one round trip. */
async function fetchFrontier(
  client: I3XClient,
  ids: string[]
): Promise<{ related: Map<string, ObjectInstance[]>; failures: ElementFailure[] }> {
  if (ids.length === 0) return { related: new Map(), failures: [] }
  return client.getRelatedObjectsBatch(ids)
}

/**
 * Walk `depth` hops out from `root`, downward.
 *
 * The root shows all its direct relationships (its parent, its children, and any
 * other links). Past the root the walk only ever descends, it follows child
 * edges and nothing else, so the parent is shown one level up and never expanded:
 * no grandparents and no siblings. To see further up, root the map on the parent
 * and drill down from there.
 *
 * With `descendantsOnly` the root gets no special treatment either: child edges
 * from the very first hop, so the result is the pure subtree beneath the root,
 * no parent, no non-hierarchy links. This is what the Subtree tab draws.
 *
 * `traversal` widens what "descend" means: 'hierarchy' (default) follows child
 * edges only, 'references' also follows lateral 'other' edges downward, so custom
 * Has* reference relationships deepen with the depth control. Upward edges
 * (parent/inherits) are never followed in either mode.
 *
 * `cancelled` is checked after every level so a depth change or a navigation
 * mid-walk abandons the remaining round trips rather than resolving into a
 * component that has moved on.
 */
export async function expandEgoGraph({
  client,
  root,
  depth,
  store,
  descendantsOnly = false,
  traversal = 'hierarchy',
  cancelled = () => false,
}: {
  client: I3XClient
  root: ObjectInstance
  depth: number
  store: StoreView
  descendantsOnly?: boolean
  traversal?: Traversal
  cancelled?: () => boolean
}): Promise<EgoGraph> {
  const nodes = new Map<string, EgoNode>([[root.elementId, { object: root, depth: 0 }]])
  const edges: EgoEdge[] = []
  const failures: ElementFailure[] = []
  const seen = new Set<string>()

  let frontier: ObjectInstance[] = [root]

  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    const { related, failures: levelFailures } = await fetchFrontier(client, frontier.map(object => object.elementId))
    if (cancelled()) break
    failures.push(...levelFailures)

    const next: ObjectInstance[] = []
    // The root (level 1) fans out to all its direct relationships; past it we only
    // ever descend. A descendants-only walk descends from the start.
    const fromRoot = level === 1 && !descendantsOnly

    for (const source of frontier) {
      const neighbors = directNeighbors(source, related.get(source.elementId) ?? [], store)

      for (const neighbor of neighbors) {
        const id = neighbor.object.elementId
        const bucket = bucketOf(neighbor.relationshipType)
        // Downstream = the directions the walk descends: children always, plus
        // lateral 'other' reference edges when following references. Never up.
        const downstream = bucket === 'child' || (traversal === 'references' && bucket === 'other')

        // Beyond the root, follow downstream edges only: no going back up, no siblings.
        if (!fromRoot && !downstream) continue

        if (!nodes.has(id)) {
          nodes.set(id, {
            object: neighbor.object,
            depth: level,
            via: source.elementId,
            viaBucket: bucket,
          })
          // Only downstream nodes expand further, so the parent (and, in
          // hierarchy mode, any reference links off the root) are shown once and
          // left as leaves: 1 up and root, then children, grandchildren, and so on.
          if (downstream) next.push(neighbor.object)
        }

        const key = edgeKey(source.elementId, id, bucket)
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({
          source: source.elementId,
          target: id,
          relationshipType: neighbor.relationshipType,
          bucket,
        })
      }
    }

    frontier = next
  }

  return { nodes: [...nodes.values()], edges, failures }
}
