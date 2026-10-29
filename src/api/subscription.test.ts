import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpStatusError, PollingSubscription, SSESubscription, isSubscriptionGoneError } from './subscription'
import type { SyncResponseItem } from './types'

// Flush chained microtasks (each `await` in the class body consumes one turn).
async function flushMicrotasks(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

// A 200 response whose stream ends immediately, drives the reconnect path.
function endedStreamResponse() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    body: {
      getReader: () => ({
        read: async () => ({ done: true as const, value: undefined }),
      }),
    },
  } as unknown as Response
}

function errorResponse(status: number, statusText: string) {
  return { ok: false, status, statusText, body: null } as unknown as Response
}

describe('SSESubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('disconnect() cancels a pending reconnect, no zombie fetch after deletion', async () => {
    const fetchStub = vi.fn(async () => endedStreamResponse())
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError)

    sub.connect()
    await flushMicrotasks()
    // Stream ended → a reconnect timer is now pending.
    expect(fetchStub).toHaveBeenCalledTimes(1)

    sub.disconnect()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('connect() while a reconnect is pending leaves exactly one live loop', async () => {
    const fetchStub = vi.fn(async () => endedStreamResponse())
    vi.stubGlobal('fetch', fetchStub)
    const sub = new SSESubscription('http://server/stream', vi.fn(), vi.fn())

    sub.connect()
    await flushMicrotasks()
    expect(fetchStub).toHaveBeenCalledTimes(1) // first loop ended, timer pending

    sub.connect() // supersedes: must cancel the pending timer
    await flushMicrotasks()
    expect(fetchStub).toHaveBeenCalledTimes(2) // second loop only

    // Advance past the first loop's reconnect delay: only the second loop's own
    // reconnect (also 1000ms, attempts were reset) may fire, one fetch, not two.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchStub).toHaveBeenCalledTimes(3)

    sub.disconnect()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(3)
  })

  it('404 fails fast to onError without entering the reconnect loop', async () => {
    const fetchStub = vi.fn(async () => errorResponse(404, 'Not Found'))
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError)

    sub.connect()
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0] as HttpStatusError
    expect(err).toBeInstanceOf(HttpStatusError)
    expect(err.status).toBe(404)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a 2xx JSON failure envelope with status 404 fails fast like a real 404', async () => {
    const body = { success: false, result: null, responseDetail: { title: 'Not Found', status: 404, detail: 'gone' } }
    const fetchStub = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => body,
    }) as unknown as Response)
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError)

    sub.connect()
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0] as HttpStatusError
    expect(err).toBeInstanceOf(HttpStatusError)
    expect(err.status).toBe(404)
    expect(isSubscriptionGoneError(err)).toBe(true)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a JSON reply that is not an event stream fails fast instead of reconnecting forever', async () => {
    const fetchStub = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ success: true, result: [] }),
    }) as unknown as Response)
    vi.stubGlobal('fetch', fetchStub)
    const onError = vi.fn()
    const sub = new SSESubscription('http://server/stream', vi.fn(), onError)

    sub.connect()
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })
})

describe('PollingSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never stacks concurrent syncs when the server is slower than the interval', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    const syncFn = (): Promise<SyncResponseItem[]> => {
      calls++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise(resolve =>
        setTimeout(() => {
          inFlight--
          resolve([])
        }, 5000)
      )
    }
    const poller = new PollingSubscription(syncFn, vi.fn(), vi.fn(), 2000)

    poller.start()
    await vi.advanceTimersByTimeAsync(30_000)

    // Each cycle is 5000ms sync + 2000ms wait: starts at 0, 7000, 14000, 21000, 28000.
    expect(maxInFlight).toBe(1)
    expect(calls).toBe(5)
    poller.stop()
  })

  it('stop() mid-flight suppresses the late result and stops the chain', async () => {
    const onData = vi.fn()
    let calls = 0
    const syncFn = (): Promise<SyncResponseItem[]> => {
      calls++
      return new Promise(resolve =>
        setTimeout(() => resolve([{ elementId: 'x', value: 1, quality: null, timestamp: null }]), 5000)
      )
    }
    const poller = new PollingSubscription(syncFn, onData, vi.fn(), 2000)

    poller.start()
    await vi.advanceTimersByTimeAsync(1000)
    poller.stop()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(calls).toBe(1)
    expect(onData).not.toHaveBeenCalled()
    expect(poller.isRunning()).toBe(false)
  })

  it('a failing sync reports onError and the chain continues', async () => {
    const onError = vi.fn()
    const syncFn = vi.fn(async (): Promise<SyncResponseItem[]> => {
      throw new Error('sync failed')
    })
    const poller = new PollingSubscription(syncFn, vi.fn(), onError, 2000)

    poller.start()
    await vi.advanceTimersByTimeAsync(6000)

    // t = 0, 2000, 4000, 6000.
    expect(syncFn).toHaveBeenCalledTimes(4)
    expect(onError).toHaveBeenCalledTimes(4)
    poller.stop()
  })
})
