import { describe, expect, it } from 'vitest'
import {
  diffCatalogs,
  stableStringify,
  topChangedSubtrees,
  type CatalogSide,
} from './diffEngine'
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

function side(objects: ObjectInstance[], over: Partial<CatalogSide> = {}): CatalogSide {
  return { objects, objectTypes: [], namespaces: [], ...over }
}

function index(objects: ObjectInstance[]): Map<string, ObjectInstance> {
  return new Map(objects.map(o => [o.elementId, o]))
}

describe('diffCatalogs', () => {
  it('reports an empty diff as identical', () => {
    const diff = diffCatalogs(side([]), side([]))
    expect(diff.identical).toBe(true)
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toEqual([])
  })

  it('finds nothing when both sides are the same catalog', () => {
    const objects = [obj('A'), obj('B', { parentId: 'A' })]
    const diff = diffCatalogs(side(objects), side(objects.map(o => ({ ...o }))))
    expect(diff.identical).toBe(true)
  })

  it('splits added and removed by elementId identity', () => {
    const diff = diffCatalogs(side([obj('kept'), obj('gone')]), side([obj('kept'), obj('new')]))
    expect(diff.added).toEqual(['new'])
    expect(diff.removed).toEqual(['gone'])
    expect(diff.changed).toEqual([])
    expect(diff.identical).toBe(false)
  })

  it('categorizes each scalar field change separately', () => {
    const baseline = side([
      obj('rp', { parentId: 'P1' }),
      obj('rt', { typeId: 'T1' }),
      obj('rn', { displayName: 'Old name' }),
      obj('mv', { namespaceUri: 'urn:a' }),
    ])
    const current = side([
      obj('rp', { parentId: 'P2' }),
      obj('rt', { typeId: 'T2' }),
      obj('rn', { displayName: 'New name' }),
      obj('mv', { namespaceUri: 'urn:b' }),
    ])
    const diff = diffCatalogs(baseline, current)

    expect(diff.reparented.map(c => c.elementId)).toEqual(['rp'])
    expect(diff.reparented[0].parentId).toEqual({ from: 'P1', to: 'P2' })
    expect(diff.retyped.map(c => c.elementId)).toEqual(['rt'])
    expect(diff.retyped[0].typeId).toEqual({ from: 'T1', to: 'T2' })
    expect(diff.renamed.map(c => c.elementId)).toEqual(['rn'])
    expect(diff.renamed[0].displayName).toEqual({ from: 'Old name', to: 'New name' })
    expect(diff.movedNamespace.map(c => c.elementId)).toEqual(['mv'])
    expect(diff.movedNamespace[0].namespaceUri).toEqual({ from: 'urn:a', to: 'urn:b' })
    expect(diff.changed).toHaveLength(4)
  })

  it('puts one object with every field changed at once into every category, as one entry', () => {
    const baseline = side([
      obj('X', { parentId: 'P1', typeId: 'T1', displayName: 'One', namespaceUri: 'urn:a' }),
    ])
    const current = side([
      obj('X', { parentId: 'P2', typeId: 'T2', displayName: 'Two', namespaceUri: 'urn:b' }),
    ])
    const diff = diffCatalogs(baseline, current)

    expect(diff.changed).toHaveLength(1)
    const change = diff.changed[0]
    expect(change.parentId).toEqual({ from: 'P1', to: 'P2' })
    expect(change.typeId).toEqual({ from: 'T1', to: 'T2' })
    expect(change.displayName).toEqual({ from: 'One', to: 'Two' })
    expect(change.namespaceUri).toEqual({ from: 'urn:a', to: 'urn:b' })
    // Category lists hold references to the same entry, not copies.
    expect(diff.reparented[0]).toBe(change)
    expect(diff.retyped[0]).toBe(change)
    expect(diff.renamed[0]).toBe(change)
    expect(diff.movedNamespace[0]).toBe(change)
  })

  it("treats '', '/', null and undefined parentId as the same non-parent", () => {
    const baseline = side([obj('A', { parentId: '' }), obj('B', { parentId: '/' })])
    const current = side([obj('A', { parentId: null }), obj('B', { parentId: null })])
    expect(diffCatalogs(baseline, current).identical).toBe(true)
  })

  it('diffs types and namespaces by id', () => {
    const baseline = side([], {
      objectTypes: [
        { elementId: 'T-old', displayName: 'Old', namespaceUri: 'urn:ns', schema: {} },
        { elementId: 'T-kept', displayName: 'Kept', namespaceUri: 'urn:ns', schema: {} },
      ],
      namespaces: [{ uri: 'urn:gone', displayName: 'Gone' }],
    })
    const current = side([], {
      objectTypes: [
        { elementId: 'T-kept', displayName: 'Kept', namespaceUri: 'urn:ns', schema: {} },
        { elementId: 'T-new', displayName: 'New', namespaceUri: 'urn:ns', schema: {} },
      ],
      namespaces: [{ uri: 'urn:new', displayName: 'New' }],
    })
    const diff = diffCatalogs(baseline, current)
    expect(diff.typesAdded).toEqual(['T-new'])
    expect(diff.typesRemoved).toEqual(['T-old'])
    expect(diff.namespacesAdded).toEqual(['urn:new'])
    expect(diff.namespacesRemoved).toEqual(['urn:gone'])
    expect(diff.identical).toBe(false)
  })

  it('counts duplicate elementIds per side, last entry winning', () => {
    const baseline = side([obj('D', { displayName: 'first' }), obj('D', { displayName: 'second' })])
    const current = side([obj('D', { displayName: 'second' })])
    const diff = diffCatalogs(baseline, current)
    // The second baseline entry won, so the object compares equal, duplicates
    // are surfaced in their own counter, they don't fabricate differences.
    expect(diff.identical).toBe(true)
    expect(diff.changed).toEqual([])
    expect(diff.duplicates).toEqual({ baseline: 1, current: 0 })
    expect(diff.baselineCount).toBe(1)
    expect(diff.currentCount).toBe(1)
  })

  it('reuses a caller-provided objectIndex instead of rebuilding it', () => {
    const objects = [obj('A'), obj('B')]
    const prebuilt = index(objects)
    const diff = diffCatalogs(side([obj('A')]), side(objects, { objectIndex: prebuilt }))
    expect(diff.added).toEqual(['B'])
  })

  describe('deep compare', () => {
    it('is off by default: metadata-only changes are invisible', () => {
      const baseline = side([obj('A', { metadata: { unit: 'C' } })])
      const current = side([obj('A', { metadata: { unit: 'F' } })])
      expect(diffCatalogs(baseline, current).identical).toBe(true)
    })

    it('flags metadata-only and schemaExtensions-only changes when enabled', () => {
      const baseline = side([
        obj('meta', { metadata: { unit: 'C' } }),
        obj('ext', { schemaExtensions: { a: 1 } }),
        obj('same', { metadata: { unit: 'C' } }),
      ])
      const current = side([
        obj('meta', { metadata: { unit: 'F' } }),
        obj('ext', { schemaExtensions: { a: 2 } }),
        obj('same', { metadata: { unit: 'C' } }),
      ])
      const diff = diffCatalogs(baseline, current, { deepCompare: true })
      expect(diff.metadataOnly.map(c => c.elementId).sort()).toEqual(['ext', 'meta'])
      expect(diff.metadataOnly.every(c => c.metadataOnly)).toBe(true)
      expect(diff.deepCompared).toBe(true)
    })

    it('ignores key order in metadata', () => {
      const baseline = side([obj('A', { metadata: { a: 1, b: { x: 1, y: 2 } } })])
      const current = side([obj('A', { metadata: { b: { y: 2, x: 1 }, a: 1 } })])
      expect(diffCatalogs(baseline, current, { deepCompare: true }).identical).toBe(true)
    })

    it('skips the metadata comparison for objects that already changed a scalar', () => {
      const baseline = side([obj('A', { displayName: 'Old', metadata: { unit: 'C' } })])
      const current = side([obj('A', { displayName: 'New', metadata: { unit: 'F' } })])
      const diff = diffCatalogs(baseline, current, { deepCompare: true })
      // Renamed, yes, but not double-reported as a metadata change.
      expect(diff.renamed).toHaveLength(1)
      expect(diff.metadataOnly).toHaveLength(0)
    })
  })
})

