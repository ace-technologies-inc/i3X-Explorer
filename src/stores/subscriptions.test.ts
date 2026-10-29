import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  admittedDeliveries,
  groupByDepth,
  isLiveFeed,
  liveSupersedes,
  useSubscriptionsStore,
} from './subscriptions'

const update = (value: unknown) => ({
  elementId: 'pump-1',
  displayName: 'pump-1',
  value,
  timestamp: null,
  quality: 'Good',
})

describe('subscriptions store live values', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSubscriptionsStore.getState().clearAll()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts every update but moves changedAt only when the value changes', () => {
    const { updateLiveValue } = useSubscriptionsStore.getState()

    vi.setSystemTime(1_000)
    updateLiveValue(update(5))
    vi.setSystemTime(2_000)
    updateLiveValue(update(5))

    let live = useSubscriptionsStore.getState().liveValues.get('pump-1')
    expect(live).toMatchObject({ receivedAt: 2_000, changedAt: 1_000, updateCount: 2 })

    vi.setSystemTime(3_000)
    updateLiveValue(update(6))

    live = useSubscriptionsStore.getState().liveValues.get('pump-1')
    expect(live).toMatchObject({ receivedAt: 3_000, changedAt: 3_000, updateCount: 3, value: 6 })
  })

  it('compares structured values by content', () => {
    const { updateLiveValue } = useSubscriptionsStore.getState()

    vi.setSystemTime(1_000)
    updateLiveValue(update({ rpm: 1200 }))
    vi.setSystemTime(2_000)
    updateLiveValue(update({ rpm: 1200 }))

    expect(useSubscriptionsStore.getState().liveValues.get('pump-1')?.changedAt).toBe(1_000)
  })

  it('counts a delivery that repeats value, quality, and source time as a repeat and keeps it off the trend', () => {
    const { updateLiveValue } = useSubscriptionsStore.getState()
    const reading = { ...update(238), timestamp: '2026-10-12T13:01:53Z' }

    vi.setSystemTime(1_000)
    updateLiveValue(reading)
    vi.setSystemTime(3_000)
    updateLiveValue(reading)
    vi.setSystemTime(5_000)
    updateLiveValue(reading)

    const state = useSubscriptionsStore.getState()
    expect(state.liveValues.get('pump-1')).toMatchObject({ repeatCount: 2, freshAt: 1_000, receivedAt: 5_000 })
    expect(state.trendData.get('pump-1')).toHaveLength(1)
  })

  it('treats the same value with a newer source time as fresh, not a repeat', () => {
    const { updateLiveValue } = useSubscriptionsStore.getState()

    vi.setSystemTime(1_000)
    updateLiveValue({ ...update(238), timestamp: '2026-10-12T13:01:53Z' })
    vi.setSystemTime(3_000)
    updateLiveValue({ ...update(238), timestamp: '2026-10-12T13:01:55Z' })

    expect(useSubscriptionsStore.getState().liveValues.get('pump-1')).toMatchObject({ repeatCount: 0, freshAt: 3_000 })
  })

  it('records a monitored item\'s registration depth and components', () => {
    const store = useSubscriptionsStore.getState()
    store.addSubscription({ id: 's', createdAt: '', monitoredItems: [], isStreaming: false })
    store.addMonitoredItem('s', 'tp', { maxDepth: 0, components: ['tp:count', 'tp:last'] })
    store.addMonitoredItem('s', 'plain')

    const sub = useSubscriptionsStore.getState().subscriptions.get('s')!
    expect(sub.monitoredItems).toEqual(['tp', 'plain'])
    expect(sub.monitoredDepth).toEqual({ tp: 0, plain: 1 })
    expect(sub.components).toEqual({ tp: ['tp:count', 'tp:last'] })
  })

  it('keeps a non-numeric string like "1A0" off the trend', () => {
    useSubscriptionsStore.getState().updateLiveValue(update('1A0'))
    expect(useSubscriptionsStore.getState().trendData.get('pump-1')).toBeUndefined()
  })

  it('removing an item drops it, its components and their values, except what another item still delivers', () => {
    const store = useSubscriptionsStore.getState()
    store.addSubscription({ id: 'a', createdAt: '', monitoredItems: [], isStreaming: false })
    store.addSubscription({ id: 'b', createdAt: '', monitoredItems: ['shared'], isStreaming: false })
    store.addMonitoredItem('a', 'line', { maxDepth: 0, components: ['line:count', 'shared'] })
    for (const elementId of ['line', 'line:count', 'shared']) {
      store.updateLiveValue({ ...update(1), elementId })
    }

    store.removeMonitoredItem('a', 'line')

    const state = useSubscriptionsStore.getState()
    const sub = state.subscriptions.get('a')!
    expect(sub.monitoredItems).toEqual([])
    expect(sub.monitoredDepth).toEqual({})
    expect(sub.components).toEqual({})
    expect([...state.liveValues.keys()]).toEqual(['shared'])
    expect([...state.trendData.keys()]).toEqual(['shared'])
  })

  it('applies a delivered batch in one store write, chaining updates to the same element', () => {
    const listener = vi.fn()
    const unsubscribe = useSubscriptionsStore.subscribe(listener)
    useSubscriptionsStore.getState().updateLiveValues([update(1), update(2), { ...update(9), elementId: 'other' }])
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    const state = useSubscriptionsStore.getState()
    expect(state.liveValues.get('pump-1')).toMatchObject({ value: 2, updateCount: 2 })
    expect(state.trendData.get('pump-1')?.map(point => point.value)).toEqual([1, 2])
  })

  it('tracks stopped items, and admits deliveries only for what the subscription still collects', () => {
    const store = useSubscriptionsStore.getState()
    store.addSubscription({ id: 's', createdAt: '', monitoredItems: [], isStreaming: true })
    store.addMonitoredItem('s', 'line', { maxDepth: 0, components: ['line:count', 'shared'] })
    store.addMonitoredItem('s', 'shared')
    store.setItemStopped('s', 'line', true)
    const delivery = ['line', 'line:count', 'shared', 'unlisted'].map(elementId => ({ elementId }))

    let state = useSubscriptionsStore.getState()
    expect(state.subscriptions.get('s')?.stoppedItems).toEqual(['line'])
    expect(admittedDeliveries(state.subscriptions.get('s'), delivery).map(d => d.elementId)).toEqual(['shared'])
    expect(isLiveFeed(state.subscriptions, 'line:count')).toBe(false)
    expect(isLiveFeed(state.subscriptions, 'shared')).toBe(true)

    store.setItemStopped('s', 'line', false)
    state = useSubscriptionsStore.getState()
    expect(admittedDeliveries(state.subscriptions.get('s'), delivery).map(d => d.elementId)).toEqual([
      'line',
      'line:count',
      'shared',
    ])
    expect(isLiveFeed(state.subscriptions, 'line:count')).toBe(true)
  })

  it('drops a delivery that lands after its item was deleted, its subscription deleted, or its transport stopped', () => {
    const store = useSubscriptionsStore.getState()
    store.addSubscription({ id: 's', createdAt: '', monitoredItems: [], isStreaming: true })
    store.addMonitoredItem('s', 'line', { maxDepth: 0, components: ['line:count'] })
    store.addMonitoredItem('s', 'other')
    const late = [{ elementId: 'line' }, { elementId: 'line:count' }, { elementId: 'other' }]

    store.removeMonitoredItem('s', 'line')
    expect(admittedDeliveries(useSubscriptionsStore.getState().subscriptions.get('s'), late)).toEqual([{ elementId: 'other' }])

    store.setStreaming('s', false)
    expect(admittedDeliveries(useSubscriptionsStore.getState().subscriptions.get('s'), late)).toEqual([])
    expect(admittedDeliveries(undefined, late)).toEqual([])
  })

  it('keeps the newer reading when a delayed sample with an older source time arrives', () => {
    const { updateLiveValues } = useSubscriptionsStore.getState()
    updateLiveValues([{ ...update(10), timestamp: '2026-10-12T12:00:10Z' }])
    updateLiveValues([{ ...update(5), timestamp: '2026-10-12T12:00:05Z' }])

    const live = useSubscriptionsStore.getState().liveValues.get('pump-1')
    expect(live).toMatchObject({ value: 10, timestamp: '2026-10-12T12:00:10Z', updateCount: 2 })
    expect(useSubscriptionsStore.getState().trendData.get('pump-1')?.map(p => p.value)).toEqual([10])

    updateLiveValues([{ ...update(7), timestamp: null }])
    expect(useSubscriptionsStore.getState().liveValues.get('pump-1')?.value).toBe(7)
  })

  it('deleting a subscription clears its values unless asked to keep them', () => {
    const store = useSubscriptionsStore.getState()
    store.addSubscription({ id: 'a', createdAt: '', monitoredItems: ['x'], isStreaming: false })
    store.addSubscription({ id: 'b', createdAt: '', monitoredItems: ['y'], isStreaming: false })
    store.updateLiveValues([{ ...update(1), elementId: 'x' }, { ...update(2), elementId: 'y' }])

    store.removeSubscription('b', { keepValues: true })
    expect(useSubscriptionsStore.getState().liveValues.has('y')).toBe(true)
    store.removeSubscription('a')
    expect(useSubscriptionsStore.getState().liveValues.has('x')).toBe(false)
  })
})

