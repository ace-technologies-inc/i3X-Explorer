import { describe, expect, it } from 'vitest'
import {
  descendantIds,
  directNeighbors,
  edgeKey,
  expandEgoGraph,
  sortNeighbors,
  type EgoNode,
  type StoreView,
} from './egoGraph'
import type { I3XClient } from '../../api/client'
import type { ObjectInstance } from '../../api/types'

function obj(elementId: string, over: Partial<ObjectInstance> = {}): ObjectInstance {
  return {
    elementId,
    displayName: elementId,
    typeId: 'T',
    parentId: null,
    isComposition: false,
    namespaceUri: 'urn:ns',
    ...over,
  }
}

function emptyStore(): StoreView {
  return { objectIndex: new Map(), childrenByParent: new Map() }
}

// A client whose /objects/related responses come from a fixture map.
// The cast is required: I3XClient has private members, so a structural stub
// can't satisfy the class type directly.
function stubClient(relatedOf: Record<string, ObjectInstance[]>): I3XClient {
  return {
    getRelatedObjectsBatch: async (ids: string[]) => ({
      related: new Map(ids.map(id => [id, relatedOf[id] ?? []])),
      failures: [],
    }),
    getRelatedObjects: async (id: string) => relatedOf[id] ?? [],
  } as unknown as I3XClient
}

describe('edgeKey', () => {
  it('collapses the two ends of a hierarchy edge into one key', () => {
    // HasComponent(A→B) and ComponentOf(B→A) are one physical edge.
    expect(edgeKey('A', 'B', 'child')).toBe(edgeKey('B', 'A', 'parent'))
  })

  it('keeps non-hierarchy families distinct', () => {
    expect(edgeKey('A', 'B', 'other')).not.toBe(edgeKey('A', 'B', 'child'))
    expect(edgeKey('A', 'B', 'inherits')).not.toBe(edgeKey('A', 'B', 'other'))
  })
})

describe('directNeighbors', () => {
  it('lets the API entry win over the store-inferred relationship', () => {
    const root = obj('root', { parentId: 'p' })
    const apiParent = obj('p', { sourceRelationship: 'Monitors' })
    const store: StoreView = {
      objectIndex: new Map([['p', obj('p')]]),
      childrenByParent: new Map(),
    }
    const neighbors = directNeighbors(root, [apiParent], store)
    expect(neighbors).toHaveLength(1)
    // The server's word, not the parentId-derived 'HasParent'.
    expect(neighbors[0].relationshipType).toBe('Monitors')
  })

  it('unions in the store parent and children the server omitted', () => {
    const root = obj('root', { parentId: 'p' })
    const store: StoreView = {
      objectIndex: new Map([['p', obj('p')]]),
      childrenByParent: new Map([['root', [obj('c1')]]]),
    }
    const neighbors = directNeighbors(root, [], store)
    const byId = new Map(neighbors.map(n => [n.object.elementId, n.relationshipType]))
    expect(byId.get('p')).toBe('HasParent')
    expect(byId.get('c1')).toBe('HasComponent')
  })

  it('sorts parent before children before other', () => {
    const sorted = sortNeighbors([
      { object: obj('z'), relationshipType: 'Monitors' },
      { object: obj('c'), relationshipType: 'HasComponent' },
      { object: obj('p'), relationshipType: 'HasParent' },
    ])
    expect(sorted.map(n => n.object.elementId)).toEqual(['p', 'c', 'z'])
  })
})

