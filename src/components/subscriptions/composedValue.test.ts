import { describe, expect, it } from 'vitest'
import type { LastKnownValue } from '../../api/types'
import type { LiveValue } from '../../stores/subscriptions'
import { composeCurrentValue } from './composedValue'

const base = { elementId: 'line', parentId: null, namespaceUri: 'urn:x' }

const fetched: LastKnownValue = {
  ...base,
  value: { state: 'Run' },
  quality: 'Good',
  timestamp: '2026-10-12T12:00:10Z',
  components: {
    'line:count': { value: 1, quality: 'Good', timestamp: '2026-10-12T12:00:10Z' },
    'line:mode': { value: 'Auto', quality: 'Good', timestamp: '2026-10-12T12:00:10Z' },
  },
  rawResponse: { success: true },
}

function live(elementId: string, value: unknown, timestamp: string | null, receivedAt = 5_000): LiveValue {
  return {
    elementId,
    displayName: elementId,
    value,
    quality: 'Good',
    timestamp,
    receivedAt,
    changedAt: receivedAt,
    updateCount: 1,
    changes: [],
    repeatCount: 0,
    freshAt: receivedAt,
  }
}

const lookup = (...entries: LiveValue[]) => (id: string) => entries.find(entry => entry.elementId === id)

describe('composeCurrentValue', () => {
  it('returns the read unchanged when nothing live supersedes it', () => {
    const result = composeCurrentValue(fetched, base, lookup(), 1_000)
    expect(result.value).toBe(fetched)
    expect(result.overlaid).toEqual([])
    expect(result.rootIsLive).toBe(false)
  })

  it('keeps both components when a later root update arrives, with their live readings laid over', () => {
    const result = composeCurrentValue(
      fetched,
      base,
      lookup(
        live('line', { state: 'Stop' }, '2026-10-12T12:00:20Z'),
        live('line:count', 2, '2026-10-12T12:00:20Z')
      ),
      1_000
    )
    expect(result.rootIsLive).toBe(true)
    expect(result.value?.value).toEqual({ state: 'Stop' })
    expect(result.value?.components).toEqual({
      'line:count': { value: 2, quality: 'Good', timestamp: '2026-10-12T12:00:20Z' },
      'line:mode': fetched.components!['line:mode'],
    })
    expect(result.value?.rawResponse).toBeUndefined()
  })

  it('applies a component-only update without touching the root', () => {
    const result = composeCurrentValue(fetched, base, lookup(live('line:mode', 'Manual', '2026-10-12T12:00:20Z')), 1_000)
    expect(result.rootIsLive).toBe(false)
    expect(result.value?.value).toEqual({ state: 'Run' })
    expect(result.value?.components?.['line:mode'].value).toBe('Manual')
  })

  it('does not promote a delayed sample older than the fresh read, even though it arrived later', () => {
    const result = composeCurrentValue(
      fetched,
      base,
      lookup(live('line', { state: 'Old' }, '2026-10-12T12:00:05Z', 9_000), live('line:count', 0, '2026-10-12T12:00:05Z', 9_000)),
      1_000
    )
    expect(result.value).toBe(fetched)
  })

  it('falls back to arrival order when a reading has no source time', () => {
    const result = composeCurrentValue(fetched, base, lookup(live('line', { state: 'Stop' }, null, 2_000)), 1_000)
    expect(result.rootIsLive).toBe(true)
    expect(composeCurrentValue(fetched, base, lookup(live('line', { state: 'Stop' }, null, 500)), 1_000).rootIsLive).toBe(false)
  })

  it('shows the live root alone when nothing was read over HTTP', () => {
    const result = composeCurrentValue(null, base, lookup(live('line', 7, '2026-10-12T12:00:20Z')), 0)
    expect(result.value).toMatchObject({ elementId: 'line', value: 7, quality: 'Good' })
    expect(result.value?.components).toBeUndefined()
  })
})
