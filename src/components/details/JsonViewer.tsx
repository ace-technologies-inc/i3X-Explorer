import { useState } from 'react'

interface JsonViewerProps {
  data: unknown
  initialExpanded?: boolean
}

export function JsonViewer({ data, initialExpanded = false }: JsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)

  const jsonString = JSON.stringify(data, null, 2)
  const lineCount = jsonString.split('\n').length

  // Show collapsed view for large objects
  const shouldCollapse = lineCount > 10

  if (!shouldCollapse || isExpanded) {
    return (
      <div className="relative">
        <pre className="px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text overflow-auto max-h-96">
          <code>{jsonString}</code>
        </pre>
        {shouldCollapse && (
          <button
            onClick={() => setIsExpanded(false)}
            className="absolute top-2 right-2 px-2 py-1 text-xs bg-i3x-bg rounded hover:bg-i3x-border transition-colors"
          >
            Collapse
          </button>
        )}
      </div>
    )
  }

  // Collapsed view
  const preview = JSON.stringify(data).slice(0, 100)
  return (
    <div
      onClick={() => setIsExpanded(true)}
      className="px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text-muted cursor-pointer hover:bg-i3x-bg transition-colors"
    >
      <code>{preview}{preview.length >= 100 ? '...' : ''}</code>
      <span className="ml-2 text-xs text-i3x-primary">Click to expand ({lineCount} lines)</span>
    </div>
  )
}
