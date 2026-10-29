import { describe, expect, it } from 'vitest'
import { parseJsonArrayInBatches } from './jsonArrayBatches'

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

describe('parseJsonArrayInBatches', () => {
  const items = [
    { elementId: 'a', displayName: 'Brace } in [a] "name"', metadata: { nested: [1, { x: '\\"' }] } },
    { elementId: 'b', displayName: 'Ünïcødé ✓', parentId: null },
    { elementId: 'c', isComposition: true, values: [true, false, -1.5e3] },
  ]

  it.each([1, 40, 1_000_000])('parses the result array of an envelope with %i-byte batches', batchBytes => {
    const body = encode(` { "success" : true, "skip": {"result": [9]}, "result" : ${JSON.stringify(items, null, 2)} } `)
    expect(parseJsonArrayInBatches(body, 'result', batchBytes)).toEqual(items)
  })

  it('parses a bare array', () => {
    expect(parseJsonArrayInBatches(encode(JSON.stringify(items)), 'root', 1)).toEqual(items)
  })

  it('parses an empty array', () => {
    expect(parseJsonArrayInBatches(encode('{"result":[ ]}'), 'result', 1)).toEqual([])
  })

  it('returns null when the array is not where it was asked for', () => {
    expect(parseJsonArrayInBatches(encode('{"success":true}'), 'result', 1)).toBeNull()
    expect(parseJsonArrayInBatches(encode('[1]'), 'result', 1)).toBeNull()
    expect(parseJsonArrayInBatches(encode('{"result":[1]}'), 'root', 1)).toBeNull()
  })

  it('rejects a truncated body', () => {
    expect(() => parseJsonArrayInBatches(encode('{"result":[{"a":1},{"b":'), 'result', 1)).toThrow(SyntaxError)
  })
})
