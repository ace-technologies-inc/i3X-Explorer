import { describe, expect, it } from 'vitest'
import { computeModelStats, topBy, withOther } from './modelStats'
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

describe('computeModelStats', () => {
  it('counts an orphan as both a root and an orphan, at depth 0', () => {
    // R is a true root, O names a parent outside the catalog, C sits under R.
    // The card and the depth histogram must agree: roots === byDepth[0].count.
    const stats = computeModelStats(
      [obj('R'), obj('O', { parentId: 'missing' }), obj('C', { parentId: 'R' })],
      [],
      1
    )
    expect(stats.roots).toBe(2)
    expect(stats.orphans).toBe(1)
    expect(stats.links).toBe(1)
    expect(stats.byDepth[0]).toMatchObject({ label: 'Root', count: 2 })
    expect(stats.byDepth[1]).toMatchObject({ label: 'Level 1', count: 1 })
    expect(stats.roots).toBe(stats.byDepth[0].count)
  })

  it('terminates on a parentId cycle instead of recursing forever', () => {
    const stats = computeModelStats(
      [obj('A', { parentId: 'B' }), obj('B', { parentId: 'A' })],
      [],
      1
    )
    // The cycle entry point is treated as depth 0; the walk must simply finish.
    expect(stats.objects).toBe(2)
    expect(Number.isFinite(stats.maxDepth)).toBe(true)
  })

  it('tallies untyped objects and declared-but-unused types', () => {
    const stats = computeModelStats(
      [obj('A', { typeId: '' })],
      [
        { elementId: 'T', displayName: 'T', namespaceUri: 'urn:ns', schema: {} },
        { elementId: 'Unused', displayName: 'Unused', namespaceUri: 'urn:ns', schema: {} },
      ],
      1
    )
    expect(stats.untyped).toBe(1)
    expect(stats.unusedTypes).toBe(2)
  })

  it('computes fan-out over more parents than a call can take arguments', () => {
    const parents = 300_000
    const objects: ObjectInstance[] = []
    for (let i = 0; i < parents; i++) {
      objects.push(obj(`P${i}`), obj(`C${i}`, { parentId: `P${i}` }))
    }
    objects.push(obj('Cx', { parentId: 'P0' }))
    const stats = computeModelStats(objects, [], 1)
    expect(stats.maxFanout).toBe(2)
    expect(stats.avgFanout).toBeCloseTo((parents + 1) / parents)
  })
})

describe('topBy', () => {
  it('matches a full sort for the top N, descending', () => {
    const items = [5, 3, 9, 1, 7, 7, 2, 8, 0, 6, 4]
    const expected = [...items].sort((a, b) => b - a).slice(0, 8)
    expect(topBy(items, n => n, 8)).toEqual(expected)
  })

  it('returns everything (sorted) when there are fewer items than the limit', () => {
    expect(topBy([2, 9, 4], n => n, 8)).toEqual([9, 4, 2])
  })

  it('handles ties without dropping items', () => {
    expect(topBy([3, 3, 3, 1], n => n, 3)).toEqual([3, 3, 3])
  })
})

describe('withOther', () => {
  it('folds the tail into an Other row', () => {
    const tallies = [
      { key: 'a', label: 'a', count: 10 },
      { key: 'b', label: 'b', count: 5 },
      { key: 'c', label: 'c', count: 3 },
      { key: 'd', label: 'd', count: 2 },
    ]
    const folded = withOther(tallies, 2)
    expect(folded).toHaveLength(3)
    expect(folded[2]).toMatchObject({ label: 'Other (2)', count: 5, isOther: true })
  })

  it('returns the list unchanged when it fits', () => {
    const tallies = [{ key: 'a', label: 'a', count: 1 }]
    expect(withOther(tallies, 8)).toBe(tallies)
  })
})
