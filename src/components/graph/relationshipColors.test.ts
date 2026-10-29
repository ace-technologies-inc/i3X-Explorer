import { describe, expect, it } from 'vitest'
import { bucketOf } from './relationshipColors'

// bucketOf drives edge color, list sort order, AND the descend/don't-descend
// decision inside expandEgoGraph, a one-line change to its sets silently
// changes graph topology, so pin every mapping.
describe('bucketOf', () => {
  it('maps upstream relationship types to parent', () => {
    expect(bucketOf('HasParent')).toBe('parent')
    expect(bucketOf('ComponentOf')).toBe('parent')
  })

  it('maps downstream relationship types to child', () => {
    expect(bucketOf('HasChildren')).toBe('child')
    expect(bucketOf('HasComponent')).toBe('child')
    expect(bucketOf('InheritedBy')).toBe('child')
  })

  it('maps InheritsFrom to inherits', () => {
    expect(bucketOf('InheritsFrom')).toBe('inherits')
  })

  it('maps unknown, empty, and missing types to other', () => {
    expect(bucketOf('Monitors')).toBe('other')
    expect(bucketOf('')).toBe('other')
    expect(bucketOf(null)).toBe('other')
    expect(bucketOf(undefined)).toBe('other')
  })
})
