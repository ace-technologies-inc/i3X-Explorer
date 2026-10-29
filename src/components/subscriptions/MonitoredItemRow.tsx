import { forwardRef, memo, useMemo, useState } from 'react'
import { useSubscriptionsStore, type LiveValue } from '../../stores/subscriptions'
import { asStructured, describeStructure, MAX_CHANGED_PATHS, toFiniteNumber } from '../../api/structuredValue'
import { StatusFacets } from '../details/ElementStatus'
import { JsonViewer } from '../details/JsonViewer'
import { formatComponentValue, formatComponentValueShort } from '../details/ValueDisplay'
import { Chevron } from '../common/Chevron'
import { PauseIcon, PlayIcon, TrashIcon, WarningIcon } from '../common/icons'
import { LivePulse, TimeAgo, isRepeatingFeed, repeatingFeedText } from './LiveBadge'
import { formatAgo, useNow } from './liveTime'
import { Sparkline } from './Sparkline'
import { TrendView } from './TrendView'
import { ChangeHint, ChangeList } from './ValueChanges'

export const MONITORED_ROW_COLUMNS = 6

type ItemAction = (elementId: string) => Promise<void>

interface MonitoredItemRowProps {
  /** Position in the windowed list, for measuring. */
  index: number
  elementId: string
  name: string | undefined
  isCurrent: boolean
  /** A composition component, indented under its root; it stops and goes with the root. */
  isComponent?: boolean
  /** Unregistered on the server; the row keeps its last value. */
  stopped: boolean
  open: boolean
  onToggle: (elementId: string) => void
  onOpenElement: (elementId: string) => void
  /** Root rows only: the server collects a component under its root. */
  onStop?: ItemAction
  onStart?: ItemAction
  onDelete?: ItemAction
  /** A composition root's component count and fold state. */
  componentCount?: number
  componentsOpen?: boolean
  onToggleComponents?: (elementId: string) => void
}

/**
 * One monitored element in the subscriptions table, with its detail row beneath it: a numeric
 * value opens to its trend, a structured one to what changed and the full JSON. A component of a
 * composition subscription renders the same way, indented under its parent. Rendered as its own
 * `<tbody>` so the windowed table measures a row and its detail together. Memoized, reading only
 * its own value, with callbacks that take the elementId, so a delivery re-renders only its rows.
 */
