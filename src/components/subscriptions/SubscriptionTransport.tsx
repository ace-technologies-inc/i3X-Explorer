import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  admittedDeliveries,
  groupByDepth,
  monitoredDepthOf,
  useSubscriptionsStore,
} from '../../stores/subscriptions'
import { bulkRejection, type BulkOutcome } from '../../api/normalize'
import { useConnectionStore } from '../../stores/connection'
import { getClient, type I3XClient } from '../../api/client'
import { SSESubscription, PollingSubscription, HttpStatusError, isSubscriptionGoneError } from '../../api/subscription'
import { performRecovery, type RecoveryHarness } from './recovery'
import type { SyncResponseItem } from '../../api/types'

/**
 * Owns the SSE / polling transport for subscriptions.
 *
 * This lives above the routed views and stays mounted for the life of the app.
 * It used to sit inside the subscriptions panel, which meant collapsing that
 * panel tore down the live stream; now that the subscriptions UI is a tab,
 * unmounting on every tab switch would do the same. The transport logic itself
 * is unchanged, only its mount point moved.
 *
 * Store reads go through `getState()` rather than hook selectors so a live value
 * arriving every second doesn't re-render the whole application tree.
 */

interface SubscriptionTransport {
  /** True when the user chose polling, or the server can't stream. */
  usePolling: boolean
  setUsePolling: (value: boolean) => void
  /** Server declares `capabilities.subscribe.stream === false` (1.0 Release). */
  streamUnsupported: boolean
  startStream: (subscriptionId: string) => Promise<void>
  stopStream: (subscriptionId: string) => void
  deleteSubscription: (subscriptionId: string) => Promise<void>
  /** Unregisters an item on the server but keeps its row and last value. Rejects if the server refuses. */
  stopItem: (subscriptionId: string, elementId: string) => Promise<void>
  /** Registers stopped items again at the depth they were subscribed with. */
  startItems: (subscriptionId: string, elementIds: string[]) => Promise<void>
  /** Unregisters an item on the server (unless already stopped), then drops it. */
  deleteItem: (subscriptionId: string, elementId: string) => Promise<void>
}

const TransportContext = createContext<SubscriptionTransport | null>(null)

export function useSubscriptionTransport(): SubscriptionTransport {
  const context = useContext(TransportContext)
  if (!context) {
    throw new Error('useSubscriptionTransport must be used within <SubscriptionTransportProvider>')
  }
  return context
}

// Servers declare streaming support in /info capabilities;
// when it's false the stream endpoint returns 501 and polling is the only transport.
const isStreamUnsupported = (client: I3XClient): boolean =>
  client.getCapabilities()?.subscribe?.stream === false

