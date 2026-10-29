import type { EgoEdge, EgoGraph, EgoNode } from './egoGraph'

/**
 * Radial layout for an ego graph: the root at the center, one concentric ring
 * per hop. Distance from the center IS the depth, which is the whole point of a
 * configurable-depth view (a force blob would place a 3-hop node anywhere).
 *
 * Rings are FIXED and compact. They used to grow to fit every label, which made
 * a 500-child ring thousands of units across: the fitted view shrank the whole
 * map to dust and the side labels still stacked. Now geometry never depends on
 * text, the renderer draws dots and labels at constant *screen* size and culls
 * labels by each node's angular slot at the current zoom (semantic zoom), so
 * the fitted view is always a readable compact map and zooming in resolves any
 * crowd: screen separation between ring neighbors grows linearly with zoom.
 *
 * Angles come from a weighted sector allocation down the BFS tree: each node
 * hands its children a slice of its own sector, sized by how many descendants
 * each carries. Siblings therefore stay together and tree edges never cross.
 * The slot each node owns is exported, it is exactly the label-culling
 * priority: heavy subtrees (the hubs worth reading first) own wide slots and
 * label first; sliver-slot leaves appear as you zoom. Non-tree edges (a node
 * reachable two ways) are drawn as chords across the rings, since those
 * crossings are real information, not layout noise.
 *
 * Pure and deterministic: same graph in, same picture out, no simulation and no
 * jitter between renders.
 */

export interface PositionedNode extends EgoNode {
  x: number
  y: number
  /** Bearing from the center, in radians. Labels are pushed out along it. */
  angle: number
  /**
   * The angular span (radians) this node owns on its ring. The renderer shows a
   * label only when `ringRadius * slot * zoom` clears its threshold, so wide
   * slots (hubs, small rings) label first and slivers appear on zoom.
   */
  slot: number
  degree: number
}

export interface PositionedEdge extends EgoEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface RingInfo {
  depth: number
  radius: number
  count: number
}

export interface RadialLayout {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  /** One entry per hop, for the dashed guides and their captions. */
  rings: RingInfo[]
  /**
   * Radius of the outermost ring. The renderer derives its fit extent from
   * this plus label headroom in *screen* px, labels are screen-constant, so
   * a fixed diagram-unit pad here would shrink relative to them with depth.
   */
  outerRadius: number
}

/** Ring radii: fixed, so the map stays compact at any fan-out. */
export const FIRST_RING = 120
export const RING_GAP = 90

/** Longest label drawn, in characters. Must match truncateLabel in the renderer. */
export const MAX_LABEL_CHARS = 24

export function layoutRadial(graph: EgoGraph): RadialLayout {
  const root = graph.nodes.find(node => node.depth === 0)
  if (!root) return { nodes: [], edges: [], rings: [], outerRadius: 1 }

  const rootId = root.object.elementId

  const degree = new Map<string, number>()
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  // The BFS tree: `via` is the node each one was first reached from. Children keep
  // their discovery order, which egoGraph sorts by relationship bucket then name,
  // so a ring reads parent-ish, then children, then references, going clockwise.
  const children = new Map<string, string[]>()
  for (const node of graph.nodes) {
    if (!node.via) continue
    const siblings = children.get(node.via)
    if (siblings) siblings.push(node.object.elementId)
    else children.set(node.via, [node.object.elementId])
  }

  // Subtree size, deepest first so a node's children are always already weighted.
  const weight = new Map<string, number>()
  for (const node of [...graph.nodes].sort((a, b) => b.depth - a.depth)) {
    const id = node.object.elementId
    const kids = children.get(id) ?? []
    weight.set(
      id,
      kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + (weight.get(kid) ?? 1), 0)
    )
  }

  let maxDepth = 0
  const perRing: number[] = []
  for (const node of graph.nodes) {
    perRing[node.depth] = (perRing[node.depth] ?? 0) + 1
    if (node.depth > maxDepth) maxDepth = node.depth
  }

  const ringRadius = (depth: number) => (depth === 0 ? 0 : FIRST_RING + (depth - 1) * RING_GAP)

  const angles = new Map<string, number>([[rootId, 0]])
  const slots = new Map<string, number>([[rootId, Math.PI * 2]])
  // Start at 12 o'clock (SVG y grows downward, so -π/2 is up).
  assignSectors(rootId, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, children, weight, angles, slots)

  const nodes: PositionedNode[] = graph.nodes.map(node => {
    const id = node.object.elementId
    const angle = angles.get(id) ?? 0
    const ring = ringRadius(node.depth)
    return {
      ...node,
      x: Math.cos(angle) * ring,
      y: Math.sin(angle) * ring,
      angle,
      slot: slots.get(id) ?? 0,
      degree: degree.get(id) ?? 0,
    }
  })

  const positions = new Map(nodes.map(node => [node.object.elementId, node]))
  const edges: PositionedEdge[] = []
  for (const edge of graph.edges) {
    const from = positions.get(edge.source)
    const to = positions.get(edge.target)
    if (!from || !to) continue
    edges.push({ ...edge, x1: from.x, y1: from.y, x2: to.x, y2: to.y })
  }

  const rings: RingInfo[] = []
  for (let depth = 1; depth <= maxDepth; depth++) {
    rings.push({ depth, radius: ringRadius(depth), count: perRing[depth] ?? 0 })
  }

  return { nodes, edges, rings, outerRadius: Math.max(ringRadius(maxDepth), FIRST_RING) }
}

/**
 * Hands each child a slice of [start, end) proportional to its subtree, centers
 * it there, and records the slice width as the child's slot.
 */
function assignSectors(
  id: string,
  start: number,
  end: number,
  children: Map<string, string[]>,
  weight: Map<string, number>,
  angles: Map<string, number>,
  slots: Map<string, number>
): void {
  const kids = children.get(id)
  if (!kids || kids.length === 0) return

  const total = kids.reduce((sum, kid) => sum + (weight.get(kid) ?? 1), 0) || 1
  let cursor = start

  for (const kid of kids) {
    const span = ((end - start) * (weight.get(kid) ?? 1)) / total
    angles.set(kid, cursor + span / 2)
    slots.set(kid, span)
    // Depth is capped at MAX_EGO_DEPTH, so this recursion can't run away.
    assignSectors(kid, cursor, cursor + span, children, weight, angles, slots)
    cursor += span
  }
}
