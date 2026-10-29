import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_RECOVERY_ATTEMPTS, performRecovery, type RecoveryHarness } from './recovery'
import { useSubscriptionsStore } from '../../stores/subscriptions'

function freshHarness(): RecoveryHarness {
  return { isRecovering: false, attempts: 0, lastSuccessAt: 0 }
}

function seedSubscription(id: string, monitoredItems: string[]) {
  useSubscriptionsStore.getState().addSubscription({
    id,
    createdAt: new Date().toISOString(),
    monitoredItems,
    isStreaming: true,
  })
}

function makeClient(overrides: Partial<Parameters<typeof performRecovery>[1]['client']> = {}) {
  let n = 0
  return {
    createSubscription: vi.fn(async () => ({ subscriptionId: `new-${++n}`, message: '' })),
    deleteSubscription: vi.fn(async (): Promise<void> => {}),
    registerMonitoredItems: vi.fn(async (_id: string, elementIds: string[]) => ({ accepted: elementIds, rejected: [] as Array<{ elementId: string; message: string }> })),
    ...overrides,
  }
}

describe('performRecovery', () => {
  beforeEach(() => {
    useSubscriptionsStore.getState().clearAll()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('carries the monitored items to the replacement subscription', async () => {
    seedSubscription('old', ['a', 'b'])
    const client = makeClient()
    const startStream = vi.fn(async () => {})
    const harness = freshHarness()

    const ok = await performRecovery('old', {
      client,
      stopTransports: vi.fn(),
      startStream,
      harness,
    })

    expect(ok).toBe(true)
    const state = useSubscriptionsStore.getState()
    expect(state.subscriptions.has('old')).toBe(false)
    expect(state.subscriptions.get('new-1')?.monitoredItems).toEqual(['a', 'b'])
    expect(state.activeSubscriptionId).toBe('new-1')
    expect(client.registerMonitoredItems).toHaveBeenCalledWith('new-1', ['a', 'b'], 1)
    expect(startStream).toHaveBeenCalledWith('new-1')
  })

  it('re-registers a composition root at its own depth and keeps its components', async () => {
    useSubscriptionsStore.getState().addSubscription({
      id: 'old',
      createdAt: new Date().toISOString(),
      monitoredItems: ['tp', 'count'],
      isStreaming: true,
      monitoredDepth: { tp: 0, count: 1 },
      components: { tp: ['tp:a', 'tp:b'] },
    })
    const client = makeClient()

    await performRecovery('old', { client, stopTransports: vi.fn(), startStream: vi.fn(async () => {}), harness: freshHarness() })

    expect(client.registerMonitoredItems).toHaveBeenCalledWith('new-1', ['tp'], 0)
    expect(client.registerMonitoredItems).toHaveBeenCalledWith('new-1', ['count'], 1)
    expect(useSubscriptionsStore.getState().subscriptions.get('new-1')?.components).toEqual({ tp: ['tp:a', 'tp:b'] })
  })

  it('lists an item the server rejects on re-register as stopped instead of claiming it is collected', async () => {
    seedSubscription('old', ['a', 'b'])
    const client = makeClient({
      registerMonitoredItems: vi.fn(async (_id: string, elementIds: string[]) => ({
        accepted: elementIds.filter(id => id !== 'b'),
        rejected: [{ elementId: 'b', message: 'b not found' }],
      })),
    })

    await performRecovery('old', { client, stopTransports: vi.fn(), startStream: vi.fn(async () => {}), harness: freshHarness() })

    expect(useSubscriptionsStore.getState().subscriptions.get('new-1')).toMatchObject({
      monitoredItems: ['a', 'b'],
      stoppedItems: ['b'],
    })
  })

  it('keeps stopped items stopped: listed on the replacement, not registered, values kept', async () => {
    useSubscriptionsStore.getState().addSubscription({
      id: 'old',
      createdAt: new Date().toISOString(),
      monitoredItems: ['a', 'b'],
      isStreaming: true,
      stoppedItems: ['b'],
    })
    useSubscriptionsStore.getState().updateLiveValue({ elementId: 'b', displayName: 'b', value: 1, quality: 'Good', timestamp: null })
    const client = makeClient()

    await performRecovery('old', { client, stopTransports: vi.fn(), startStream: vi.fn(async () => {}), harness: freshHarness() })

    expect(client.registerMonitoredItems).toHaveBeenCalledTimes(1)
    expect(client.registerMonitoredItems).toHaveBeenCalledWith('new-1', ['a'], 1)
    const state = useSubscriptionsStore.getState()
    expect(state.subscriptions.get('new-1')).toMatchObject({ monitoredItems: ['a', 'b'], stoppedItems: ['b'] })
    expect(state.liveValues.has('b')).toBe(true)
  })

  it('a concurrent second call is a no-op', async () => {
    seedSubscription('old', ['a'])
    let resolveCreate!: (v: { subscriptionId: string; message: string }) => void
    const client = makeClient({
      createSubscription: vi.fn(
        () => new Promise<{ subscriptionId: string; message: string }>(res => { resolveCreate = res })
      ),
    })
    const stopTransports = vi.fn()
    const harness = freshHarness()
    const deps = { client, stopTransports, startStream: vi.fn(async () => {}), harness }

    const first = performRecovery('old', deps)
    // First call is now parked inside createSubscription; a re-entrant call
    // (e.g. another transport error) must bail out immediately.
    const second = await performRecovery('old', deps)
    expect(second).toBe(false)

    resolveCreate({ subscriptionId: 'new-1', message: '' })
    await expect(first).resolves.toBe(true)
    expect(client.createSubscription).toHaveBeenCalledTimes(1)
    expect(stopTransports).toHaveBeenCalledTimes(1)
  })

  it('honors the attempt cap and stays jammed until the budget is refunded', async () => {
    seedSubscription('old', ['a'])
    const client = makeClient({
      createSubscription: vi.fn(async () => { throw new Error('server down') }),
    })
    const harness = freshHarness()
    const deps = {
      client,
      stopTransports: vi.fn(),
      startStream: vi.fn(async () => {}),
      harness,
      sleep: async () => {},
    }

    await expect(performRecovery('old', deps)).resolves.toBe(false)
    expect(client.createSubscription).toHaveBeenCalledTimes(MAX_RECOVERY_ATTEMPTS)
    expect(harness.attempts).toBe(MAX_RECOVERY_ATTEMPTS)

    // Exhausted budget: another incident must not retry the server…
    await expect(performRecovery('old', deps)).resolves.toBe(false)
    expect(client.createSubscription).toHaveBeenCalledTimes(MAX_RECOVERY_ATTEMPTS)

    // …until data delivery refunds it (the provider does this on each update).
    harness.attempts = 0
    seedSubscription('old2', ['a'])
    const healthy = makeClient()
    await expect(
      performRecovery('old2', { ...deps, client: healthy })
    ).resolves.toBe(true)
  })

  it('refunds the budget on success only when the previous success is old', async () => {
    const client = makeClient()
    const harness = freshHarness()
    let t = 100_000
    const deps = {
      client,
      stopTransports: vi.fn(),
      startStream: vi.fn(async () => {}),
      harness,
      now: () => t,
    }

    // First incident: previous success is ancient → budget refunded.
    seedSubscription('old', ['a'])
    await expect(performRecovery('old', deps)).resolves.toBe(true)
    expect(harness.attempts).toBe(0)
    expect(harness.lastSuccessAt).toBe(100_000)

    // Second incident 10s later (server expiring subs as fast as we recreate
    // them): success must NOT refund, the cap stays reachable.
    t = 110_000
    await expect(performRecovery('new-1', deps)).resolves.toBe(true)
    expect(harness.attempts).toBe(1)
    expect(harness.lastSuccessAt).toBe(110_000)
  })
})
