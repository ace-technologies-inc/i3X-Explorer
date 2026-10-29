import { describe, expect, it } from 'vitest'
import { sameJson } from './sameJson'

describe('sameJson', () => {
  it('treats structurally identical values as equal', () => {
    expect(sameJson({ a: 1, b: [1, { c: 'x' }], d: null }, { b: [1, { c: 'x' }], d: null, a: 1 })).toBe(true)
    expect(sameJson([], [])).toBe(true)
  })

  it('detects any difference', () => {
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameJson({ a: undefined }, { b: undefined })).toBe(false)
    expect(sameJson([1, 2], [2, 1])).toBe(false)
    expect(sameJson([], {})).toBe(false)
    expect(sameJson(null, {})).toBe(false)
    expect(sameJson(undefined, [])).toBe(false)
  })
})
