import type { EgoEdge, EgoGraph, EgoNode } from './egoGraph'

/**
 * Left-to-right tidy tree layout for an ego graph.
 *
 * The BFS tree (each node's `via` is its parent) is laid out like an org chart.
 * The column (x) is the *generation* relative to the root, from the relationship
 * direction: a child sits one column to the right, a parent one to the left, so
 * parents come before their children instead of sharing a hop-based column. Every
 * node gets its own row (y): leaves stack top to bottom, and a node centres on its
 * downstream children. Because a node never shares a row, its label always has
 * space, so names never overlap the way they do on a radial map. Non-tree edges (a
 * node reachable more than one way) are kept and drawn as curves across the columns.
 *
 * Pure and deterministic: same graph in, same picture out.
 */

export interface PositionedNode extends EgoNode {
  x: number
  y: number
  /** Circle radius in diagram units. */
  radius: number
  degree: number
}

export interface PositionedEdge extends EgoEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  /** True for a parent→child edge of the BFS tree; false for a cross-link. */
  tree: boolean
}

export interface TreeLayout {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  /** Columns present, ascending, for the column guides. 0 is the root; negative is upstream (parents). */
  columns: number[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Longest label drawn, in characters. Sized to fit inside one column. */
export const MAX_LABEL_CHARS = 26

/** Horizontal gap between hops. A node and its (right-hand) label share one column. */
export const COLUMN_WIDTH = 270
/** Vertical gap between rows. Each node owns a row, so labels never collide. */
export const ROW_HEIGHT = 28

const ROOT_RADIUS = 6
const MIN_NODE_RADIUS = 3.5
const MAX_NODE_RADIUS = 7

export function layoutTree(graph: EgoGraph): TreeLayout {
  const root = graph.nodes.find(node => node.depth === 0)
  if (!root) return { nodes: [], edges: [], columns: [], minX: 0, minY: 0, maxX: 1, maxY: 1 }
  const rootId = root.object.elementId

  // BFS tree: children keep their discovery order (egoGraph sorts them by
  // relationship bucket then name), so a parent's rows read in that order.
  const children = new Map<string, string[]>()
  const treeParent = new Map<string, string>()
  for (const node of graph.nodes) {
    if (!node.via) continue
    treeParent.set(node.object.elementId, node.via)
    const siblings = children.get(node.via)
    if (siblings) siblings.push(node.object.elementId)
    else children.set(node.via, [node.object.elementId])
  }

  const degree = new Map<string, number>()
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  const rawById = new Map(graph.nodes.map(node => [node.object.elementId, node]))

  // Tidy positions. The column is the generation relative to the root: a child is
  // one column to the RIGHT, a parent one to the LEFT, so parents come before their
  // children instead of sharing a column. A leaf takes the next row; a parent
  // centres on its children. Recursion depth is the tree depth (capped at
  // MAX_RELATIONSHIP_DEPTH), so it can't run away even when a level is very wide.
  const pos = new Map<string, { x: number; y: number }>()
  const columnSet = new Set<number>()
  let nextRow = 0
  const place = (id: string, column: number): void => {
    columnSet.add(column)
    const kids = children.get(id) ?? []
    const x = column * COLUMN_WIDTH
    if (kids.length === 0) {
      pos.set(id, { x, y: nextRow * ROW_HEIGHT })
      nextRow += 1
      return
    }
    // Upstream kids sort first (egoGraph orders parent-ish before child-ish), so
    // they take the top rows; each downstream kid then flows below in order.
    for (const kid of kids) {
      const step = rawById.get(kid)?.viaBucket === 'parent' ? -1 : 1
      place(kid, column + step)
    }
    // Centre on the downstream (right) children so a node lines up with its own
    // children, not with an upstream parent that merely shares its row band.
    const down = kids.filter(kid => rawById.get(kid)?.viaBucket !== 'parent')
    const anchor = down.length > 0 ? down : kids
    const firstY = pos.get(anchor[0])!.y
    const lastY = pos.get(anchor[anchor.length - 1])!.y
    pos.set(id, { x, y: (firstY + lastY) / 2 })
  }
  place(rootId, 0)

  const treeEdge = new Set<string>()
  for (const [child, parent] of treeParent) {
    treeEdge.add(`${parent}\u0000${child}`)
    treeEdge.add(`${child}\u0000${parent}`)
  }

  const nodes: PositionedNode[] = graph.nodes.map(node => {
    const id = node.object.elementId
    const point = pos.get(id) ?? { x: 0, y: 0 }
    const links = degree.get(id) ?? 0
    return {
      ...node,
      x: point.x,
      y: point.y,
      degree: links,
      radius:
        node.depth === 0
          ? ROOT_RADIUS
          : Math.min(MIN_NODE_RADIUS + Math.sqrt(links) * 0.8, MAX_NODE_RADIUS),
    }
  })

  const positions = new Map(nodes.map(node => [node.object.elementId, node]))
  const edges: PositionedEdge[] = []
  for (const edge of graph.edges) {
    const from = positions.get(edge.source)
    const to = positions.get(edge.target)
    if (!from || !to) continue
    edges.push({
      ...edge,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      tree: treeEdge.has(`${edge.source}\u0000${edge.target}`),
    })
  }

  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  for (const node of nodes) {
    if (node.x < minX) minX = node.x
    if (node.x > maxX) maxX = node.x
    if (node.y < minY) minY = node.y
    if (node.y > maxY) maxY = node.y
  }

  return {
    nodes,
    edges,
    columns: [...columnSet].sort((a, b) => a - b),
    minX,
    minY,
    maxX,
    maxY,
  }
}
