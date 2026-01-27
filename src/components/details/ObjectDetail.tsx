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

  const { activeSubscriptionId, addMonitoredItem } = useSubscriptionsStore()

  useEffect(() => {
    loadValue()
  }, [object.elementId])

  const loadValue = async () => {
    const client = getClient()
    if (!client) return

    setIsLoadingValue(true)
    setValueError(null)

    try {
      const result = await client.getValue(object.elementId)
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

    try {
      let subscriptionId = activeSubscriptionId

      // Create subscription if none exists
      if (!subscriptionId) {
        const response = await client.createSubscription()
        subscriptionId = response.subscriptionId

        useSubscriptionsStore.getState().addSubscription({
          id: subscriptionId,
          createdAt: new Date().toISOString(),
          monitoredItems: [],
          isStreaming: false
        })
      }

      // Register this object
      await client.registerMonitoredItems(subscriptionId, [object.elementId])
      addMonitoredItem(subscriptionId, object.elementId)
    } catch (err) {
      console.error('Failed to subscribe:', err)
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
        <button
          onClick={handleSubscribe}
          className="px-3 py-1.5 text-xs bg-i3x-primary text-white rounded hover:bg-i3x-primary/80 transition-colors"
        >
          Subscribe
        </button>
      </div>

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
            {object.namespaceUri}
          </code>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-i3x-text-muted">Composition:</span>
          <span className={`text-xs ${object.isComposition ? 'text-i3x-success' : 'text-i3x-secondary'}`}>
            {object.isComposition ? 'Yes' : 'No'}
          </span>
        </div>
      </div>

      {/* Relationship Graph and Current Value - responsive stack */}
      <div className="flex flex-col xl:flex-row gap-4">
        {/* Relationship Graph */}
        <div className="xl:max-w-[600px] xl:shrink-0">
          <label className="block text-xs text-i3x-text-muted mb-1">Relationship Graph</label>
          <RelationshipGraph object={object} />
        </div>

        {/* Current Value */}
        <div className="xl:flex-1">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-i3x-text-muted">Current Value</label>
            <button
              onClick={loadValue}
              disabled={isLoadingValue}
              className="text-xs text-i3x-primary hover:text-i3x-primary/80"
            >
              {isLoadingValue ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          {valueError ? (
            <div className="px-3 py-2 bg-i3x-error/10 border border-i3x-error/20 rounded text-sm text-i3x-error">
              {valueError}
            </div>
          ) : value ? (
            <ValueDisplay value={value} />
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
          <div className="border-t border-i3x-border p-3">
            {object.relationships && (
              <div className="mb-3">
                <label className="block text-xs text-i3x-text-muted mb-1">Relationships</label>
                <JsonViewer data={object.relationships} />
              </div>
            )}
            <JsonViewer data={object} />
          </div>
        )}
      </div>
    </div>
  )
}
