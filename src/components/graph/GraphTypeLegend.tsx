import { useState } from 'react'
import { Chevron } from '../common/Chevron'
import type { LegendEntry } from './graphSettings'

/**
 * The key for "Color by type": one swatch per object type drawn on the map, so
 * the hues mean something. Each row is a filter, click it to focus that type on
 * the map (the rest dims); click more to add types, or Clear to drop the filter.
 * The panel minimizes to a single bar, and its list collapses to the top few
 * with an expandable scroll for the overflow.
 */
const MAX_ROWS = 10

export function GraphTypeLegend({
  entries,
  activeTypes,
  onToggle,
  onClear,
}: {
  /** All types drawn, ranked by count, with colors, shared with the PNG export. */
  entries: LegendEntry[]
  /** Types currently focused. Empty = no filter. */
  activeTypes: Set<string>
  onToggle: (typeId: string) => void
  onClear: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [minimized, setMinimized] = useState(false)

  if (entries.length === 0) return null

  const hasFilter = activeTypes.size > 0

  if (minimized) {
    return (
      <div className="absolute bottom-3 left-3">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-1.5 bg-i3x-surface/95 border border-i3x-border rounded-lg px-2.5 py-1.5 text-xs text-i3x-text-muted hover:text-i3x-text focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          <Chevron open={false} />
          <span className="font-semibold">Types</span>
          <span className="tabular-nums">{entries.length}</span>
          {hasFilter && <span className="text-i3x-primary">· {activeTypes.size} focused</span>}
        </button>
      </div>
    )
  }

  const shown = expanded ? entries : entries.slice(0, MAX_ROWS)
  const hidden = entries.length - shown.length

  return (
    <div className="absolute bottom-3 left-3 max-w-[240px] bg-i3x-surface/95 border border-i3x-border rounded-lg px-2.5 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-i3x-text-muted">Types</span>
        <div className="flex items-center gap-2">
          {hasFilter && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] text-i3x-primary hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            aria-label="Minimize legend"
            title="Minimize"
            onClick={() => setMinimized(true)}
            className="text-i3x-text-muted hover:text-i3x-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            <Chevron open />
          </button>
        </div>
      </div>
      <ul className={`space-y-0.5 ${expanded ? 'max-h-[240px] overflow-y-auto pr-1' : ''}`}>
        {shown.map(entry => {
          const active = activeTypes.has(entry.typeId)
          return (
            <li key={entry.typeId}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(entry.typeId)}
                title={entry.label}
                className={`w-full flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
                  hasFilter && !active ? 'opacity-45' : ''
                }`}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <span className={`flex-1 truncate text-i3x-text ${active ? 'font-medium' : ''}`}>
                  {entry.label}
                </span>
                <span className="text-i3x-text-muted tabular-nums">{entry.count}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[11px] text-i3x-primary hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          {expanded ? 'Show less' : `+${hidden} more`}
        </button>
      )}
    </div>
  )
}

