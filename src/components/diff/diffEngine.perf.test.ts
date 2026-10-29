import { describe, expect, it } from 'vitest'
import { diffCatalogs, topChangedSubtrees, type CatalogSide } from './diffEngine'
import type { ObjectInstance } from '../../api/types'

/**
 * The working-scale budget: two synthetic 100k catalogs, diffed in one go.
 *
 * The repo's precedent is computeModelStats at ~70ms for 100k objects; the
 * diff touches two catalogs, so the target is <200ms for the scalar pass.
 * The assertion is deliberately looser (CI machines vary wildly), the point
 * of this test is the printed number, the assertion only catches a complexity
 * regression (an accidental O(n·m) would blow past 1s by orders of magnitude).
 */

const SCALE = 100_000
const FANOUT = 10

function makeCatalog(size: number): ObjectInstance[] {
  const objects: ObjectInstance[] = new Array(size)
  for (let i = 0; i < size; i++) {
    objects[i] = {
      elementId: `obj-${i}`,
      displayName: `Object ${i}`,
      typeId: `type-${i % 40}`,
      // FANOUT-ary tree: obj-0 is the root, everything else nests under it.
      parentId: i === 0 ? null : `obj-${Math.floor((i - 1) / FANOUT)}`,
      isComposition: i % 3 === 0,
      namespaceUri: `urn:ns-${i % 5}`,
      metadata: { unit: 'C', system: `plant-${i % 50}`, sourceIndex: i },
    }
  }
  return objects
}

function side(objects: ObjectInstance[]): CatalogSide {
  return { objects, objectTypes: [], namespaces: [] }
}

/** Baseline with a realistic mutation mix: removals, adds, and field churn. */
function mutate(baseline: ObjectInstance[]): ObjectInstance[] {
  const current: ObjectInstance[] = []
  for (let i = 0; i < baseline.length; i++) {
    if (i % 100 === 7) continue // 1,000 removed
    const source = baseline[i]
    if (i % 100 === 11) {
      // obj-3's children are i ∈ 31..40, which never hit this residue, every
      // re-parent in this bucket is a real change.
      current.push({ ...source, parentId: 'obj-3' }) // 1,000 re-parented
    } else if (i % 100 === 23) {
      current.push({ ...source, typeId: 'type-new' }) // 1,000 re-typed
    } else if (i % 100 === 31) {
      current.push({ ...source, displayName: `${source.displayName} (renamed)` }) // 1,000 renamed
    } else if (i % 100 === 47) {
      current.push({ ...source, metadata: { ...source.metadata, unit: 'F' } }) // 1,000 metadata-only
    } else {
      current.push(source) // unchanged entries share the object, identity is irrelevant to the diff
    }
  }
  for (let i = 0; i < 1_000; i++) {
    current.push({
      elementId: `new-${i}`,
      displayName: `New ${i}`,
      typeId: 'type-new',
      parentId: 'obj-2',
      isComposition: false,
      namespaceUri: 'urn:ns-0',
    })
  }
  return current
}

describe('diffCatalogs at working scale', () => {
  it(`diffs ${SCALE.toLocaleString()} vs ${SCALE.toLocaleString()} objects within budget`, () => {
    const baseline = makeCatalog(SCALE)
    const current = mutate(baseline)

    const scalarStart = performance.now()
    const diff = diffCatalogs(side(baseline), side(current))
    const scalarMs = performance.now() - scalarStart

    const deepStart = performance.now()
    const deepDiff = diffCatalogs(side(baseline), side(current), { deepCompare: true })
    const deepMs = performance.now() - deepStart

    const baselineIndex = new Map(baseline.map(o => [o.elementId, o]))
    const currentIndex = new Map(current.map(o => [o.elementId, o]))
    const subtreeStart = performance.now()
    const subtrees = topChangedSubtrees(deepDiff, baselineIndex, currentIndex)
    const subtreeMs = performance.now() - subtreeStart

    // The measured numbers are the deliverable; keep them visible in every run.
    console.log(
      `[perf] diff ${SCALE.toLocaleString()}×2: scalar ${scalarMs.toFixed(0)}ms · ` +
        `deep-compare ${deepMs.toFixed(0)}ms · subtree grouping ${subtreeMs.toFixed(0)}ms`
    )

    expect(diff.added).toHaveLength(1_000)
    expect(diff.removed).toHaveLength(1_000)
    expect(diff.reparented).toHaveLength(1_000)
    expect(diff.retyped).toHaveLength(1_000)
    expect(diff.renamed).toHaveLength(1_000)
    expect(diff.metadataOnly).toHaveLength(0) // scalar run: metadata not compared
    expect(deepDiff.metadataOnly).toHaveLength(1_000)
    expect(subtrees.length).toBeGreaterThan(0)

    // Complexity guard, not a benchmark: an O(n·m) regression lands in minutes,
    // not under a second. Real numbers live in the console line above.
    expect(scalarMs).toBeLessThan(1_000)
    expect(deepMs).toBeLessThan(3_000)
  })
})
