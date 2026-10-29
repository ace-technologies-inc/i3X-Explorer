import { describe, expect, it } from 'vitest'
import type { EgoGraph } from './egoGraph'
import { buildEgoTree, filterEgoTree, planAutoExpand, type EgoTree } from './egoTree'
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

/**
 * The walk shape the tab actually produces: the root fans out to its parent and
 * its children, and past that only children are followed.
 *
 *   P  ←  root  →  C1 → G1, G2
 *                  C2
 */
function sampleGraph(): EgoGraph {
  return {
    nodes: [
      { object: obj('root'), depth: 0 },
      { object: obj('P'), depth: 1, via: 'root', viaBucket: 'parent' },
      { object: obj('C1'), depth: 1, via: 'root', viaBucket: 'child' },
      { object: obj('C2'), depth: 1, via: 'root', viaBucket: 'child' },
      { object: obj('G1'), depth: 2, via: 'C1', viaBucket: 'child' },
      { object: obj('G2'), depth: 2, via: 'C1', viaBucket: 'child' },
    ],
    edges: [
      { source: 'root', target: 'P', relationshipType: 'HasParent', bucket: 'parent' },
      { source: 'root', target: 'C1', relationshipType: 'HasChildren', bucket: 'child' },
      { source: 'root', target: 'C2', relationshipType: 'HasChildren', bucket: 'child' },
      { source: 'C1', target: 'G1', relationshipType: 'HasComponent', bucket: 'child' },
      { source: 'C1', target: 'G2', relationshipType: 'HasComponent', bucket: 'child' },
    ],
  }
}

/** A root with `width` children, each holding `depthChildren` of its own. */
function wideGraph(width: number, depthChildren: number): EgoGraph {
  const nodes: EgoGraph['nodes'] = [{ object: obj('root'), depth: 0 }]
  const edges: EgoGraph['edges'] = []

  for (let i = 0; i < width; i++) {
    const id = `C${String(i).padStart(4, '0')}`
    nodes.push({ object: obj(id), depth: 1, via: 'root', viaBucket: 'child' })
    edges.push({ source: 'root', target: id, relationshipType: 'HasChildren', bucket: 'child' })

    for (let j = 0; j < depthChildren; j++) {
      const childId = `${id}_G${j}`
      nodes.push({ object: obj(childId), depth: 2, via: id, viaBucket: 'child' })
      edges.push({
        source: id,
        target: childId,
        relationshipType: 'HasComponent',
        bucket: 'child',
      })
    }
  }

  return { nodes, edges }
}

function build(graph: EgoGraph): EgoTree {
  const tree = buildEgoTree(graph)
  if (!tree) throw new Error('expected a tree')
  return tree
}

describe('buildEgoTree', () => {
  it('nests every walked node under the node it was reached from', () => {
    const tree = build(sampleGraph())

    expect(tree.total).toBe(5)
    expect(tree.direct).toBe(3)
    expect(tree.byId.get('C1')!.children.map(child => child.object.elementId)).toEqual(['G1', 'G2'])
    expect(tree.byId.get('C2')!.children).toEqual([])
  })

  it('groups the direct relationships by type, parent bucket first', () => {
    const tree = build(sampleGraph())

    expect(tree.groups.map(group => group.type)).toEqual(['HasParent', 'HasChildren'])
    expect(tree.groups[1].items.map(item => item.object.elementId)).toEqual(['C1', 'C2'])
  })

  it('counts every descendant, not just the direct children', () => {
    const tree = build(sampleGraph())

    // The count is what a collapsed row promises is inside it, so it has to
    // cover the whole subtree the map draws off that node.
    expect(tree.byId.get('C1')!.descendants).toBe(2)
    expect(tree.byId.get('G1')!.descendants).toBe(0)
  })

  it('takes the relationship type from the edge it was reached through', () => {
    const tree = build(sampleGraph())

    expect(tree.byId.get('G1')!.relationshipType).toBe('HasComponent')
    expect(tree.byId.get('P')!.bucket).toBe('parent')
  })

  it('returns null for a graph with no root', () => {
    expect(buildEgoTree({ nodes: [], edges: [] })).toBeNull()
  })
})

describe('planAutoExpand', () => {
  it('opens the whole walk when it fits the budget', () => {
    const open = planAutoExpand(build(sampleGraph()))

    // C1 is the only node with children, and three level-1 rows leave room for it.
    expect(open.has('C1')).toBe(true)
  })

  it('stops opening once the row budget is spent', () => {
    // 40 children of 40: opening every one would mount 1,640 rows.
    const open = planAutoExpand(build(wideGraph(40, 40)), 200)

    expect(open.size).toBeGreaterThan(0)
    // 40 level-1 rows are already mounted, so only four 40-row blocks fit.
    expect(40 + open.size * 40).toBeLessThanOrEqual(200)
  })

  it('skips a branch too big to fit rather than ending the plan', () => {
    const graph = wideGraph(3, 2)
    // Give the first child a fan-out no budget can take.
    for (let i = 0; i < 500; i++) {
      graph.nodes.push({ object: obj(`huge${i}`), depth: 2, via: 'C0000', viaBucket: 'child' })
      graph.edges.push({
        source: 'C0000',
        target: `huge${i}`,
        relationshipType: 'HasComponent',
        bucket: 'child',
      })
    }

    const open = planAutoExpand(build(graph), 20)

    expect(open.has('C0000')).toBe(false)
    // Its smaller siblings still open: one hub must not close the level.
    expect(open.has('C0001')).toBe(true)
    expect(open.has('C0002')).toBe(true)
  })

  it('never opens a node with no children', () => {
    const open = planAutoExpand(build(sampleGraph()))

    expect(open.has('G1')).toBe(false)
    expect(open.has('P')).toBe(false)
  })
})

describe('filterEgoTree', () => {
  it('returns the tree untouched for empty text', () => {
    const tree = build(sampleGraph())
    const result = filterEgoTree(tree, '  ')

    expect(result.groups).toBe(tree.groups)
    expect(result.open.size).toBe(0)
  })

  it('keeps the branch leading to a deep match and opens it', () => {
    const result = filterEgoTree(build(sampleGraph()), 'G2')

    expect(result.groups.map(group => group.type)).toEqual(['HasChildren'])
    expect(result.groups[0].items.map(item => item.object.elementId)).toEqual(['C1'])
    expect(result.groups[0].items[0].children.map(child => child.object.elementId)).toEqual(['G2'])
    // A match hidden behind a chevron is a match you can't see.
    expect(result.open.has('C1')).toBe(true)
    expect(result.matches).toBe(1)
  })

  it('keeps the whole subtree of a node that matches itself', () => {
    const result = filterEgoTree(build(sampleGraph()), 'C1')

    expect(result.groups[0].items[0].children).toHaveLength(2)
  })

  it('keeps every row under a matching relationship type', () => {
    const result = filterEgoTree(build(sampleGraph()), 'haschildren')

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].items.map(item => item.object.elementId)).toEqual(['C1', 'C2'])
    expect(result.matches).toBe(2)
  })

  it('drops groups with nothing matching', () => {
    const result = filterEgoTree(build(sampleGraph()), 'nothing-here')

    expect(result.groups).toEqual([])
    expect(result.matches).toBe(0)
  })
})
