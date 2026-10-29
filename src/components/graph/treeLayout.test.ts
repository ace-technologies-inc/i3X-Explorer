import { describe, expect, it } from 'vitest'
import { COLUMN_WIDTH, layoutTree } from './treeLayout'
import type { EgoGraph } from './egoGraph'
import type { ObjectInstance } from '../../api/types'

function obj(elementId: string): ObjectInstance {
  return {
    elementId,
    displayName: elementId,
    typeId: 'T',
    parentId: null,
    isComposition: false,
    namespaceUri: 'urn:ns',
  }
}

// root with an upstream parent P, two children C1/C2, and a grandchild G1
// under C1, the canonical parent → self → children → grandchildren picture.
function fixtureGraph(): EgoGraph {
  return {
    nodes: [
      { object: obj('root'), depth: 0 },
      { object: obj('P'), depth: 1, via: 'root', viaBucket: 'parent' },
      { object: obj('C1'), depth: 1, via: 'root', viaBucket: 'child' },
      { object: obj('C2'), depth: 1, via: 'root', viaBucket: 'child' },
      { object: obj('G1'), depth: 2, via: 'C1', viaBucket: 'child' },
    ],
    edges: [
      { source: 'root', target: 'P', bucket: 'parent' },
      { source: 'root', target: 'C1', bucket: 'child' },
      { source: 'root', target: 'C2', bucket: 'child' },
      { source: 'C1', target: 'G1', bucket: 'child' },
    ],
  }
}

describe('layoutTree', () => {
  it('places columns by generation: parents left, children right', () => {
    const layout = layoutTree(fixtureGraph())
    const byId = new Map(layout.nodes.map(n => [n.object.elementId, n]))
    expect(byId.get('root')?.x).toBe(0)
    expect(byId.get('P')?.x).toBe(-COLUMN_WIDTH)
    expect(byId.get('C1')?.x).toBe(COLUMN_WIDTH)
    expect(byId.get('C2')?.x).toBe(COLUMN_WIDTH)
    expect(byId.get('G1')?.x).toBe(2 * COLUMN_WIDTH)
    expect(layout.columns).toEqual([-1, 0, 1, 2])
  })

  it('gives every leaf its own row', () => {
    const layout = layoutTree(fixtureGraph())
    const leafYs = layout.nodes
      .filter(n => ['P', 'C2', 'G1'].includes(n.object.elementId))
      .map(n => n.y)
    expect(new Set(leafYs).size).toBe(leafYs.length)
  })

  it('centres a node on its downstream children only', () => {
    const layout = layoutTree(fixtureGraph())
    const byId = new Map(layout.nodes.map(n => [n.object.elementId, n]))
    // root sits midway between C1 and C2, the upstream P is ignored so the
    // root lines up with its own children, not with its parent's row.
    const c1 = byId.get('C1')!
    const c2 = byId.get('C2')!
    expect(byId.get('root')?.y).toBe((c1.y + c2.y) / 2)
    // C1 in turn centres on G1.
    expect(c1.y).toBe(byId.get('G1')!.y)
  })

  it('flags BFS-tree edges and cross-links differently', () => {
    const graph = fixtureGraph()
    graph.edges.push({ source: 'C2', target: 'G1', bucket: 'other' })
    const layout = layoutTree(graph)
    const treeFlags = new Map(layout.edges.map(e => [`${e.source}->${e.target}`, e.tree]))
    expect(treeFlags.get('root->C1')).toBe(true)
    expect(treeFlags.get('C1->G1')).toBe(true)
    expect(treeFlags.get('C2->G1')).toBe(false)
  })

  it('returns an empty layout instead of throwing when there is no root', () => {
    expect(layoutTree({ nodes: [], edges: [] })).toEqual({
      nodes: [],
      edges: [],
      columns: [],
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    })
  })
})