export const MonitoredItemRow = memo(forwardRef<HTMLTableSectionElement, MonitoredItemRowProps>(function MonitoredItemRow({
  index,
  elementId,
  name,
  isCurrent,
  isComponent = false,
  stopped,
  open,
  onToggle,
  onOpenElement,
  onStop,
  onStart,
  onDelete,
  componentCount = 0,
  componentsOpen = false,
  onToggleComponents,
}: MonitoredItemRowProps, ref) {
  const liveValue = useSubscriptionsStore(state => state.liveValues.get(elementId))
  const value = liveValue?.value
  const structured = useMemo(() => asStructured(value), [value])
  const numeric = liveValue && structured === undefined ? toFiniteNumber(value) : undefined
  const expandable = structured !== undefined || numeric !== undefined
  const rowTone = isCurrent ? 'bg-i3x-primary/5' : isComponent ? 'bg-i3x-bg/40' : ''
  const dim = stopped ? 'opacity-60' : ''

  return (
    <tbody ref={ref} data-index={index}>
      <tr className={`border-b border-i3x-border/60 ${rowTone}`}>
        <td className={`py-2.5 pr-3 ${isComponent ? 'pl-8' : 'pl-3'}`}>
          <ElementName elementId={elementId} name={name} isCurrent={isCurrent} onOpen={onOpenElement} />
          {componentCount > 0 && onToggleComponents && (
            <button
              type="button"
              onClick={() => onToggleComponents(elementId)}
              aria-expanded={componentsOpen}
              className="mt-1 flex items-center gap-1 rounded text-[11px] text-i3x-text-muted hover:text-i3x-text focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
            >
              <Chevron open={componentsOpen} />
              {componentCount} component{componentCount === 1 ? '' : 's'}
            </button>
          )}
        </td>
        <td className={`px-3 py-2.5 ${dim}`}>
          {!liveValue ? (
            <span className="text-xs text-i3x-text-muted">{stopped ? '-' : 'Waiting…'}</span>
          ) : expandable ? (
            <button
              type="button"
              onClick={() => onToggle(elementId)}
              aria-expanded={open}
              title={open ? 'Hide details' : numeric !== undefined ? 'Show trend' : 'Show value'}
              className="flex items-center gap-2 max-w-[22rem] min-w-0 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
            >
              <Chevron open={open} />
              {structured !== undefined ? (
                <StructuredSummary liveValue={liveValue} summary={describeStructure(structured)} />
              ) : (
                <>
                  <ScalarValue liveValue={liveValue} />
                  <Sparkline elementId={elementId} />
                </>
              )}
            </button>
          ) : (
            <span className="flex items-baseline gap-2 min-w-0 max-w-[18rem]">
              <ScalarValue liveValue={liveValue} />
            </span>
          )}
        </td>
        <td className={`px-3 py-2.5 ${dim}`}>
          {liveValue ? (
            <StatusFacets code={liveValue.quality} variant="compact" />
          ) : (
            <span className="text-i3x-text-muted">-</span>
          )}
        </td>
        <td className={`px-3 py-2.5 font-mono text-i3x-text-muted whitespace-nowrap ${dim}`}>
          {liveValue?.timestamp ? new Date(liveValue.timestamp).toLocaleTimeString() : '-'}
        </td>
        <td className="px-3 py-2.5 text-i3x-text-muted whitespace-nowrap">
          {stopped ? (
            <span className="flex items-center gap-1.5" title="Not monitored on the server; the last value received is kept">
              <span aria-hidden="true" className="w-2 h-2 rounded-full border border-i3x-text-muted" />
              Stopped
            </span>
          ) : (
            <Received liveValue={liveValue} />
          )}
        </td>
        <td className="px-3 py-2.5 text-right">
          {onStop && onStart && onDelete && (
            <ItemActions
              elementId={elementId}
              label={name ?? elementId}
              stopped={stopped}
              onStop={onStop}
              onStart={onStart}
              onDelete={onDelete}
            />
          )}
        </td>
      </tr>
      {open && liveValue && expandable && (
        <tr className={`border-b border-i3x-border/60 ${rowTone}`}>
          <td colSpan={MONITORED_ROW_COLUMNS} className={`pb-3 pr-3 ${isComponent ? 'pl-8' : 'pl-3'}`}>
            {liveValue.changes.length > 0 && (
              <p className="mb-1 text-[11px] text-i3x-text-muted">
                Last change <TimeAgo at={liveValue.changedAt} />
              </p>
            )}
            {structured !== undefined ? (
              <>
                <ChangeList changes={liveValue.changes} truncated={liveValue.changes.length >= MAX_CHANGED_PATHS} />
                <JsonViewer data={structured} initialExpanded={true} />
              </>
            ) : (
              <TrendView elementId={elementId} />
            )}
          </td>
        </tr>
      )}
    </tbody>
  )
}))

