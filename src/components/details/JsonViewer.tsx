import { useMemo, useState } from 'react'
import { CopyButton } from './CopyButton'

interface JsonViewerProps {
  data: unknown
  initialExpanded?: boolean
}

export function JsonViewer({ data, initialExpanded = false }: JsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)

  const { jsonString, lineCount } = useMemo(() => {
    const text = JSON.stringify(data, null, 2)
    let lines = 1
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++
    return { jsonString: text, lineCount: lines }
  }, [data])

  // Show collapsed view for large objects
  const shouldCollapse = lineCount > 10
  const showCollapsed = shouldCollapse && !isExpanded
  const preview = useMemo(
    () => (showCollapsed ? JSON.stringify(data).slice(0, 100) : ''),
    [data, showCollapsed]
  )

  if (!showCollapsed) {
    return (
      <div className="relative">
        <pre className="px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text overflow-auto max-h-96">
          <code>{jsonString}</code>
        </pre>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <CopyButton text={jsonString} />
          {shouldCollapse && (
            <button
              onClick={() => setIsExpanded(false)}
              className="px-2 py-1 text-xs bg-i3x-bg rounded hover:bg-i3x-border transition-colors"
            >
              Collapse
            </button>
          )}
        </div>
      </div>
    )
  }

  // Collapsed view
  return (
    <div
      onClick={() => setIsExpanded(true)}
      className="relative px-3 py-2 pr-10 bg-i3x-surface rounded text-sm text-i3x-text-muted cursor-pointer hover:bg-i3x-bg transition-colors"
    >
      <code>{preview}{preview.length >= 100 ? '...' : ''}</code>
      <span className="ml-2 text-xs text-i3x-primary">Click to expand ({lineCount} lines)</span>
      <CopyButton text={jsonString} className="absolute top-1.5 right-1.5" />
    </div>
  )
}
