import type { LastKnownValue } from '../../api/types'
import { JsonViewer } from './JsonViewer'

interface ValueDisplayProps {
  value: LastKnownValue
  /** 'parsed' (default) shows the formatted value; 'raw' shows the full HTTP response body. */
  view?: 'parsed' | 'raw'
}

// Normative quality enum (1.0): Good | GoodNoData | Bad | Uncertain.
// Non-standard strings fall through to quality-unknown.
function qualityClassFor(quality?: string): string {
  const q = quality?.toLowerCase() ?? ''
  if (q.startsWith('good')) return 'quality-good'
  if (q.startsWith('bad')) return 'quality-bad'
  if (q.startsWith('uncertain')) return 'quality-uncertain'
  return 'quality-unknown'
}

function formatComponentValue(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Compact display form of a numeric component value (e.g. 4.719797770680919e-29
// → "4.7198e-29"); full precision is preserved in the tooltip. Non-numbers and
// integers pass through unchanged.
function formatComponentValueShort(v: unknown): string {
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
  const qualityLabel = value.quality ?? 'Unknown'
  const components = value.components ? Object.entries(value.components) : []

  // Raw view: the untouched server response body. Falls back to the normalized
  // value object for sources that don't retain a raw body (e.g. live updates).
  if (view === 'raw') {
    return (
      <div className="bg-i3x-surface rounded overflow-hidden">
        {value.partialDetail && (
          <div className="px-3 py-1.5 bg-i3x-warning/10 border-b border-i3x-warning/20 text-xs text-i3x-warning">
            ⚠ Partial result: {value.partialDetail}
          </div>
        )}
        <div className="p-3">
          <JsonViewer data={value.rawResponse ?? value} initialExpanded={true} />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-i3x-surface rounded overflow-hidden">
      {/* 1.0: HTTP 206 — a server-imposed limit truncated the composition tree */}
      {value.partialDetail && (
        <div className="px-3 py-1.5 bg-i3x-warning/10 border-b border-i3x-warning/20 text-xs text-i3x-warning">
          ⚠ Partial result: {value.partialDetail}
        </div>
      )}

      {/* Metadata bar */}
      {(value.timestamp || value.quality) && (
        <div className="px-3 py-1.5 bg-i3x-bg/50 border-b border-i3x-border flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
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
          <span className={qualityClassFor(value.quality)} title={qualityLabel}>● {qualityLabel}</span>
        </div>
      )}

      {/* Value content */}
      <div className="p-3">
        {typeof value.value === 'object' ? (
          <JsonViewer data={value.value} initialExpanded={true} />
        ) : (
          <code className="text-sm text-i3x-text">{String(value.value)}</code>
        )}
      </div>

      {/* Composition child values (1.0: maxDepth > 1 returns VQTs keyed by elementId) */}
      {components.length > 0 && (
        <div className="border-t border-i3x-border">
          <div className="px-3 py-1.5 bg-i3x-bg/50 text-xs font-medium text-i3x-text-muted">
            Components ({components.length})
          </div>
          <div className="divide-y divide-i3x-border">
            {components.map(([childId, vqt]) => (
              <div key={childId} className="px-3 py-1.5 flex items-center gap-3 text-xs">
                {/* Middle-truncate: head shrinks/ellipsizes, tail stays pinned */}
                <code className="flex flex-1 min-w-0 text-i3x-text-muted" title={childId}>
                  <span className="truncate">{childId.slice(0, -COMPONENT_ID_TAIL)}</span>
                  <span className="flex-shrink-0">{childId.slice(-COMPONENT_ID_TAIL)}</span>
                </code>
                <code className="text-i3x-text truncate max-w-[40%]" title={formatComponentValue(vqt.value)}>
                  {formatComponentValueShort(vqt.value)}
                </code>
                {vqt.quality && (
                  <span className={qualityClassFor(vqt.quality)} title={vqt.quality}>●</span>
                )}
                {vqt.timestamp && (
                  <span className="text-i3x-text-muted whitespace-nowrap" title={new Date(vqt.timestamp).toLocaleString()}>
                    {new Date(vqt.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
