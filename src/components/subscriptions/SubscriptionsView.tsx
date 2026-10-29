import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { listedElementIds, useSubscriptionsStore, type Subscription } from '../../stores/subscriptions'
import { useExplorerStore } from '../../stores/explorer'
import { useSubscriptionTransport } from './SubscriptionTransport'
import { LivePulse, TimeAgo } from './LiveBadge'
import { MONITORED_ROW_COLUMNS, MonitoredItemRow } from './MonitoredItemRow'
import { Spinner } from '../common/Spinner'
import { useElementNavigation } from '../main/navigation'
import type { ObjectInstance } from '../../api/types'

const EMPTY: readonly string[] = []
/** Initial row-height guess; real heights, expanded details included, are measured after mount. */
const ROW_ESTIMATE = 44

/** One line of the windowed table: a monitored item, or a component listed under it. */
interface TableRow {
  key: string
  elementId: string
  rootId: string
  isComponent: boolean
}

const toggled = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * The global subscriptions surface: every monitored item across the active
 * subscription, with the components a composition subscription collects nested
 * under it. Each row carries its latest value (flashing when it changes), its
 * quality and when the last update arrived, and expands to its trend or JSON.
 * Not scoped to the selected element, it just highlights it when there's a match.
 * The table is windowed, so a composition with thousands of components mounts
 * only the rows in view.
 */
