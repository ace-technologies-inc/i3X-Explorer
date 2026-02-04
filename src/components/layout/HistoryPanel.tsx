import { useState, useCallback, useEffect, useMemo } from 'react'
import { useExplorerStore } from '../../stores/explorer'
import { useConnectionStore } from '../../stores/connection'
import { getClient } from '../../api/client'
import type { HistoricalValue } from '../../api/types'

interface HistoryDataPoint {
  timestamp: string
  value: unknown
  quality?: string
}

// Chart constants
const CHART_HEIGHT = 100
const PADDING = { top: 10, right: 10, bottom: 25, left: 50 }

export function HistoryPanel() {
  const [height, setHeight] = useState(200)
  const [isResizing, setIsResizing] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [historyData, setHistoryData] = useState<HistoryDataPoint[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedItem = useExplorerStore((state) => state.selectedItem)
  const isConnected = useConnectionStore((state) => state.isConnected)

  const isObjectSelected = selectedItem?.type === 'object'
  // TODO: Remove this workaround once server bug is fixed.
  // The tree view prefixes hierarchical items with 'hier:' for unique IDs,
  // but the server incorrectly parses 'hier' as a dataset name instead of
  // recognizing it as a client-side prefix. See bug-report.md for details.
  const selectedElementId = isObjectSelected
    ? (selectedItem.id.startsWith('hier:') ? selectedItem.id.slice(5) : selectedItem.id)
    : null

  // Fetch history when object is selected
  useEffect(() => {
    if (!isObjectSelected || !selectedElementId || !isConnected) {
      setHistoryData([])
      setError(null)
      return
    }

    const fetchHistory = async () => {
      const client = getClient()
      if (!client) return

      setIsLoading(true)
      setError(null)

      try {
        const endTime = new Date().toISOString()
        const startTime = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago

        const result: HistoricalValue = await client.getHistory(
          selectedElementId,
          startTime,
          endTime
        )

        // Extract data points from response
        const points: HistoryDataPoint[] = []
        if (Array.isArray(result.value)) {
          for (const item of result.value) {
            if (item && typeof item === 'object' && 'timestamp' in item) {
              points.push({
                timestamp: item.timestamp as string,
                value: item.value,
                quality: item.quality as string | undefined
              })
            }
          }
        }

        // Sort by timestamp
        points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        setHistoryData(points)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch history')
        setHistoryData([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchHistory()
  }, [selectedElementId, isObjectSelected, isConnected])

  // Auto-expand when data is available
  useEffect(() => {
    if (historyData.length > 0 && isCollapsed) {
      setIsCollapsed(false)
    }
  }, [historyData.length])

  const handleMouseDown = useCallback(() => {
    if (isCollapsed) return
    setIsResizing(true)
  }, [isCollapsed])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const panel = document.getElementById('history-panel')
    if (panel) {
      const panelRect = panel.getBoundingClientRect()
      const newHeight = e.clientY - panelRect.top
      setHeight(Math.max(100, Math.min(400, newHeight)))
    }
  }, [isResizing])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev)
  }, [])

  // Determine if data is simple (numeric) or complex
  const dataType = useMemo(() => {
    if (historyData.length === 0) return 'empty'
    const firstValue = historyData[0].value
    if (typeof firstValue === 'number') return 'numeric'
    if (typeof firstValue === 'boolean') return 'boolean'
    if (typeof firstValue === 'string') {
      // Check if it's a numeric string
      if (!isNaN(Number(firstValue))) return 'numeric'
      return 'string'
    }
    return 'complex'
  }, [historyData])

  return (
    <div
      id="history-panel"
      className="border-t border-i3x-border bg-i3x-bg flex flex-col"
      style={{ height: isCollapsed ? 'auto' : `${height}px` }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 flex items-center gap-2 border-b border-i3x-border cursor-pointer hover:bg-i3x-surface/50"
        onClick={toggleCollapsed}
      >
        <svg
          className={`w-3 h-3 text-i3x-text-muted transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
        <span className="text-xs font-medium text-i3x-text">History</span>
        {historyData.length > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-i3x-primary/20 text-i3x-primary rounded">
            {historyData.length} points
          </span>
        )}
        {isLoading && (
          <span className="text-xs text-i3x-text-muted">Loading...</span>
        )}
      </div>

      {/* Content - only show when expanded */}
      {!isCollapsed && (
        <>
          <div className="flex-1 overflow-auto p-3">
            {error && (
              <p className="text-xs text-i3x-error">{error}</p>
            )}
            {!error && historyData.length === 0 && !isLoading && (
              <p className="text-xs text-i3x-text-muted">
                {isObjectSelected ? 'No history data available for the past hour.' : 'Select an object to view history.'}
              </p>
            )}
            {!error && historyData.length > 0 && dataType === 'numeric' && (
              <HistoryTrendChart data={historyData} />
            )}
            {!error && historyData.length > 0 && dataType !== 'numeric' && dataType !== 'empty' && (
              <HistoryTable data={historyData} />
            )}
          </div>

          {/* Resize handle at bottom */}
          <div
            className={`h-1 cursor-ns-resize hover:bg-i3x-primary/50 transition-colors ${
              isResizing ? 'bg-i3x-primary' : ''
            }`}
            onMouseDown={handleMouseDown}
          />
        </>
      )}
    </div>
  )
}

// Trend chart for numeric data
function HistoryTrendChart({ data }: { data: HistoryDataPoint[] }) {
  const { path, yMin, yMax, yTicks, xLabels, plotWidth, chartWidth } = useMemo(() => {
    if (data.length < 2) {
      return { path: '', yMin: 0, yMax: 100, yTicks: [], xLabels: [], plotWidth: 0, chartWidth: 0 }
    }

    // Convert values to numbers
    const points = data.map(d => ({
      timestamp: new Date(d.timestamp).getTime(),
      value: typeof d.value === 'number' ? d.value : Number(d.value)
    }))

    // Calculate chart width based on data points (min 400, scale with data)
    const chartWidth = Math.max(400, Math.min(1200, points.length * 10))
    const plotWidth = chartWidth - PADDING.left - PADDING.right
    const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom

    // Calculate Y axis range
    const values = points.map(p => p.value)
    let minVal = Math.min(...values)
    let maxVal = Math.max(...values)

    const range = maxVal - minVal || 1
    minVal = minVal - range * 0.1
    maxVal = maxVal + range * 0.1

    // Generate Y ticks
    const yTickCount = 4
    const yTicks: number[] = []
    for (let i = 0; i <= yTickCount; i++) {
      yTicks.push(minVal + (maxVal - minVal) * (i / yTickCount))
    }

    // Calculate X axis range
    const minTime = points[0].timestamp
    const maxTime = points[points.length - 1].timestamp
    const timeRange = maxTime - minTime || 1

    // Generate path
    const pathPoints = points.map((point, i) => {
      const x = PADDING.left + ((point.timestamp - minTime) / timeRange) * plotWidth
      const y = PADDING.top + plotHeight - ((point.value - minVal) / (maxVal - minVal)) * plotHeight
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })

    // Generate X labels
    const xLabels = [
      { x: PADDING.left, label: formatTime(minTime) },
      { x: PADDING.left + plotWidth / 2, label: formatTime(minTime + timeRange / 2) },
      { x: PADDING.left + plotWidth, label: formatTime(maxTime) }
    ]

    return {
      path: pathPoints.join(' '),
      yMin: minVal,
      yMax: maxVal,
      yTicks,
      xLabels,
      plotWidth,
      chartWidth
    }
  }, [data])

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-i3x-text-muted h-24 bg-i3x-surface rounded">
        Not enough data points for trend
      </div>
    )
  }

  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom

  return (
    <div className="overflow-x-auto">
      <svg
        width={chartWidth}
        height={CHART_HEIGHT}
        className="bg-i3x-surface rounded"
      >
        {/* Grid lines */}
        {yTicks.map((tick, i) => {
          const y = PADDING.top + plotHeight - ((tick - yMin) / (yMax - yMin)) * plotHeight
          return (
            <g key={i}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={PADDING.left + plotWidth}
                y2={y}
                stroke="#333333"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <text
                x={PADDING.left - 5}
                y={y + 3}
                textAnchor="end"
                fill="#808080"
                fontSize="9"
              >
                {formatValue(tick)}
              </text>
            </g>
          )
        })}

        {/* X axis labels */}
        {xLabels.map((label, i) => (
          <text
            key={i}
            x={label.x}
            y={CHART_HEIGHT - 5}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            fill="#808080"
            fontSize="9"
          >
            {label.label}
          </text>
        ))}

        {/* Data line */}
        <path
          d={path}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

// Table for complex data
function HistoryTable({ data }: { data: HistoryDataPoint[] }) {
  // Get all unique keys from complex values
  const columns = useMemo(() => {
    const keys = new Set<string>(['timestamp', 'quality'])
    for (const point of data) {
      if (point.value && typeof point.value === 'object') {
        Object.keys(point.value as object).forEach(k => keys.add(k))
      } else {
        keys.add('value')
      }
    }
    return Array.from(keys)
  }, [data])

  const getCellValue = (point: HistoryDataPoint, column: string): string => {
    if (column === 'timestamp') {
      return new Date(point.timestamp).toLocaleString()
    }
    if (column === 'quality') {
      return point.quality || '-'
    }
    if (column === 'value') {
      const val = point.value
      if (val === null || val === undefined) return '-'
      if (typeof val === 'object') return JSON.stringify(val)
      return String(val)
    }
    // For complex objects
    if (point.value && typeof point.value === 'object') {
      const obj = point.value as Record<string, unknown>
      const val = obj[column]
      if (val === null || val === undefined) return '-'
      if (typeof val === 'object') return JSON.stringify(val)
      return String(val)
    }
    return '-'
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse min-w-full">
        <thead>
          <tr className="bg-i3x-surface">
            {columns.map(col => (
              <th
                key={col}
                className="px-3 py-2 text-left font-medium text-i3x-text border-b border-i3x-border whitespace-nowrap"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((point, i) => (
            <tr key={i} className="hover:bg-i3x-surface/50">
              {columns.map(col => (
                <td
                  key={col}
                  className="px-3 py-1.5 text-i3x-text-muted border-b border-i3x-border whitespace-nowrap"
                >
                  {getCellValue(point, col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0)
  } else if (Math.abs(value) >= 1) {
    return value.toFixed(1)
  } else {
    return value.toFixed(2)
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