function ItemActions({
  elementId,
  label,
  stopped,
  onStop,
  onStart,
  onDelete,
}: {
  elementId: string
  label: string
  stopped: boolean
  onStop: ItemAction
  onStart: ItemAction
  onDelete: ItemAction
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (verb: string, action: ItemAction) => {
    setPending(true)
    setError(null)
    try {
      await action(elementId)
    } catch (err) {
      setError(`${verb} failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPending(false)
    }
  }

  const buttonClass =
    'rounded p-1 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary disabled:opacity-40 disabled:cursor-wait'

  return (
    <span className="inline-flex items-center gap-1">
      {error && (
        <span role="img" aria-label={error} title={error} className="text-i3x-error">
          <WarningIcon size={13} />
        </span>
      )}
      {stopped ? (
        <button
          type="button"
          onClick={() => run('Start', onStart)}
          disabled={pending}
          aria-label={`Start ${label}`}
          title="Start: register this item on the server again"
          className={`${buttonClass} text-i3x-text-muted hover:text-i3x-success`}
        >
          <PlayIcon size={13} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => run('Stop', onStop)}
          disabled={pending}
          aria-label={`Stop ${label}`}
          title="Stop: unregister this item on the server and keep its last value here"
          className={`${buttonClass} text-i3x-text-muted hover:text-i3x-warning`}
        >
          <PauseIcon size={13} />
        </button>
      )}
      <button
        type="button"
        onClick={() => run('Delete', onDelete)}
        disabled={pending}
        aria-label={`Delete ${label}`}
        title="Delete: unregister this item on the server and remove it from the list"
        className={`${buttonClass} text-i3x-text-muted hover:text-i3x-error`}
      >
        <TrashIcon size={13} />
      </button>
    </span>
  )
}

function ElementName({
  elementId,
  name,
  isCurrent,
  onOpen,
}: {
  elementId: string
  name: string | undefined
  isCurrent: boolean
  onOpen: (elementId: string) => void
}) {
  if (!name) {
    return (
      <span className="block truncate max-w-[16rem] text-i3x-text" title={elementId}>
        {elementId}
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(elementId)}
        title={`Open ${elementId}`}
        className={`block truncate max-w-[16rem] text-left rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
          isCurrent ? 'text-i3x-primary font-medium' : 'text-i3x-text hover:text-i3x-primary'
        }`}
      >
        {name}
      </button>
      {name !== elementId && (
        <span className="block truncate max-w-[16rem] font-mono text-[11px] text-i3x-text-muted">{elementId}</span>
      )}
    </>
  )
}

/** The value, flashing when it changes, with what it changed from. */
function ScalarValue({ liveValue }: { liveValue: LiveValue }) {
  return (
    <>
      {/* Re-keyed on each change, so the flash replays only when the value moves. */}
      <code
        key={liveValue.changedAt}
        className="value-updated truncate rounded px-1 -mx-1 font-mono text-i3x-text"
        title={formatComponentValue(liveValue.value)}
      >
        {formatComponentValueShort(liveValue.value)}
      </code>
      {liveValue.changes[0] && <ChangeHint change={liveValue.changes[0]} />}
    </>
  )
}

/** "{…} 3 fields · motor.speed +2 changed", flashing on change. */
function StructuredSummary({ liveValue, summary }: { liveValue: LiveValue; summary: string }) {
  const changes = liveValue.changes
  return (
    <>
      <code key={liveValue.changedAt} className="value-updated flex-shrink-0 rounded px-1 font-mono text-i3x-text">
        {summary}
      </code>
      {changes.length > 0 && (
        <span className="truncate text-[11px] text-i3x-text-muted">
          · {changes[0].path}
          {changes.length > 1 ? ` +${changes.length - 1}` : ''} changed
        </span>
      )}
    </>
  )
}

function Received({ liveValue }: { liveValue: LiveValue | undefined }) {
  const now = useNow()
  if (!liveValue) return <>-</>
  if (isRepeatingFeed(liveValue.repeatCount)) {
    return (
      <span
        className="flex items-center gap-1.5 text-i3x-warning"
        title={repeatingFeedText(liveValue.repeatCount, liveValue.freshAt, now)}
      >
        <LivePulse receivedAt={liveValue.receivedAt} stale />
        No new data · {formatAgo(liveValue.freshAt, now)}
      </span>
    )
  }
  return (
    <span
      className="flex items-center gap-1.5"
      title={`${liveValue.updateCount.toLocaleString()} update${
        liveValue.updateCount === 1 ? '' : 's'
      } received · value last changed ${formatAgo(liveValue.changedAt, now)}`}
    >
      <LivePulse receivedAt={liveValue.receivedAt} />
      {formatAgo(liveValue.receivedAt, now)}
      <span className="font-mono text-[11px]">×{liveValue.updateCount}</span>
    </span>
  )
}