export function SubscriptionTransportProvider({ children }: { children: ReactNode }) {
  const isConnected = useConnectionStore(state => state.isConnected)

  const sseRef = useRef<SSESubscription | null>(null)
  const pollingRef = useRef<PollingSubscription | null>(null)
  const recoveryRef = useRef<RecoveryHarness>({ isRecovering: false, attempts: 0, lastSuccessAt: 0 })
  const [usePolling, setUsePolling] = useState(false) // Default to SSE streaming

  // `startStream` reads this synchronously from a ref so a transport switch made
  // in the same tick (the 501 fallback) is honoured immediately.
  const usePollingRef = useRef(usePolling)
  usePollingRef.current = usePolling

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sseRef.current?.disconnect()
      pollingRef.current?.stop()
    }
  }, [])

  // Cleanup when disconnected from server
  useEffect(() => {
    if (!isConnected) {
      sseRef.current?.disconnect()
      sseRef.current = null
      pollingRef.current?.stop()
      pollingRef.current = null
      useSubscriptionsStore.getState().clearAll()
    }
  }, [isConnected])

  const handleDataUpdate = useCallback((subscriptionId: string, items: SyncResponseItem[]) => {
    // Data flowing is the strongest health signal, refund the recovery budget.
    recoveryRef.current.attempts = 0
    const { subscriptions, updateLiveValues } = useSubscriptionsStore.getState()
    updateLiveValues(
      admittedDeliveries(subscriptions.get(subscriptionId), items).map(item => ({
        elementId: item.elementId,
        displayName: item.elementId,
        value: item.value,
        timestamp: item.timestamp,
        quality: item.quality,
      }))
    )
  }, [])

  // Forward declaration: recovery restarts the stream, and the stream's error
  // handler triggers recovery. A ref breaks the cycle.
  const startStreamRef = useRef<(subscriptionId: string) => Promise<void>>()

  // The concurrency rules (re-entrancy guard, transport teardown, item
  // carry-over, attempt budget) live in performRecovery, see recovery.ts.
  const handleRecovery = useCallback(async (oldSubscriptionId: string) => {
    const client = getClient()
    if (!client) return

    await performRecovery(oldSubscriptionId, {
      client,
      stopTransports: () => {
        sseRef.current?.disconnect()
        sseRef.current = null
        pollingRef.current?.stop()
        pollingRef.current = null
      },
      startStream: async id => { await startStreamRef.current?.(id) },
      harness: recoveryRef.current
    })
  }, [])

  const startPolling = useCallback((subscriptionId: string, client: I3XClient) => {
    // Use polling (QoS2) - more reliable, works with CORS
    pollingRef.current = new PollingSubscription(
      () => client.sync(subscriptionId),
      items => handleDataUpdate(subscriptionId, items),
      error => {
        if (isSubscriptionGoneError(error)) {
          handleRecovery(subscriptionId)
        } else {
          console.error('Polling error:', error)
          useSubscriptionsStore.getState().setStreaming(subscriptionId, false)
        }
      },
      2000 // Poll every 2 seconds
    )
    pollingRef.current.start()
  }, [handleDataUpdate, handleRecovery])

  const startStream = useCallback(async (subscriptionId: string) => {
    const client = getClient()
    if (!client) return

    // Disconnect existing connections
    sseRef.current?.disconnect()
    pollingRef.current?.stop()

    if (usePollingRef.current || isStreamUnsupported(client)) {
      if (!usePollingRef.current) setUsePolling(true)
      startPolling(subscriptionId, client)
    } else {
      // Use SSE (QoS0) - real-time but may have CORS issues
      // POST /subscriptions/stream
      const streamConfig = client.getStreamConfig(subscriptionId)
      sseRef.current = new SSESubscription(
        streamConfig.url,
        items => handleDataUpdate(subscriptionId, items),
        error => {
          if (isSubscriptionGoneError(error)) {
            handleRecovery(subscriptionId)
          } else if (error instanceof HttpStatusError && error.status === 501) {
            // 501 = streaming permanently unsupported, fall back to polling
            console.warn('Server does not support SSE streaming (HTTP 501), falling back to polling')
            setUsePolling(true)
            usePollingRef.current = true
            startPolling(subscriptionId, client)
          } else {
            console.error('SSE error:', error)
            useSubscriptionsStore.getState().setStreaming(subscriptionId, false)
          }
        },
        client.getCredentials(),
        streamConfig.postBody,
        // 501 is permanent; don't burn reconnect attempts on it
        [501]
      )
      sseRef.current.connect()
    }

    useSubscriptionsStore.getState().setStreaming(subscriptionId, true)
  }, [handleDataUpdate, handleRecovery, startPolling])

  useEffect(() => {
    startStreamRef.current = startStream
  }, [startStream])

  const stopStream = useCallback((subscriptionId: string) => {
    sseRef.current?.disconnect()
    pollingRef.current?.stop()
    useSubscriptionsStore.getState().setStreaming(subscriptionId, false)
  }, [])

  const deleteSubscription = useCallback(async (subscriptionId: string) => {
    const client = getClient()
    if (!client) return

    // Stop transport first to close timer-fire race window
    sseRef.current?.disconnect()
    sseRef.current = null
    pollingRef.current?.stop()
    pollingRef.current = null

    try {
      useSubscriptionsStore.getState().removeSubscription(subscriptionId)
      await client.deleteSubscription(subscriptionId)
    } catch (err) {
      console.error('Failed to delete subscription:', err)
    }
  }, [])

  const stopItem = useCallback(async (subscriptionId: string, elementId: string) => {
    const client = getClient()
    const sub = useSubscriptionsStore.getState().subscriptions.get(subscriptionId)
    if (!client || !sub) return
    const outcome = await client.unregisterMonitoredItems(subscriptionId, [elementId], monitoredDepthOf(sub, elementId))
    const rejection = bulkRejection(outcome)
    if (rejection) throw rejection
    useSubscriptionsStore.getState().setItemStopped(subscriptionId, elementId, true)
  }, [])

  const startItems = useCallback(async (subscriptionId: string, elementIds: string[]) => {
    const client = getClient()
    const sub = useSubscriptionsStore.getState().subscriptions.get(subscriptionId)
    if (!client || !sub) return
    const rejected: BulkOutcome['rejected'] = []
    for (const [depth, ids] of groupByDepth(sub, elementIds)) {
      const outcome = await client.registerMonitoredItems(subscriptionId, ids, depth)
      outcome.accepted.forEach(id => useSubscriptionsStore.getState().setItemStopped(subscriptionId, id, false))
      rejected.push(...outcome.rejected)
    }
    const rejection = bulkRejection({ accepted: [], rejected })
    if (rejection) throw rejection
  }, [])

  const deleteItem = useCallback(async (subscriptionId: string, elementId: string) => {
    const client = getClient()
    const sub = useSubscriptionsStore.getState().subscriptions.get(subscriptionId)
    if (!client || !sub) return
    if (!sub.stoppedItems?.includes(elementId)) {
      const outcome = await client.unregisterMonitoredItems(subscriptionId, [elementId], monitoredDepthOf(sub, elementId))
      const rejection = bulkRejection(outcome)
      if (rejection) throw rejection
    }
    useSubscriptionsStore.getState().removeMonitoredItem(subscriptionId, elementId)
  }, [])

  const connectedClient = getClient()
  const streamUnsupported = connectedClient ? isStreamUnsupported(connectedClient) : false

  const value = useMemo<SubscriptionTransport>(
    () => ({
      usePolling,
      setUsePolling,
      streamUnsupported,
      startStream,
      stopStream,
      deleteSubscription,
      stopItem,
      startItems,
      deleteItem,
    }),
    [usePolling, streamUnsupported, startStream, stopStream, deleteSubscription, stopItem, startItems, deleteItem]
  )

  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>
}