describe('liveSupersedes', () => {
  const live = (timestamp: string | null, receivedAt: number) => ({ timestamp, receivedAt })

  it('orders by source time when both readings have one', () => {
    expect(liveSupersedes(live('2026-10-12T12:00:05Z', 9_999), { timestamp: '2026-10-12T12:00:10Z' }, 1)).toBe(false)
    expect(liveSupersedes(live('2026-10-12T12:00:10Z', 1), { timestamp: '2026-10-12T12:00:05Z' }, 9_999)).toBe(true)
  })

  it('falls back to arrival order when either source time is missing', () => {
    expect(liveSupersedes(live(null, 2_000), { timestamp: '2026-10-12T12:00:10Z' }, 1_000)).toBe(true)
    expect(liveSupersedes(live('2026-10-12T12:00:10Z', 500), { timestamp: undefined }, 1_000)).toBe(false)
    expect(liveSupersedes(live(null, 0), undefined, 1_000)).toBe(true)
  })
})

describe('groupByDepth', () => {
  it('groups in insertion order with depth 1 as the default', () => {
    const groups = groupByDepth({ monitoredDepth: { a: 0, c: 0 } }, ['a', 'b', 'c', 'd'])
    expect([...groups]).toEqual([
      [0, ['a', 'c']],
      [1, ['b', 'd']],
    ])
  })

  it('groups a large same-depth list in one bucket', () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `e${i}`)
    expect(groupByDepth({}, ids).get(1)).toEqual(ids)
  })
})
