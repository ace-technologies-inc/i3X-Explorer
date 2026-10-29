import { numericDelta, type ValueChange } from '../../api/structuredValue'
import { formatComponentValue, formatComponentValueShort } from '../details/ValueDisplay'

function formatDelta(delta: number): string {
  return `${delta > 0 ? '▲' : '▼'} ${formatComponentValueShort(Math.abs(delta))}`
}

function describeChange(change: ValueChange): string {
  if (change.before === undefined) return 'added'
  if (change.after === undefined) return 'removed'
  const delta = numericDelta(change.before, change.after)
  if (delta !== undefined && delta !== 0) return formatDelta(delta)
  return `was ${formatComponentValueShort(change.before)}`
}

/** "▲ 1", "was A0", "added": one change, compact enough for a table cell. */
export function ChangeHint({ change }: { change: ValueChange }) {
  return (
    <span
      className="truncate font-mono text-[11px] text-i3x-text-muted"
      title={`Previous: ${formatComponentValue(change.before)}`}
    >
      {describeChange(change)}
    </span>
  )
}

/** Every change of the last update: path, previous value → new value, and the delta when numeric. */
export function ChangeList({ changes, truncated }: { changes: ValueChange[]; truncated: boolean }) {
  return (
    <ul className="mb-2 space-y-0.5 text-[11.5px]">
      {changes.map(change => {
        const delta = numericDelta(change.before, change.after)
        return (
          <li key={change.path} className="flex items-baseline gap-2 min-w-0 font-mono">
            <span className="flex-shrink-0 text-i3x-text">{change.path}</span>
            <span
              className="truncate text-i3x-text-muted line-through"
              title={formatComponentValue(change.before)}
            >
              {change.before === undefined ? '(none)' : formatComponentValueShort(change.before)}
            </span>
            <span aria-label="changed to" className="flex-shrink-0 text-i3x-text-muted">→</span>
            <span className="truncate text-i3x-success" title={formatComponentValue(change.after)}>
              {change.after === undefined ? '(removed)' : formatComponentValueShort(change.after)}
            </span>
            {delta !== undefined && delta !== 0 && (
              <span className="flex-shrink-0 text-i3x-text-muted">{formatDelta(delta)}</span>
            )}
          </li>
        )
      })}
      {truncated && <li className="text-i3x-text-muted">and more…</li>}
    </ul>
  )
}
