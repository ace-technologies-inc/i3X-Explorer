import { useEffect, useRef, useState } from 'react'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { getClient } from '../../api/client'
import { SSESubscription, PollingSubscription } from '../../api/subscription'
import { TrendView } from './TrendView'
import type { SyncResponseItem } from '../../api/types'

export function SubscriptionPanel() {
  const {
    subscriptions,
    liveValues,
    activeSubscriptionId,
    setActiveSubscription,
    removeSubscription,
    updateLiveValue,
    setStreaming
  } = useSubscriptionsStore()

  const sseRef = useRef<SSESubscription | null>(null)
  const pollingRef = useRef<PollingSubscription | null>(null)
  const [usePolling, setUsePolling] = useState(false) // Default to SSE streaming

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sseRef.current?.disconnect()
      pollingRef.current?.stop()
    }
  }, [])

  const handleDataUpdate = (items: SyncResponseItem[]) => {
    items.forEach((item) => {
      updateLiveValue({
        elementId: item.elementId,
        displayName: item.elementId,
        value: item.value,
        timestamp: item.timestamp,
        quality: item.quality,
        lastUpdated: Date.now()
      })
    })
  }

  const handleStartStream = async (subscriptionId: string) => {
    const client = getClient()
    if (!client) return

    // Disconnect existing connections
    sseRef.current?.disconnect()
    pollingRef.current?.stop()

    if (usePolling) {
      // Use polling (QoS2) - more reliable, works with CORS
      pollingRef.current = new PollingSubscription(
        () => client.sync(subscriptionId),
        handleDataUpdate,
        (error) => {
          console.error('Polling error:', error)
          setStreaming(subscriptionId, false)
        },
        2000 // Poll every 2 seconds
      )
      pollingRef.current.start()
    } else {
      // Use SSE (QoS0) - real-time but may have CORS issues
      const streamUrl = client.getStreamUrl(subscriptionId)
      sseRef.current = new SSESubscription(
        streamUrl,
        handleDataUpdate,
        (error) => {
          console.error('SSE error:', error)
          setStreaming(subscriptionId, false)
        }
      )
      sseRef.current.connect()
    }

    setStreaming(subscriptionId, true)
  }

  const handleStopStream = (subscriptionId: string) => {
    sseRef.current?.disconnect()
    pollingRef.current?.stop()
    setStreaming(subscriptionId, false)
  }

  const handleDelete = async (subscriptionId: string) => {
    const client = getClient()
    if (!client) return

    try {
      await client.deleteSubscription(subscriptionId)
      if (subscriptions.get(subscriptionId)?.isStreaming) {
        sseRef.current?.disconnect()
      }
      removeSubscription(subscriptionId)
    } catch (err) {
      console.error('Failed to delete subscription:', err)
    }
  }

  const subscriptionList = Array.from(subscriptions.values())

  if (subscriptionList.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-i3x-text-muted text-sm">
        No active subscriptions. Select an object and click "Subscribe" to start monitoring.
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex gap-4">
        {/* Subscription list */}
        <div className="w-48 space-y-2">
          <h3 className="text-xs font-medium text-i3x-text-muted uppercase">Subscriptions</h3>
          {subscriptionList.map((sub) => (
            <div
              key={sub.id}
              className={`p-2 rounded cursor-pointer transition-colors ${
                activeSubscriptionId === sub.id
                  ? 'bg-i3x-primary/20 border border-i3x-primary'
                  : 'bg-i3x-bg hover:bg-i3x-border'
              }`}
              onClick={() => setActiveSubscription(sub.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-i3x-text truncate">#{sub.id}</span>
                <div className="flex items-center gap-1">
                  {sub.isStreaming && (
                    <span className="w-2 h-2 rounded-full bg-i3x-success animate-pulse" />
                  )}
                </div>
              </div>
              <div className="text-xs text-i3x-text-muted mt-1">
                {sub.monitoredItems.length} items
              </div>
            </div>
          ))}
        </div>

        {/* Active subscription details */}
        {activeSubscriptionId && subscriptions.get(activeSubscriptionId) && (
          <div className="flex-1 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-i3x-text">
                Subscription #{activeSubscriptionId}
              </h3>
              <div className="flex items-center gap-2">
                {/* Polling/SSE toggle */}
                <label className="flex items-center gap-1 text-xs text-i3x-text-muted">
                  <input
                    type="checkbox"
                    checked={usePolling}
                    onChange={(e) => setUsePolling(e.target.checked)}
                    disabled={subscriptions.get(activeSubscriptionId)?.isStreaming}
                    className="w-3 h-3"
                  />
                  Poll
                </label>
                {!subscriptions.get(activeSubscriptionId)?.isStreaming ? (
                  <button
                    onClick={() => handleStartStream(activeSubscriptionId)}
                    className="px-3 py-1 text-xs bg-i3x-success/20 text-i3x-success rounded hover:bg-i3x-success/30 transition-colors"
                  >
                    Start {usePolling ? 'Polling' : 'Stream'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleStopStream(activeSubscriptionId)}
                    className="px-3 py-1 text-xs bg-i3x-warning/20 text-i3x-warning rounded hover:bg-i3x-warning/30 transition-colors"
                  >
                    Stop
                  </button>
                )}
                <button
                  onClick={() => handleDelete(activeSubscriptionId)}
                  className="px-3 py-1 text-xs bg-i3x-error/20 text-i3x-error rounded hover:bg-i3x-error/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Live values */}
            <div className="grid grid-cols-2 gap-2 max-h-32 overflow-auto">
              {subscriptions.get(activeSubscriptionId)?.monitoredItems.map((elementId) => {
                const liveValue = liveValues.get(elementId)
                return (
                  <div
                    key={elementId}
                    className="p-2 bg-i3x-bg rounded text-xs"
                  >
                    <div className="text-i3x-text-muted truncate mb-1" title={elementId}>
                      {elementId}
                    </div>
                    {liveValue ? (
                      <div className="text-i3x-text">
                        <span className="font-mono">
                          {typeof liveValue.value === 'object'
                            ? JSON.stringify(liveValue.value).slice(0, 50)
                            : String(liveValue.value)}
                        </span>
                        {liveValue.timestamp && (
                          <span className="text-i3x-text-muted ml-2">
                            {new Date(liveValue.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-i3x-text-muted">Waiting...</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Trend views for numeric values */}
            <div className="flex flex-wrap gap-2 mt-2">
              {subscriptions.get(activeSubscriptionId)?.monitoredItems.map((elementId) => {
                const liveValue = liveValues.get(elementId)
                // Only show trend for numeric values
                const isNumeric = liveValue && (
                  typeof liveValue.value === 'number' ||
                  !isNaN(parseFloat(String(liveValue.value)))
                )
                if (!isNumeric) return null
                return (
                  <div key={`trend-${elementId}`} className="flex flex-col">
                    <span className="text-xs text-i3x-text-muted mb-1 truncate max-w-[400px]" title={elementId}>
                      {elementId}
                    </span>
                    <TrendView elementId={elementId} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