describe('stableStringify', () => {
  it('is insensitive to key order at every level', () => {
    expect(stableStringify({ b: [1, { z: 1, a: 2 }], a: 'x' })).toBe(
      stableStringify({ a: 'x', b: [1, { a: 2, z: 1 }] })
    )
  })

  it('distinguishes genuinely different values', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }))
    expect(stableStringify(null)).not.toBe(stableStringify({}))
  })
})

describe('topChangedSubtrees', () => {
  it('groups adds and changes under their current-side root, removals under the baseline root', () => {
    // Baseline: rootA > gone1, gone2 ; current: rootB > new1, and changed1 under rootB.
    const baselineObjects = [
      obj('rootA'),
      obj('gone1', { parentId: 'rootA' }),
      obj('gone2', { parentId: 'rootA' }),
      obj('rootB'),
      obj('changed1', { parentId: 'rootB', displayName: 'Old' }),
    ]
    const currentObjects = [
      obj('rootB'),
      obj('new1', { parentId: 'rootB' }),
      obj('changed1', { parentId: 'rootB', displayName: 'New' }),
    ]
    const diff = diffCatalogs(side(baselineObjects), side(currentObjects))
    const subtrees = topChangedSubtrees(diff, index(baselineObjects), index(currentObjects))

    // rootA: gone1, gone2 and rootA itself removed = 3; rootB: new1 added + changed1 = 2.
    expect(subtrees[0]).toMatchObject({ rootId: 'rootA', side: 'baseline', changes: 3 })
    expect(subtrees[1]).toMatchObject({ rootId: 'rootB', side: 'current', changes: 2 })
  })

  it('keeps only the top N roots by change count', () => {
    const currentObjects: ObjectInstance[] = []
    for (let root = 0; root < 12; root++) {
      currentObjects.push(obj(`root${root}`))
      for (let child = 0; child <= root; child++) {
        currentObjects.push(obj(`r${root}c${child}`, { parentId: `root${root}` }))
      }
    }
    const diff = diffCatalogs(side([]), side(currentObjects))
    const subtrees = topChangedSubtrees(diff, new Map(), index(currentObjects), 3)
    expect(subtrees.map(s => s.rootId)).toEqual(['root11', 'root10', 'root9'])
    expect(subtrees[0].changes).toBe(13) // root11 + its 12 children
  })

  it('terminates on a parentId cycle and treats the entry point as the root', () => {
    const currentObjects = [obj('A', { parentId: 'B' }), obj('B', { parentId: 'A' })]
    const diff = diffCatalogs(side([]), side(currentObjects))
    const subtrees = topChangedSubtrees(diff, new Map(), index(currentObjects))
    expect(subtrees.reduce((sum, s) => sum + s.changes, 0)).toBe(2)
  })

  it('treats an orphan as its own root', () => {
    const currentObjects = [obj('O', { parentId: 'not-here' })]
    const diff = diffCatalogs(side([]), side(currentObjects))
    const subtrees = topChangedSubtrees(diff, new Map(), index(currentObjects))
    expect(subtrees).toHaveLength(1)
    expect(subtrees[0].rootId).toBe('O')
  })
})