describe('expandEgoGraph', () => {
  // root has a parent P and a child C1; C1 has a child G1 and reports its own
  // back-edge to root; P has children of its own that must never appear.
  const relatedOf: Record<string, ObjectInstance[]> = {
    root: [
      obj('P', { sourceRelationship: 'HasParent' }),
      obj('C1', { sourceRelationship: 'HasComponent' }),
      obj('M', { sourceRelationship: 'Monitors' }),
    ],
    C1: [
      obj('root', { sourceRelationship: 'ComponentOf' }),
      obj('G1', { sourceRelationship: 'HasComponent' }),
    ],
    P: [obj('uncle', { sourceRelationship: 'HasComponent' })],
  }

  it('fans out from the root but only descends past it', async () => {
    const graph = await expandEgoGraph({
      client: stubClient(relatedOf),
      root: obj('root'),
      depth: 3,
      store: emptyStore(),
    })
    const ids = graph.nodes.map(n => n.object.elementId).sort()
    // P is a leaf: its children ("uncle") are never fetched into the graph,
    // and M (non-hierarchy off the root) is shown but not expanded.
    expect(ids).toEqual(['C1', 'G1', 'M', 'P', 'root'])
    const byId = new Map(graph.nodes.map(n => [n.object.elementId, n]))
    expect(byId.get('P')?.viaBucket).toBe('parent')
    expect(byId.get('G1')?.depth).toBe(2)
  })

  it('reports elements whose relationships failed and still draws them as leaves', async () => {
    const client = {
      getRelatedObjectsBatch: async (ids: string[]) => ({
        related: new Map(ids.filter(id => id !== 'C1').map(id => [id, relatedOf[id] ?? []])),
        failures: ids.includes('C1') ? [{ elementId: 'C1', message: 'HTTP 500: down' }] : [],
      }),
    } as unknown as I3XClient
    const graph = await expandEgoGraph({ client, root: obj('root'), depth: 3, store: emptyStore() })
    expect(graph.failures).toEqual([{ elementId: 'C1', message: 'HTTP 500: down' }])
    expect(graph.nodes.map(n => n.object.elementId)).toContain('C1')
    expect(graph.nodes.map(n => n.object.elementId)).not.toContain('G1')
  })

  it('dedupes the two ends of a hierarchy edge', async () => {
    const graph = await expandEgoGraph({
      client: stubClient(relatedOf),
      root: obj('root'),
      depth: 2,
      store: emptyStore(),
    })
    const rootC1 = graph.edges.filter(
      e =>
        (e.source === 'root' && e.target === 'C1') ||
        (e.source === 'C1' && e.target === 'root')
    )
    // HasComponent(root→C1) and ComponentOf(C1→root) collapse to one edge,
    // kept in the direction discovered from the shallower node.
    expect(rootC1).toHaveLength(1)
    expect(rootC1[0].source).toBe('root')
  })

  it('descendantsOnly skips the parent and side links from the very first hop', async () => {
    const graph = await expandEgoGraph({
      client: stubClient(relatedOf),
      root: obj('root'),
      depth: 3,
      store: emptyStore(),
      descendantsOnly: true,
    })
    const ids = graph.nodes.map(n => n.object.elementId).sort()
    expect(ids).toEqual(['C1', 'G1', 'root'])
  })

  // root --edc:HasKPIs--> K1 --edc:HasKPIs--> K2 : a reference chain, all 'other'
  // edges, the kind of context modeled off the hierarchy.
  const refChain: Record<string, ObjectInstance[]> = {
    root: [obj('K1', { sourceRelationship: 'edc:HasKPIs' })],
    K1: [obj('K2', { sourceRelationship: 'maximo:HasWorkOrders' })],
    K2: [obj('K3', { sourceRelationship: 'edc:HasDefects' })],
  }

  it('hierarchy traversal shows reference edges off the root but never deepens into them', async () => {
    const graph = await expandEgoGraph({
      client: stubClient(refChain),
      root: obj('root'),
      depth: 3,
      store: emptyStore(),
      traversal: 'hierarchy',
    })
    const ids = graph.nodes.map(n => n.object.elementId).sort()
    // K1 is shown (one hop off the root) but K2/K3 are never reached.
    expect(ids).toEqual(['K1', 'root'])
  })

  it('references traversal deepens through the chain of other edges', async () => {
    const graph = await expandEgoGraph({
      client: stubClient(refChain),
      root: obj('root'),
      depth: 3,
      store: emptyStore(),
      traversal: 'references',
    })
    const byId = new Map(graph.nodes.map(n => [n.object.elementId, n]))
    expect([...byId.keys()].sort()).toEqual(['K1', 'K2', 'K3', 'root'])
    // Depth follows the reference hops.
    expect(byId.get('K2')?.depth).toBe(2)
    expect(byId.get('K3')?.depth).toBe(3)
  })

  it('references traversal still never walks back up a parent edge', async () => {
    const graph = await expandEgoGraph({
      client: stubClient(relatedOf),
      root: obj('root'),
      depth: 3,
      store: emptyStore(),
      traversal: 'references',
    })
    const ids = graph.nodes.map(n => n.object.elementId).sort()
    // P is still a leaf (its child "uncle" is never fetched); M is a lateral
    // reference off the root and stays a leaf too, having no downstream edges.
    expect(ids).toEqual(['C1', 'G1', 'M', 'P', 'root'])
  })
})

describe('descendantIds', () => {
  // The branch as drawn: what a focus frames and lights.
  const nodes: EgoNode[] = [
    { object: obj('root'), depth: 0 },
    { object: obj('parent'), depth: 1, via: 'root', viaBucket: 'parent' },
    { object: obj('a'), depth: 1, via: 'root', viaBucket: 'child' },
    { object: obj('b'), depth: 1, via: 'root', viaBucket: 'child' },
    { object: obj('a1'), depth: 2, via: 'a', viaBucket: 'child' },
    { object: obj('a2'), depth: 2, via: 'a', viaBucket: 'child' },
    { object: obj('a1x'), depth: 3, via: 'a1', viaBucket: 'child' },
  ]

  it('collects a node and everything below it, itself included', () => {
    expect([...descendantIds(nodes, 'a')].sort()).toEqual(['a', 'a1', 'a1x', 'a2'])
  })

  it('is just the node itself for a leaf', () => {
    expect([...descendantIds(nodes, 'b')]).toEqual(['b'])
  })

  it('takes the whole drawing from the root', () => {
    expect(descendantIds(nodes, 'root').size).toBe(nodes.length)
  })

  it('terminates on a via cycle', () => {
    // Some servers emit parentId cycles; the walk can carry one through.
    const cyclic: EgoNode[] = [
      { object: obj('x'), depth: 0 },
      { object: obj('y'), depth: 1, via: 'x', viaBucket: 'child' },
      { object: obj('x'), depth: 2, via: 'y', viaBucket: 'child' },
    ]
    expect([...descendantIds(cyclic, 'x')].sort()).toEqual(['x', 'y'])
  })
})
