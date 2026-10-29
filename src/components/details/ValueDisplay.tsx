import { useState } from 'react'
import type { LastKnownValue } from '../../api/types'
import { parseJsonStructure } from '../../api/structuredValue'
import { CHILD_PAGE_SIZE, CHILD_PAGE_SLACK } from '../../stores/explorer'
import { JsonViewer } from './JsonViewer'
import { StatusFacets } from './ElementStatus'
import { WarningIcon } from '../common/icons'
import { Chevron } from '../common/Chevron'

interface ValueDisplayProps {
  value: LastKnownValue
  /** 'parsed' (default) shows the formatted value; 'raw' shows the full HTTP response body. */
  view?: 'parsed' | 'raw'
}

export function formatComponentValue(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Compact display form of a numeric component value (e.g. 4.719797770680919e-29
// → "4.7198e-29"); full precision is preserved in the tooltip. Non-numbers and
// integers pass through unchanged.
export function formatComponentValueShort(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v)) {
    // toPrecision rounds to N significant figures (keeping exponential form for
    // extreme magnitudes); Number() then strips any trailing zeros it added.
    return String(Number(v.toPrecision(6)))
  }
  return formatComponentValue(v)
}

// Component elementIds can be long; we middle-truncate them so this many trailing
// characters always stay visible (the suffix, e.g. "…temperature-value", is the
// distinguishing part). The full id is in the row tooltip.
const COMPONENT_ID_TAIL = 14

export function ValueDisplay({ value, view = 'parsed' }: ValueDisplayProps) {
  const components = value.components ? Object.entries(value.components) : []

  // Objects and arrays render as a tree; a value delivered as a JSON string is
  // decoded and rendered as a tree too. Scalars and non-JSON strings stay as text.
  const jsonValue =
    typeof value.value === 'object' ? value.value : parseJsonStructure(value.value)

  // Raw view: the untouched server response body. Falls back to the normalized
  // value object for sources that don't retain a raw body (e.g. live updates).
  if (view === 'raw') {
    return (
      <div className="bg-i3x-bg border border-i3x-border rounded-lg overflow-hidden">
        {value.partialDetail && (
          <div className="px-3 py-1.5 bg-i3x-warning/10 border-b border-i3x-warning/20 text-xs text-i3x-warning flex items-center gap-1.5">
            <WarningIcon size={12} />
            <span>Partial result: {value.partialDetail}</span>
          </div>
        )}
        <div className="p-3">
          <JsonViewer data={value.rawResponse ?? value} initialExpanded={true} />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-i3x-bg border border-i3x-border rounded-lg overflow-hidden">
      {/* 1.0: HTTP 206, a server-imposed limit truncated the composition tree */}
      {value.partialDetail && (
        <div className="px-3 py-1.5 bg-i3x-warning/10 border-b border-i3x-warning/20 text-xs text-i3x-warning flex items-center gap-1.5">
          <WarningIcon size={12} />
          <span>Partial result: {value.partialDetail}</span>
        </div>
      )}

      {/* Metadata bar. Quality and data-presence are separate facets, a
          "GoodNoData" reading is good quality AND empty, not a third state. */}
      {(value.timestamp || value.quality) && (
        <div className="px-3 py-2 border-b border-i3x-border flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {value.timestamp && (
            <span className="text-i3x-text-muted">
              Timestamp: <span className="text-i3x-text">{new Date(value.timestamp).toLocaleString()}</span>
            </span>
          )}
          {value.dataType && (
            <span className="text-i3x-text-muted">
              Type: <span className="text-i3x-text">{value.dataType}</span>
            </span>
          )}
          {/* ml-auto pushes the status badges to the right edge of the bar. */}
          {value.quality && <StatusFacets code={value.quality} variant="labeled" className="ml-auto" />}
        </div>
      )}

      {/* Value content */}
      <div className="p-3">
        {jsonValue !== undefined ? (
          <JsonViewer data={jsonValue} initialExpanded={true} />
        ) : (
          <code className="text-sm text-i3x-text">{String(value.value)}</code>
        )}
      </div>

      {/* Composition child values (1.0: maxDepth > 1 returns VQTs keyed by elementId) */}
      {components.length > 0 && <ComponentList components={components} />}
    </div>
  )
}

type ComponentVqt = NonNullable<LastKnownValue['components']>[string]

function ComponentList({ components }: { components: [string, ComponentVqt][] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // A big container's value carries every descendant; same paging as the tree.
  const [limit, setLimit] = useState(CHILD_PAGE_SIZE)
  const allExpanded = expanded.size > 0 && components.every(([id]) => expanded.has(id))
  const shownCount = components.length <= limit + CHILD_PAGE_SLACK ? components.length : limit
  const hidden = components.length - shownCount

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="border-t border-i3x-border">
      <div className="px-3 py-1.5 flex items-center justify-between text-xs font-medium text-i3x-text-muted">
        <span>Components ({components.length})</span>
        <button
          type="button"
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(components.map(([id]) => id)))}
          className="text-i3x-primary hover:text-i3x-primary/80 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <div className="divide-y divide-i3x-border">
        {components.slice(0, shownCount).map(([childId, vqt]) => {
          const isOpen = expanded.has(childId)
          const structured =
            vqt.value !== null && typeof vqt.value === 'object'
              ? vqt.value
              : parseJsonStructure(vqt.value)
          return (
            <div key={childId}>
              <button
                type="button"
                onClick={() => toggle(childId)}
                aria-expanded={isOpen}
                className="w-full px-3 py-1.5 flex items-center gap-3 text-xs text-left hover:bg-i3x-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-i3x-primary"
              >
                <Chevron open={isOpen} />
                {/* Middle-truncate: head shrinks/ellipsizes, tail stays pinned */}
                <code className="flex flex-1 min-w-0 text-i3x-text-muted" title={childId}>
                  <span className="truncate">{childId.slice(0, -COMPONENT_ID_TAIL)}</span>
                  <span className="flex-shrink-0">{childId.slice(-COMPONENT_ID_TAIL)}</span>
                </code>
                <code className="text-i3x-text truncate max-w-[40%]" title={formatComponentValue(vqt.value)}>
                  {formatComponentValueShort(vqt.value)}
                </code>
                {vqt.quality && <StatusFacets code={vqt.quality} variant="dot" />}
                {vqt.timestamp && (
                  <span className="text-i3x-text-muted whitespace-nowrap" title={new Date(vqt.timestamp).toLocaleString()}>
                    {new Date(vqt.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-2.5 pt-1 pl-8 space-y-1.5 text-xs">
                  {vqt.timestamp && (
                    <div className="text-i3x-text-muted">
                      {new Date(vqt.timestamp).toLocaleString()}
                      {vqt.quality && <> · {vqt.quality}</>}
                    </div>
                  )}
                  {structured !== undefined ? (
                    <JsonViewer data={structured} initialExpanded={true} />
                  ) : (
                    <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all whitespace-pre-wrap">
                      {formatComponentValue(vqt.value)}
                    </code>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {hidden > 0 && (
        <div className="px-3 py-1.5 border-t border-i3x-border flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setLimit(shownCount + CHILD_PAGE_SIZE)}
            className="text-i3x-primary hover:text-i3x-primary/80 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            Show {Math.min(hidden, CHILD_PAGE_SIZE).toLocaleString()} more
          </button>
          <span className="text-i3x-text-muted tabular-nums">{hidden.toLocaleString()} hidden</span>
          {hidden > CHILD_PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setLimit(Infinity)}
              className="ml-auto text-i3x-text-muted hover:text-i3x-primary underline decoration-dotted underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
            >
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
