import { describe, expect, it } from 'vitest'
import { asStructured, describeStructure, diffValues, numericDelta, toFiniteNumber } from './structuredValue'

describe('toFiniteNumber', () => {
  it('reads numbers and numeric strings, and nothing else', () => {
    expect(toFiniteNumber(238)).toBe(238)
    expect(toFiniteNumber(' 4.5 ')).toBe(4.5)
    expect(toFiniteNumber('1A0')).toBeUndefined()
    expect(toFiniteNumber('')).toBeUndefined()
    expect(toFiniteNumber({ count: 1 })).toBeUndefined()
  })
})

const changedPaths = (a: unknown, b: unknown, limit?: number) =>
  diffValues(a, b, limit).map(change => change.path)

describe('diffValues', () => {
  it('carries the previous and new value of each change', () => {
    expect(diffValues({ count: 237, code: 'A0' }, { count: 238, code: 'A0' })).toEqual([
      { path: 'count', before: 237, after: 238 },
    ])
    expect(diffValues(1, 2)).toEqual([{ path: '(value)', before: 1, after: 2 }])
  })

  it('lists the leaf paths that differ, ignoring key order', () => {
    const before = { location: { zone: 'A0', label: 'Z1' }, serial: 'X1' }
    const after = { serial: 'X2', location: { label: 'Z1', zone: 'A1' } }
    expect(changedPaths(before, after)).toEqual(['location.zone', 'serial'])
  })

  it('is empty for deeply equal values', () => {
    expect(changedPaths({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([])
  })

  it('indexes array elements and reports added or removed keys', () => {
    expect(changedPaths({ readings: [1, 2] }, { readings: [1, 3], extra: true })).toEqual([
      'readings[1]',
      'extra',
    ])
  })

  it('compares a JSON string value by its content', () => {
    expect(changedPaths('{"a":1,"b":2}', { b: 2, a: 1 })).toEqual([])
    expect(changedPaths('{"a":1}', '{"a":2}')).toEqual(['a'])
  })

  it('reports a changed scalar as (value)', () => {
    expect(changedPaths(1, 2)).toEqual(['(value)'])
  })

  it('readings at the limit', () => {
    const before = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]))
    const after = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i + 1]))
    expect(changedPaths(before, after, 5)).toHaveLength(5)
  })
})

describe('numericDelta', () => {
  it('subtracts numbers and numeric strings, and skips anything else', () => {
    expect(numericDelta(237, 238)).toBe(1)
    expect(numericDelta('10.5', 10)).toBe(-0.5)
    expect(numericDelta('A0', 'A1')).toBeUndefined()
    expect(numericDelta('', 1)).toBeUndefined()
  })
})

describe('describeStructure', () => {
  it('summarizes objects and arrays', () => {
    expect(describeStructure({ a: 1, b: 2 })).toBe('{…} 2 fields')
    expect(describeStructure([1])).toBe('[…] 1 item')
  })

  it('treats scalars and plain text as unstructured', () => {
    expect(asStructured(238)).toBeUndefined()
    expect(asStructured('1A0')).toBeUndefined()
    expect(asStructured('[1,2]')).toEqual([1, 2])
  })
})