export function SubscriptionsView() {
  const subscriptions = useSubscriptionsStore(state => state.subscriptions)
  const activeSubscriptionId = useSubscriptionsStore(state => state.activeSubscriptionId)
  const setActiveSubscription = useSubscriptionsStore(state => state.setActiveSubscription)
  const objectIndex = useExplorerStore(state => state.objectIndex)
  const { selectElement } = useElementNavigation()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // Component lists start open; this holds the roots a user folded.
  const [foldedRoots, setFoldedRoots] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExpanded = useCallback((id: string) => setExpanded(prev => toggled(prev, id)), [])
  const toggleComponents = useCallback((id: string) => setFoldedRoots(prev => toggled(prev, id)), [])

  const selectedElementId = useExplorerStore(state =>
    state.selectedItem?.type === 'object'
      ? (state.selectedItem.data as ObjectInstance).elementId
      : null
  )

  const {
    usePolling,
    setUsePolling,
    streamUnsupported,
    startStream,
    stopStream,
    deleteSubscription,
    stopItem,
    startItems,
    deleteItem,
  } = useSubscriptionTransport()

  const activeId = activeSubscriptionId && subscriptions.has(activeSubscriptionId) ? activeSubscriptionId : null
  const onStopItem = useCallback(
    (elementId: string) => (activeId ? stopItem(activeId, elementId) : Promise.resolve()),
    [activeId, stopItem]
  )
  const onStartItem = useCallback(
    (elementId: string) => (activeId ? startItems(activeId, [elementId]) : Promise.resolve()),
    [activeId, startItems]
  )
  const onDeleteItem = useCallback(
    (elementId: string) => (activeId ? deleteItem(activeId, elementId) : Promise.resolve()),
    [activeId, deleteItem]
  )

  const active = activeId ? subscriptions.get(activeId) : undefined
  const stoppedItems = active?.stoppedItems ?? EMPTY
  const rows = useMemo<TableRow[]>(() => {
    if (!active) return []
    return active.monitoredItems.flatMap(rootId => {
      const root: TableRow = { key: rootId, elementId: rootId, rootId, isComponent: false }
      if (foldedRoots.has(rootId)) return [root]
      const components = (active.components?.[rootId] ?? EMPTY).map(
        (elementId): TableRow => ({ key: `${rootId}/${elementId}`, elementId, rootId, isComponent: true })
      )
      return [root, ...components]
    })
  }, [active, foldedRoots])

  const scrollRef = useRef<HTMLDivElement>(null)
  // A new key function makes the virtualizer re-measure every row, so it changes only with the rows.
  const getItemKey = useCallback((index: number) => rows[index].key, [rows])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
    getItemKey,
  })

  const subscriptionList = Array.from(subscriptions.values())

  if (subscriptionList.length === 0) {
    return (
      <p className="text-[13px] text-i3x-text-muted p-4">
        No active subscriptions. Select an object and click{' '}
        <b className="font-medium text-i3x-text">Subscribe</b> to start monitoring it.
      </p>
    )
  }

  const monitoredItems = active?.monitoredItems ?? EMPTY
  const isStreaming = active?.isStreaming ?? false
  const polling = usePolling || streamUnsupported
  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0

  const startAll = async (subscriptionId: string) => {
    if (stoppedItems.length > 0) {
      await startItems(subscriptionId, [...stoppedItems]).catch(err =>
        console.error('Failed to start stopped items:', err)
      )
    }
    await startStream(subscriptionId)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 px-4 pt-4 pb-3 space-y-4">
      {subscriptionList.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {subscriptionList.map(sub => (
            <button
              key={sub.id}
              type="button"
              onClick={() => setActiveSubscription(sub.id)}
              aria-pressed={activeSubscriptionId === sub.id}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
                activeSubscriptionId === sub.id
                  ? 'bg-i3x-primary/10 border-i3x-primary text-i3x-primary'
                  : 'bg-i3x-bg border-i3x-border text-i3x-text hover:border-i3x-primary'
              }`}
            >
              {sub.isStreaming && (
                <span
                  aria-hidden="true"
                  className="w-2 h-2 rounded-full bg-i3x-success animate-pulse motion-reduce:animate-none"
                />
              )}
              <span className="font-mono">#{sub.id}</span>
              <span className="text-i3x-text-muted">{sub.monitoredItems.length} items</span>
            </button>
          ))}
        </div>
      )}

      {active && (
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-i3x-text-muted">
              Monitored items <span className="font-mono normal-case">{monitoredItems.length}</span>
            </h3>

            <TransportStatus subscription={active} polling={polling} />

            <div className="flex items-center gap-3 ml-auto">
              <label
                className="flex items-center gap-1.5 text-xs text-i3x-text-muted"
                title={
                  streamUnsupported
                    ? 'This server does not support SSE streaming (capabilities.subscribe.stream = false), so updates are polled'
                    : 'Poll /subscriptions/sync every 2 s instead of holding an SSE stream open. Change it while stopped.'
                }
              >
                <input
                  type="checkbox"
                  checked={polling}
                  onChange={e => setUsePolling(e.target.checked)}
                  disabled={isStreaming || streamUnsupported}
                  className="w-3 h-3"
                />
                Poll
              </label>

              {!isStreaming ? (
                <button
                  type="button"
                  onClick={() => void startAll(active.id)}
                  title={`Start receiving updates by ${polling ? 'polling' : 'stream'}${
                    stoppedItems.length > 0 ? ', and register the stopped items again' : ''
                  }`}
                  className="px-3 py-1 text-xs bg-i3x-success/20 text-i3x-success rounded-lg hover:bg-i3x-success/30 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
                >
                  Start all
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => stopStream(active.id)}
                  title="Stop receiving updates for every item. The subscription stays on the server; Start all resumes."
                  className="px-3 py-1 text-xs bg-i3x-warning/20 text-i3x-warning rounded-lg hover:bg-i3x-warning/30 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
                >
                  Stop all
                </button>
              )}

              <button
                type="button"
                onClick={() => deleteSubscription(active.id)}
                title="Delete this subscription on the server, with all its monitored items"
                className="px-3 py-1 text-xs bg-i3x-error/20 text-i3x-error rounded-lg hover:bg-i3x-error/30 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
              >
                Delete all
              </button>
            </div>
          </div>
      )}
      </div>

      {active && (
        <div ref={scrollRef} data-windowed-list="" className="flex-1 min-h-0 overflow-auto px-4 pb-4">
          {/* The full virtual height, so the container measures before any row has rendered. */}
          <table className="w-full border-collapse text-[13px] min-w-[640px]" style={{ minHeight: totalSize }}>
            <thead>
              <tr>
                {['Element', 'Value', 'Quality', 'Source time', 'Received', ''].map((heading, i) => (
                  <th
                    key={heading || i}
                    scope="col"
                    className={`text-left font-medium text-i3x-text-muted text-[11px] uppercase tracking-wide pb-2 px-3 border-b border-i3x-border ${
                      i === 0 ? 'w-1/3' : ''
                    }`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            {paddingTop > 0 && <SpacerRows height={paddingTop} />}
            {virtualItems.map(virtualItem => {
              const row = rows[virtualItem.index]
              const stopped = stoppedItems.includes(row.rootId)
              const componentCount = row.isComponent ? 0 : (active.components?.[row.rootId]?.length ?? 0)
              return (
                <MonitoredItemRow
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  index={virtualItem.index}
                  elementId={row.elementId}
                  name={objectIndex.get(row.elementId)?.displayName}
                  isCurrent={row.elementId === selectedElementId}
                  isComponent={row.isComponent}
                  stopped={stopped}
                  open={expanded.has(row.elementId)}
                  onToggle={toggleExpanded}
                  onOpenElement={selectElement}
                  {...(row.isComponent
                    ? {}
                    : {
                        onStop: onStopItem,
                        onStart: onStartItem,
                        onDelete: onDeleteItem,
                        componentCount,
                        componentsOpen: !foldedRoots.has(row.rootId),
                        onToggleComponents: toggleComponents,
                      })}
                />
              )
            })}
            {paddingBottom > 0 && <SpacerRows height={paddingBottom} />}
          </table>
        </div>
      )}
    </div>
  )
}

function SpacerRows({ height }: { height: number }) {
  return (
    <tbody aria-hidden="true">
      <tr>
        <td colSpan={MONITORED_ROW_COLUMNS} style={{ height, padding: 0 }} />
      </tr>
    </tbody>
  )
}

/** "Polling every 2 s · last update 3s ago"; reads live values itself, so deliveries re-render only this line. */
function TransportStatus({ subscription, polling }: { subscription: Subscription; polling: boolean }) {
  const delivered = useMemo(() => listedElementIds(subscription), [subscription])
  const lastReceivedAt = useSubscriptionsStore(state =>
    delivered.reduce((latest, elementId) => Math.max(latest, state.liveValues.get(elementId)?.receivedAt ?? 0), 0)
  )
  return (
    <span className="flex items-center gap-1.5 text-xs text-i3x-text-muted">
      {!subscription.isStreaming ? (
        <>
          <span aria-hidden="true" className="w-2 h-2 rounded-full border border-i3x-text-muted" />
          Stopped
        </>
      ) : lastReceivedAt > 0 ? (
        <>
          <LivePulse receivedAt={lastReceivedAt} />
          <span className="text-i3x-success font-medium">{polling ? 'Polling every 2 s' : 'Streaming'}</span>
          · last update <TimeAgo at={lastReceivedAt} />
        </>
      ) : (
        <>
          <Spinner size={11} />
          {polling ? 'Polling' : 'Streaming'}, waiting for the first update…
        </>
      )}
    </span>
  )
}
