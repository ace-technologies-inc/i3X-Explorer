import { describe, expect, it } from 'vitest'
import { formatAgo } from './liveTime'

describe('formatAgo', () => {
  it.each([
    [0, 'just now'],
    [4_000, 'just now'],
    [12_000, '12s ago'],
    [180_000, '3m ago'],
    [7_200_000, '2h ago'],
  ])('formats %ims as %s', (elapsed, expected) => {
    expect(formatAgo(10_000_000 - elapsed, 10_000_000)).toBe(expected)
  })

  it('treats a receipt slightly in the future as just now', () => {
    expect(formatAgo(1_500, 1_000)).toBe('just now')
  })
})
