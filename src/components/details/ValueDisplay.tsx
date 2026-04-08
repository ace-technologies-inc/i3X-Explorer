import type { LastKnownValue } from '../../api/types'
import { JsonViewer } from './JsonViewer'

interface ValueDisplayProps {
  value: LastKnownValue
}

export function ValueDisplay({ value }: ValueDisplayProps) {
  const quality = value.quality?.toLowerCase() ?? ''
  const qualityClass = quality.startsWith('good') ? 'quality-good'
    : quality.startsWith('bad') ? 'quality-bad'
    : 'quality-unknown'
  const qualityLabel = value.quality ?? 'Unknown'

  return (
    <div className="bg-i3x-surface rounded overflow-hidden">
      {/* Metadata bar */}
      {(value.timestamp || value.quality) && (
        <div className="px-3 py-1.5 bg-i3x-bg/50 border-b border-i3x-border flex items-center gap-4 text-xs">
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
          <span className={qualityClass} title={qualityLabel}>● {qualityLabel}</span>
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
    </div>
  )
}
