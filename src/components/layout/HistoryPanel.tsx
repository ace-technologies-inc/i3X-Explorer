import { useState, useCallback, useEffect, useMemo } from 'react'
import { useExplorerStore } from '../../stores/explorer'
import { useConnectionStore } from '../../stores/connection'
import { getClient } from '../../api/client'
import type { HistoricalValue, ObjectInstance } from '../../api/types'

interface HistoryDataPoint {
  timestamp: string
  value: unknown
  quality?: string
}

// Timespan presets
type TimespanPreset = '15s' | '30s' | '1m' | '5m' | '15m' | '30m' | '1h' | '6h' | '24h' | '7d' | '30d' | 'custom'

interface TimespanOption {
  value: TimespanPreset
  label: string
  ms?: number
}

const TIMESPAN_OPTIONS: TimespanOption[] = [
  { value: '15s', label: '15 seconds', ms: 15 * 1000 },
  { value: '30s', label: '30 seconds', ms: 30 * 1000 },
  { value: '1m', label: '1 minute', ms: 60 * 1000 },
  { value: '5m', label: '5 minutes', ms: 5 * 60 * 1000 },
  { value: '15m', label: '15 minutes', ms: 15 * 60 * 1000 },
  { value: '30m', label: '30 minutes', ms: 30 * 60 * 1000 },
  { value: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { value: '6h', label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { value: 'custom', label: 'Custom range' }
]

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
  const [hasLoaded, setHasLoaded] = useState(false)

  // Timespan selection state
  const [selectedTimespan, setSelectedTimespan] = useState<TimespanPreset>('1h')
  const [customStartTime, setCustomStartTime] = useState('')
  const [customEndTime, setCustomEndTime] = useState('')

  const selectedItem = useExplorerStore((state) => state.selectedItem)
  const isConnected = useConnectionStore((state) => state.isConnected)

  const isObjectSelected = selectedItem?.type === 'object'
  // Use the elementId from the data object directly (like ObjectDetail does),
  // rather than the tree node ID which has prefixes like 'obj:' or 'hier:'
  const selectedElementId = isObjectSelected
    ? (selectedItem.data as ObjectInstance).elementId
    : null

  // Clear history when selection changes or connection state changes
  useEffect(() => {
    setHistoryData([])
    setError(null)
    setHasLoaded(false)
  }, [selectedElementId, isConnected])

  const fetchHistory = useCallback(async () => {
    if (!isObjectSelected || !selectedElementId || !isConnected) return

    const client = getClient()
    if (!client) return

    setIsLoading(true)
    setError(null)

    try {
      let startTime: string
      let endTime: string

      if (selectedTimespan === 'custom') {
        if (!customStartTime || !customEndTime) {
          setError('Please select both start and end times')
          setIsLoading(false)
          return
        }
        startTime = new Date(customStartTime).toISOString()
        endTime = new Date(customEndTime).toISOString()
      } else {
        const preset = TIMESPAN_OPTIONS.find(o => o.value === selectedTimespan)
        const ms = preset?.ms ?? 60 * 60 * 1000
        endTime = new Date().toISOString()
        startTime = new Date(Date.now() - ms).toISOString()
      }

      const result: HistoricalValue = await client.getHistory(
        selectedElementId,
        startTime,
        endTime
      )

      // Extract data points from response.
      // Null/undefined values must be preserved for trend charts.
      // The HistoryTrendChart renders nulls as visual gaps in the SVG path
      // using M (move-to) commands. Filtering them out here would hide
      // periods where the server returned no data.
      const points: HistoryDataPoint[] = []
      if (Array.isArray(result.value)) {
        for (const item of result.value) {
          if (item && typeof item === 'object' && 'timestamp' in item) {
            points.push({
              timestamp: item.timestamp as string,
              value: (item as Record<string, unknown>).value,
              quality: item.quality as string | undefined
            })
          }
        }
      }

      // Sort by timestamp
      points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      setHistoryData(points)
      setHasLoaded(true)
      if (isCollapsed) setIsCollapsed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch history')
      setHistoryData([])
    } finally {
      setIsLoading(false)
    }
  }, [selectedElementId, isObjectSelected, isConnected, isCollapsed, selectedTimespan, customStartTime, customEndTime])

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
  // Find the first non-null value to determine type (data may have gaps)
  const dataType = useMemo(() => {
    if (historyData.length === 0) return 'empty'
    const firstNonNullPoint = historyData.find(d => d.value !== null && d.value !== undefined)
    if (!firstNonNullPoint) return 'empty'
    const firstValue = firstNonNullPoint.value
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
              <div className="flex flex-col gap-3">
                {isObjectSelected ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={selectedTimespan}
                        onChange={(e) => setSelectedTimespan(e.target.value as TimespanPreset)}
                        className="px-2 py-1 text-xs bg-i3x-surface border border-i3x-border rounded text-i3x-text focus:outline-none focus:ring-1 focus:ring-i3x-primary"
                      >
                        {TIMESPAN_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={fetchHistory}
                        disabled={selectedTimespan === 'custom' && (!customStartTime || !customEndTime)}
                        className="px-3 py-1 text-xs bg-i3x-primary text-white rounded hover:bg-i3x-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Load History
                      </button>
                    </div>
                    {selectedTimespan === 'custom' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-i3x-text-muted">From:</label>
                        <input
                          type="datetime-local"
                          value={customStartTime}
                          onChange={(e) => setCustomStartTime(e.target.value)}
                          className="px-2 py-1 text-xs bg-i3x-surface border border-i3x-border rounded text-i3x-text focus:outline-none focus:ring-1 focus:ring-i3x-primary"
                        />
                        <label className="text-xs text-i3x-text-muted">To:</label>
                        <input
                          type="datetime-local"
                          value={customEndTime}
                          onChange={(e) => setCustomEndTime(e.target.value)}
                          className="px-2 py-1 text-xs bg-i3x-surface border border-i3x-border rounded text-i3x-text focus:outline-none focus:ring-1 focus:ring-i3x-primary"
                        />
                      </div>
                    )}
                    {hasLoaded && (
                      <p className="text-xs text-i3x-text-muted">No history data available for the selected time range.</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-i3x-text-muted">Select an object to view history.</p>
                )}
              </div>
            )}
            {!error && historyData.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedTimespan}
                    onChange={(e) => setSelectedTimespan(e.target.value as TimespanPreset)}
                    className="px-2 py-1 text-xs bg-i3x-surface border border-i3x-border rounded text-i3x-text focus:outline-none focus:ring-1 focus:ring-i3x-primary"
                  >
                    {TIMESPAN_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {selectedTimespan === 'custom' && (
                    <>
                      <label className="text-xs text-i3x-text-muted">From:</label>
                      <input
                        type="datetime-local"
                        value={customStartTime}
                        onChange={(e) => setCustomStartTime(e.target.value)}
                        className="px-2 py-1 text-xs bg-i3x-surface border border-i3x-border rounded text-i3x-text focus:outline-none focus:ring-1 focus:ring-i3x-primary"
                      />
                      <label className="text-xs text-i3x-text-muted">To:</label>
                      <input
                        type="datetime-local"
                        value={customEndTime}
                        onChange={(e) => setCustomEndTime(e.target.value)}
                        className="px-2 py-1 text-xs bg-i3x-surface border border-i3x-border rounded text-i3x-text focus:outline-none focus:ring-1 focus:ring-i3x-primary"
                      />
                    </>
                  )}
                  <button
                    onClick={fetchHistory}
                    disabled={isLoading || (selectedTimespan === 'custom' && (!customStartTime || !customEndTime))}
                    className="px-3 py-1 text-xs bg-i3x-primary text-white rounded hover:bg-i3x-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Loading...' : 'Reload'}
                  </button>
                </div>
                {dataType === 'numeric' && <HistoryTrendChart data={historyData} />}
                {dataType !== 'numeric' && dataType !== 'empty' && <HistoryTable data={historyData} />}
              </div>
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

// Helper to check if a value is a valid number for charting
function isValidNumber(value: unknown): value is number {
  if (value === null || value === undefined) return false
  const num = typeof value === 'number' ? value : Number(value)
  return !isNaN(num) && isFinite(num)
}

// Trend chart for numeric data (area chart with fill)
function HistoryTrendChart({ data }: { data: HistoryDataPoint[] }) {
  const { linePath, areaPath, yMin, yMax, yTicks, xLabels, plotWidth, chartWidth } = useMemo(() => {
    if (data.length < 2) {
      return { linePath: '', areaPath: '', yMin: 0, yMax: 100, yTicks: [], xLabels: [], plotWidth: 0, chartWidth: 0 }
    }

    // Convert values to numbers, preserving null/NaN as null for gap handling
    const points = data.map(d => ({
      timestamp: new Date(d.timestamp).getTime(),
      value: isValidNumber(d.value)
        ? (typeof d.value === 'number' ? d.value : Number(d.value))
        : null
    }))

    // Calculate chart width based on data points (min 400, scale with data)
    const chartWidth = Math.max(400, Math.min(1200, points.length * 10))
    const plotWidth = chartWidth - PADDING.left - PADDING.right
    const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom

    // Calculate Y axis range (only from valid values)
    const validValues = points.filter(p => p.value !== null).map(p => p.value as number)
    if (validValues.length === 0) {
      return { linePath: '', areaPath: '', yMin: 0, yMax: 100, yTicks: [], xLabels: [], plotWidth: 0, chartWidth: 0 }
    }

    let minVal = validValues.reduce((a, b) => a < b ? a : b, validValues[0])
    let maxVal = validValues.reduce((a, b) => a > b ? a : b, validValues[0])

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

    // Bottom of the chart (for area fill)
    const bottomY = PADDING.top + plotHeight

    // Generate line path and area path
    // Area path closes back to the bottom to create a filled region
    const linePathParts: string[] = []
    const areaSegments: string[] = []
    let currentAreaSegment: { x: number; y: number }[] = []

    for (const point of points) {
      const x = PADDING.left + ((point.timestamp - minTime) / timeRange) * plotWidth

      if (point.value === null) {
        // Close current area segment if we have points
        if (currentAreaSegment.length > 0) {
          const firstX = currentAreaSegment[0].x
          const lastX = currentAreaSegment[currentAreaSegment.length - 1].x
          let segmentPath = `M ${firstX} ${bottomY}`
          for (const pt of currentAreaSegment) {
            segmentPath += ` L ${pt.x} ${pt.y}`
          }
          segmentPath += ` L ${lastX} ${bottomY} Z`
          areaSegments.push(segmentPath)
          currentAreaSegment = []
        }
      } else {
        const y = PADDING.top + plotHeight - ((point.value - minVal) / (maxVal - minVal)) * plotHeight
        // Line path
        const isFirst = linePathParts.length === 0 || currentAreaSegment.length === 0
        linePathParts.push(`${isFirst ? 'M' : 'L'} ${x} ${y}`)
        // Track for area fill
        currentAreaSegment.push({ x, y })
      }
    }

    // Close final area segment
    if (currentAreaSegment.length > 0) {
      const firstX = currentAreaSegment[0].x
      const lastX = currentAreaSegment[currentAreaSegment.length - 1].x
      let segmentPath = `M ${firstX} ${bottomY}`
      for (const pt of currentAreaSegment) {
        segmentPath += ` L ${pt.x} ${pt.y}`
      }
      segmentPath += ` L ${lastX} ${bottomY} Z`
      areaSegments.push(segmentPath)
    }

    // Generate X labels
    const xLabels = [
      { x: PADDING.left, label: formatTime(minTime) },
      { x: PADDING.left + plotWidth / 2, label: formatTime(minTime + timeRange / 2) },
      { x: PADDING.left + plotWidth, label: formatTime(maxTime) }
    ]

    return {
      linePath: linePathParts.join(' '),
      areaPath: areaSegments.join(' '),
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
                stroke="rgb(var(--i3x-border))"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <text
                x={PADDING.left - 5}
                y={y + 3}
                textAnchor="end"
                fill="rgb(var(--i3x-text-muted))"
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
            fill="rgb(var(--i3x-text-muted))"
            fontSize="9"
          >
            {label.label}
          </text>
        ))}

        {/* Area fill */}
        <path
          d={areaPath}
          fill="rgb(var(--i3x-primary))"
          fillOpacity={0.6}
          stroke="none"
        />

        {/* Data line */}
        <path
          d={linePath}
          fill="none"
          stroke="rgb(var(--i3x-primary))"
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
