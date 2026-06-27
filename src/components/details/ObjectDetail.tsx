import { useState, useEffect } from 'react'
import type { ObjectInstance, LastKnownValue } from '../../api/types'
import { getClient } from '../../api/client'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { JsonViewer } from './JsonViewer'
import { ValueDisplay } from './ValueDisplay'
import { RelationshipGraph } from './RelationshipGraph'

interface ObjectDetailProps {
  object: ObjectInstance
}

export function ObjectDetail({ object }: ObjectDetailProps) {
  const [value, setValue] = useState<LastKnownValue | null>(null)
  const [isLoadingValue, setIsLoadingValue] = useState(false)
  const [valueError, setValueError] = useState<string | null>(null)
  const [isRawDataExpanded, setIsRawDataExpanded] = useState(false)
  const [valueView, setValueView] = useState<'parsed' | 'raw'>('parsed')

  const [isSubscribing, setIsSubscribing] = useState(false)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)

  const { activeSubscriptionId, addMonitoredItem, removeSubscription, setBottomPanelExpanded } = useSubscriptionsStore()

  useEffect(() => {
    loadValue()
  }, [object.elementId])

  // Clear subscribe error when the selected object changes
  useEffect(() => {
    setSubscribeError(null)
  }, [object.elementId])

  const loadValue = async () => {
    const client = getClient()
    if (!client) return

    setIsLoadingValue(true)
    setValueError(null)

    try {
      // 1.0 Release: composition objects return child values under "components"
      // when queried with maxDepth=0 (infinite recursion through HasComponent).
      // Beta/pre-release servers keep the default maxDepth=1 behavior untouched.
      const maxDepth = client.getApiVersion() === 'v1' && object.isComposition ? 0 : 1
      const result = await client.getValue(object.elementId, maxDepth)
      setValue(result)
    } catch (err) {
      setValueError(err instanceof Error ? err.message : 'Failed to load value')
    } finally {
      setIsLoadingValue(false)
    }
  }

  const handleSubscribe = async () => {
    const client = getClient()
    if (!client) return

    setIsSubscribing(true)
    setSubscribeError(null)

    // Track any subscription we create so we can roll it back if register fails
    let newlyCreatedSubId: string | null = null

    try {
      let subscriptionId = activeSubscriptionId

      // Create subscription if none exists
      if (!subscriptionId) {
        const response = await client.createSubscription()
        subscriptionId = response.subscriptionId
        newlyCreatedSubId = subscriptionId

        useSubscriptionsStore.getState().addSubscription({
          id: subscriptionId,
          createdAt: new Date().toISOString(),
          monitoredItems: [],
          isStreaming: false
        })
      }

      // Register this object — if this throws, the catch block cleans up
      await client.registerMonitoredItems(subscriptionId, [object.elementId])
      addMonitoredItem(subscriptionId, object.elementId)
      setBottomPanelExpanded(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Subscribe failed'
      setSubscribeError(msg)
      console.error('Failed to subscribe:', err)

      // Roll back any subscription we just created so it doesn't sit empty in the UI
      if (newlyCreatedSubId) {
        removeSubscription(newlyCreatedSubId)
        try { await client.deleteSubscription(newlyCreatedSubId) } catch { /* best-effort */ }
      }
    } finally {
      setIsSubscribing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-i3x-text mb-1">
            {object.displayName}
          </h2>
          <p className="text-sm text-i3x-text-muted">Object Instance</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleSubscribe}
            disabled={isSubscribing}
            className="px-3 py-1.5 text-xs bg-i3x-primary text-white rounded hover:bg-i3x-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubscribing ? 'Subscribing...' : 'Subscribe'}
          </button>
          {subscribeError && (
            <span className="text-xs text-i3x-error max-w-[200px] text-right" title={subscribeError}>
              {subscribeError}
            </span>
          )}
        </div>
      </div>

      {object.description && (
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Description</label>
          <p className="px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text">
            {object.description}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Element ID</label>
          <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
            {object.elementId}
          </code>
        </div>
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Type ID</label>
          <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
            {object.typeId}
          </code>
        </div>
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Parent ID</label>
          <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
            {object.parentId || '(none)'}
          </code>
        </div>
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Namespace URI</label>
          <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
            {object.namespaceUri || '—'}
          </code>
        </div>
        {object.metadata?.sourceTypeId != null && (
          <div>
            <label className="block text-xs text-i3x-text-muted mb-1">Source Type ID</label>
            <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
              {String(object.metadata.sourceTypeId)}
            </code>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-i3x-text-muted">Composition:</span>
          <span className={`text-xs ${object.isComposition ? 'text-i3x-success' : 'text-i3x-secondary'}`}>
            {object.isComposition ? 'Yes' : 'No'}
          </span>
        </div>
        {object.isExtended !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-i3x-text-muted">Extended:</span>
            <span className={`text-xs ${object.isExtended ? 'text-i3x-success' : 'text-i3x-secondary'}`}>
              {object.isExtended ? 'Yes' : 'No'}
            </span>
          </div>
        )}
      </div>

      {/* Relationship Graph and Current Value - responsive stack. Stays side-by-side
          down to 1140px so the value pane can squeeze before wrapping. */}
      <div className="flex flex-col min-[1140px]:flex-row gap-4">
        {/* Relationship Graph — sizes to the graph's own (content-tight) width and
            scales down when the row is cramped, rather than reserving a fixed slab */}
        <div className="min-w-0 min-[1140px]:max-w-[690px]">
          <label className="block text-xs text-i3x-text-muted mb-1">Relationship Graph</label>
          <RelationshipGraph object={object} />
        </div>

        {/* Current Value — min-w-0 lets this flex column shrink so ValueDisplay's
            internal truncation kicks in instead of forcing the pane wide */}
        <div className="min-[1140px]:flex-1 min-[1140px]:min-w-0">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-i3x-text-muted">Current Value</label>
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded border border-i3x-border overflow-hidden text-xs">
                {(['parsed', 'raw'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setValueView(mode)}
                    className={`px-2 py-0.5 transition-colors ${
                      valueView === mode
                        ? 'bg-i3x-primary text-white'
                        : 'text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg/50'
                    }`}
                  >
                    {mode === 'parsed' ? 'Parsed' : 'Raw'}
                  </button>
                ))}
              </div>
              <button
                onClick={loadValue}
                disabled={isLoadingValue}
                className="text-xs text-i3x-primary hover:text-i3x-primary/80"
              >
                {isLoadingValue ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
          {valueError ? (
            <div className="px-3 py-2 bg-i3x-error/10 border border-i3x-error/20 rounded text-sm text-i3x-error">
              {valueError}
            </div>
          ) : value ? (
            <ValueDisplay value={value} view={valueView} />
          ) : (
            <div className="px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text-muted">
              {isLoadingValue ? 'Loading...' : 'No value available'}
            </div>
          )}
        </div>
      </div>

      {/* Object Data (collapsible) */}
      <div className="border border-i3x-border rounded">
        <div
          className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-i3x-bg/50"
          onClick={() => setIsRawDataExpanded(!isRawDataExpanded)}
        >
          <span className="text-xs font-medium text-i3x-text">Object Data</span>
          <span className="text-i3x-text-muted">
            {isRawDataExpanded ? '▼' : '▶'}
          </span>
        </div>
        {isRawDataExpanded && (
          <div className="border-t border-i3x-border p-3 space-y-3">
            {object.relationships && (
              <div>
                <label className="block text-xs text-i3x-text-muted mb-1">Relationships</label>
                <JsonViewer data={object.relationships} />
              </div>
            )}
            {object.metadata && (() => {
              const { relationships: _r, typeNamespaceUri: _ns, description: _d, sourceTypeId: _st, ...rest } = object.metadata as Record<string, unknown>
              return Object.keys(rest).length > 0 ? (
                <div>
                  <label className="block text-xs text-i3x-text-muted mb-1">Metadata</label>
                  <JsonViewer data={rest} />
                </div>
              ) : null
            })()}
            <div>
              <label className="block text-xs text-i3x-text-muted mb-1">Raw Object</label>
              <JsonViewer data={object} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
