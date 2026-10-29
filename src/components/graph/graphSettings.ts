import { useExplorerStore, type GraphLeafMode } from '../../stores/explorer'
import type { ObjectType } from '../../api/types'
import type { EgoGraph, EgoNode } from './egoGraph'

/**
 * The per-map display settings from the gear menu, read from the store, plus the
 * pure transforms and small render helpers they drive.
 *
 * These change what a relationship map DRAWS, never the walk: the ego graph is
 * fetched once (`useEgoGraph`) and shared with the list, so filtering/reordering
 * here is applied only to the copy the Tree and Rings views lay out. That keeps
 * the walk (and the list beside it) untouched, at the cost of the map showing a
 * deliberately different subset than the list when leaves are hidden.
 */

export interface GraphSettings {
  leafMode: GraphLeafMode
  fadeDistant: boolean
  sortBySize: boolean
  colorByType: boolean
}

export function useGraphSettings(): GraphSettings {
  const leafMode = useExplorerStore(s => s.graphLeafMode)
  const fadeDistant = useExplorerStore(s => s.graphFadeDistant)
  const sortBySize = useExplorerStore(s => s.graphSortBySize)
  const colorByType = useExplorerStore(s => s.graphColorByType)
  return { leafMode, fadeDistant, sortBySize, colorByType }
}

/**
 * A node counts as a leaf when it is not a container: `isComposition` is the
 * app's own container flag (the tree draws a chevron for it). This is far more
 * reliable in a relationship walk than the type's JSON schema, which is often
 * absent because object types aren't all loaded, that dependency made hide /
 * collapse fold almost nothing. The caller additionally requires the node be
 * terminal in the walk, so a real container is never folded even if its
 * `isComposition` flag is missing.
 */
export function isGraphLeaf(node: EgoNode): boolean {
  return node.object.isComposition !== true
}

/**
 * Apply the leaf-handling and sibling-ordering settings to a walk, returning a
 * new graph (or the same reference when nothing changes). Colouring and fading
 * are per-render and handled in the views; only these two reshape the layout.
 */
export function applyGraphSettings(
  graph: EgoGraph,
  settings: Pick<GraphSettings, 'leafMode' | 'sortBySize'>
): EgoGraph {
  let nodes = graph.nodes
  let edges = graph.edges

  if (settings.leafMode !== 'show') {
    // A node that is itself reached-through by another is a container, keep it
    // even if its own flag is missing; only fold true leaves.
    const hasChild = new Set<string>()
    for (const node of nodes) if (node.via) hasChild.add(node.via)

    const removed = new Set<string>()
    const foldedCount = new Map<string, number>()
    for (const node of nodes) {
      if (node.depth === 0 || hasChild.has(node.object.elementId) || !isGraphLeaf(node)) continue
      removed.add(node.object.elementId)
      if (node.via) foldedCount.set(node.via, (foldedCount.get(node.via) ?? 0) + 1)
    }

    if (removed.size > 0) {
      nodes = nodes
        .filter(n => !removed.has(n.object.elementId))
        .map(n =>
          settings.leafMode === 'collapse' && foldedCount.has(n.object.elementId)
            ? { ...n, collapsedLeaves: foldedCount.get(n.object.elementId) }
            : n
        )
      edges = edges.filter(e => !removed.has(e.source) && !removed.has(e.target))
    }
  }

  if (settings.sortBySize) nodes = sortSiblingsBySize(nodes)

  return nodes === graph.nodes && edges === graph.edges ? graph : { ...graph, nodes, edges }
}

/**
 * Reorder nodes so each parent's children read biggest-branch-first. Both layouts
 * take sibling order straight from node order, so re-emitting the BFS tree with
 * children sorted by descendant count is enough to reorder Tree and Rings alike.
 */
function sortSiblingsBySize(nodes: EgoNode[]): EgoNode[] {
  const byId = new Map(nodes.map(n => [n.object.elementId, n]))
  const originalIndex = new Map(nodes.map((n, i) => [n.object.elementId, i]))
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.via) continue
    const siblings = children.get(node.via)
    if (siblings) siblings.push(node.object.elementId)
    else children.set(node.via, [node.object.elementId])
  }

  // Subtree size, deepest first so a node's children are weighted before it.
  const size = new Map<string, number>()
  for (const node of [...nodes].sort((a, b) => b.depth - a.depth)) {
    const kids = children.get(node.object.elementId) ?? []
    size.set(
      node.object.elementId,
      kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + (size.get(k) ?? 1), 0)
    )
  }

  const root = nodes.find(n => n.depth === 0)
  if (!root) return nodes

  const emitted: EgoNode[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    const node = byId.get(id)
    if (!node || seen.has(id)) return
    seen.add(id)
    emitted.push(node)
    const kids = [...(children.get(id) ?? [])].sort((a, b) => {
      const bySize = (size.get(b) ?? 0) - (size.get(a) ?? 0)
      return bySize !== 0 ? bySize : (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0)
    })
    for (const kid of kids) walk(kid)
  }
  walk(root.object.elementId)
  // Anything unreachable from the root (shouldn't happen) keeps its place at the end.
  for (const node of nodes) if (!seen.has(node.object.elementId)) emitted.push(node)
  return emitted
}

/**
 * A categorical palette for "color by type". Hand-picked to be mutually
 * distinct (the old hue-hash produced near-identical greens for unrelated
 * types); assigned by rank so the most common types get the most separated
 * colors, and only long tails past the palette size ever repeat a color.
 */
export const TYPE_PALETTE = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2',
  '#edc948', '#ff9da7', '#9c755f', '#af7aa1', '#1f77b4', '#ff7f0e',
  '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#bcbd22',
  '#17becf', '#393b79', '#637939', '#8c6d31', '#843c39', '#7b4173',
]

const FALLBACK_TYPE_COLOR = '#8a8f98'

/**
 * Map each drawn type to a palette color, most frequent first (ties broken by id
 * for stability). Both the node fills and the legend read this one map, so their
 * colors always agree. The root (depth 0) is the primary color, not a type hue.
 */
export function buildTypeColorMap(
  nodes: { object: { typeId?: string }; depth: number }[]
): Map<string, string> {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    if (node.depth === 0) continue
    const typeId = node.object.typeId
    if (!typeId) continue
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const map = new Map<string, string>()
  ranked.forEach(([typeId], i) => map.set(typeId, TYPE_PALETTE[i % TYPE_PALETTE.length]))
  return map
}

/** Palette color for a type, falling back to neutral gray for an unmapped one. */
export function typeColor(typeId: string, map: Map<string, string> | null): string {
  return map?.get(typeId) ?? FALLBACK_TYPE_COLOR
}

export interface LegendEntry {
  typeId: string
  label: string
  color: string
  count: number
}

/**
 * The legend rows for a drawn graph: every type present, ranked by node count,
 * with its palette color and display name. One builder feeds both the on-screen
 * legend and the PNG export, so the key in a downloaded image matches the map.
 */
export function buildLegendEntries(
  nodes: { object: { typeId?: string }; depth: number }[],
  colorMap: Map<string, string> | null,
  typeIndex: Map<string, ObjectType>
): LegendEntry[] {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    if (node.depth === 0) continue
    const typeId = node.object.typeId
    if (!typeId) continue
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([typeId, count]) => ({
      typeId,
      count,
      color: typeColor(typeId, colorMap),
      label: typeIndex.get(typeId)?.displayName ?? typeId,
    }))
}

/** Opacity for a node/edge at `depth`, ramping down with distance. Root stays 1. */
export function depthOpacity(depth: number): number {
  return Math.max(0.2, 1 - depth * 0.28)
}
