import { describe, expect, it } from 'vitest'
import { FIRST_RING, RING_GAP, layoutRadial } from './radialLayout'
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

function star(childCount: number): EgoGraph {
  const nodes = [{ object: obj('root'), depth: 0 } as EgoGraph['nodes'][number]]
  const edges: EgoGraph['edges'] = []
  for (let i = 0; i < childCount; i++) {
    nodes.push({ object: obj(`c${i}`), depth: 1, via: 'root', viaBucket: 'child' })
    edges.push({ source: 'root', target: `c${i}`, bucket: 'child' })
  }
  return { nodes, edges }
}

describe('layoutRadial', () => {
  it('keeps rings fixed and compact regardless of fan-out', () => {
    const small = layoutRadial(star(4))
    const huge = layoutRadial(star(1500))
    const ringOf = (layout: typeof small, id: string) => {
      const node = layout.nodes.find(n => n.object.elementId === id)!
      return Math.hypot(node.x, node.y)
    }
    expect(ringOf(small, 'c0')).toBeCloseTo(FIRST_RING)
    expect(ringOf(huge, 'c0')).toBeCloseTo(FIRST_RING)
    // The whole point of the redesign: 1,500 children must not inflate the map.
    expect(huge.outerRadius).toBe(small.outerRadius)
  })

  it('spaces successive rings by RING_GAP', () => {
    const graph = star(2)
    graph.nodes.push({ object: obj('g'), depth: 2, via: 'c0', viaBucket: 'child' })
    graph.edges.push({ source: 'c0', target: 'g', bucket: 'child' })
    const layout = layoutRadial(graph)
    expect(layout.rings.map(r => r.radius)).toEqual([FIRST_RING, FIRST_RING + RING_GAP])
    expect(layout.rings.map(r => r.count)).toEqual([2, 1])
  })

  it('gives siblings slots that sum to the full circle and weights heavy subtrees', () => {
    const graph = star(2)
    // c0 carries three grandchildren; c1 is a leaf, c0 must own the wider slot.
    for (let i = 0; i < 3; i++) {
      graph.nodes.push({ object: obj(`g${i}`), depth: 2, via: 'c0', viaBucket: 'child' })
      graph.edges.push({ source: 'c0', target: `g${i}`, bucket: 'child' })
    }
    const layout = layoutRadial(graph)
    const byId = new Map(layout.nodes.map(n => [n.object.elementId, n]))
    const c0 = byId.get('c0')!
    const c1 = byId.get('c1')!
    expect(c0.slot + c1.slot).toBeCloseTo(Math.PI * 2)
    expect(c0.slot).toBeGreaterThan(c1.slot)
    // c0 hands its slot on to its children.
    const grandSlots = ['g0', 'g1', 'g2'].map(id => byId.get(id)!.slot)
    expect(grandSlots.reduce((a, b) => a + b, 0)).toBeCloseTo(c0.slot)
  })

  it('is deterministic', () => {
    const a = layoutRadial(star(40))
    const b = layoutRadial(star(40))
    expect(a).toEqual(b)
  })

  it('computes degree from edges', () => {
    const layout = layoutRadial(star(3))
    const root = layout.nodes.find(n => n.depth === 0)!
    expect(root.degree).toBe(3)
    expect(layout.nodes.find(n => n.object.elementId === 'c1')?.degree).toBe(1)
  })
})
