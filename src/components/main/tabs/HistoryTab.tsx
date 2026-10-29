import { useState, useCallback, useMemo } from 'react'
import { useConnectionStore } from '../../../stores/connection'
import { describeGetHistory } from '../../../api/requestShape'
import type { HistoricalValue, ObjectInstance } from '../../../api/types'
import { errorText, useObjectHistory } from '../../../data/queries'
import { Card } from '../primitives'
import { Spinner } from '../../common/Spinner'
import { CardCodeSample } from '../../details/CodeSamplePanel'
import { buildObjectRequestTabs } from '../../details/requestTabs'

interface HistoryDataPoint {
  timestamp: string
  value: unknown
  quality?: string
}

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
  { value: 'custom', label: 'Custom range' }
]

// Chart constants
const CHART_HEIGHT = 200
const PADDING = { top: 10, right: 10, bottom: 25, left: 50 }

const inputClass =
  'px-2 py-1 text-xs bg-i3x-bg border border-i3x-border rounded-lg text-i3x-text focus:outline-none focus:ring-1 focus:ring-i3x-primary'

/**
 * Chartable points from a history response, oldest first. Null values are kept:
 * the trend chart draws them as gaps, so dropping them would hide periods where
 * the server returned no data.
 */
function historyPoints(result: HistoricalValue | undefined): HistoryDataPoint[] {
  if (!result || !Array.isArray(result.value)) return []
  const points: HistoryDataPoint[] = []
  for (const item of result.value) {
    if (item && typeof item === 'object' && 'timestamp' in item) {
      points.push({
        timestamp: item.timestamp as string,
        value: (item as Record<string, unknown>).value,
        quality: item.quality as string | undefined,
      })
    }
  }
  return points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

export function HistoryTab({ object }: { object: ObjectInstance }) {
  const [selectedTimespan, setSelectedTimespan] = useState<TimespanPreset>('1h')
  const [customStartTime, setCustomStartTime] = useState('')
  const [customEndTime, setCustomEndTime] = useState('')

  const isConnected = useConnectionStore(state => state.isConnected)
  const elementId = object.elementId

  // Presets are relative to now, so the range is resolved when the request is made.
  const resolveRange = useCallback(() => {
    if (selectedTimespan === 'custom') {
      return { startTime: new Date(customStartTime).toISOString(), endTime: new Date(customEndTime).toISOString() }
    }
    const preset = TIMESPAN_OPTIONS.find(o => o.value === selectedTimespan)
    const ms = preset?.ms ?? 60 * 60 * 1000
    return { startTime: new Date(Date.now() - ms).toISOString(), endTime: new Date().toISOString() }
  }, [selectedTimespan, customStartTime, customEndTime])
  const rangeKey = selectedTimespan === 'custom' ? `custom:${customStartTime}|${customEndTime}` : selectedTimespan
  const historyQuery = useObjectHistory(elementId, rangeKey, resolveRange)

  const historyData = useMemo(() => historyPoints(historyQuery.data), [historyQuery.data])
  const isLoading = historyQuery.isFetching
  const error = errorText(historyQuery.error, 'Failed to fetch history')
  const hasLoaded = historyQuery.data !== undefined
  const fetchHistory = () => {
    if (isConnected) void historyQuery.refetch()
  }

  // Determine if data is simple (numeric) or complex.
  // Find the first non-null value to determine type (data may have gaps).
  const dataType = useMemo(() => {
    if (historyData.length === 0) return 'empty'
    const firstNonNullPoint = historyData.find(d => d.value !== null && d.value !== undefined)
    if (!firstNonNullPoint) return 'empty'
    const firstValue = firstNonNullPoint.value
    if (typeof firstValue === 'number') return 'numeric'
    if (typeof firstValue === 'boolean') return 'boolean'
    if (typeof firstValue === 'string') {
      if (!isNaN(Number(firstValue))) return 'numeric'
      return 'string'
    }
    return 'complex'
  }, [historyData])

  const customIncomplete = selectedTimespan === 'custom' && (!customStartTime || !customEndTime)

  // The exact range the next request would carry, mirroring fetchHistory so the
  // code sample matches the call. Presets are relative to now; custom is literal.
  const sampleRange = useMemo(() => {
    if (selectedTimespan === 'custom') {
      return {
        startTime: customStartTime ? new Date(customStartTime).toISOString() : undefined,
        endTime: customEndTime ? new Date(customEndTime).toISOString() : undefined,
      }
    }
    const preset = TIMESPAN_OPTIONS.find(o => o.value === selectedTimespan)
    const ms = preset?.ms ?? 60 * 60 * 1000
    return {
      startTime: new Date(Date.now() - ms).toISOString(),
      endTime: new Date().toISOString(),
    }
  }, [selectedTimespan, customStartTime, customEndTime])

  // The full object request set, but the History tab keeps the range the user
  // actually has selected here rather than the shared default window.
  const requestTabs = useMemo(() => {
    const tabs = buildObjectRequestTabs(object)
    return tabs.map(tab =>
      tab.id === 'history'
        ? {
            ...tab,
            descriptor: describeGetHistory(
              elementId,
              sampleRange.startTime,
              sampleRange.endTime,
              1
            ),
          }
        : tab
    )
  }, [object, elementId, sampleRange])

  return (
    <Card
      title={`History · ${object.displayName}`}
      actions={
        <>
          {historyData.length > 0 && (
            <span className="font-mono text-[11px] normal-case tracking-normal text-i3x-text-muted">
              {historyData.length} points
            </span>
          )}
          <CardCodeSample
            tabs={requestTabs}
            initialTabId="history"
            title={object.displayName}
            subtitle="Object Instance"
          />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label htmlFor="history-range" className="text-xs text-i3x-text-muted">
          Range:
        </label>
        <select
          id="history-range"
          value={selectedTimespan}
          onChange={e => setSelectedTimespan(e.target.value as TimespanPreset)}
          className={inputClass}
        >
          {TIMESPAN_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {selectedTimespan === 'custom' && (
          <>
            <label htmlFor="history-from" className="text-xs text-i3x-text-muted">From:</label>
            <input
              id="history-from"
              type="datetime-local"
              value={customStartTime}
              onChange={e => setCustomStartTime(e.target.value)}
              className={inputClass}
            />
            <label htmlFor="history-to" className="text-xs text-i3x-text-muted">To:</label>
            <input
              id="history-to"
              type="datetime-local"
              value={customEndTime}
              onChange={e => setCustomEndTime(e.target.value)}
              className={inputClass}
            />
          </>
        )}

        <button
          type="button"
          onClick={fetchHistory}
          disabled={isLoading || !isConnected || customIncomplete}
          className="flex items-center gap-1.5 px-3 py-1 text-xs bg-i3x-primary text-white rounded-lg hover:bg-i3x-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          {isLoading ? <><Spinner size={11} /> Loading…</> : hasLoaded ? 'Reload' : 'Load History'}
        </button>
      </div>

      {error && <p className="text-xs text-i3x-error">{error}</p>}

      {!error && historyData.length === 0 && isLoading && (
        <p className="flex items-center gap-2 text-xs text-i3x-text-muted py-6">
          <Spinner size={13} />
          Loading history…
        </p>
      )}

      {!error && historyData.length === 0 && !isLoading && (
        <p className="text-xs text-i3x-text-muted py-6">
          {hasLoaded
            ? 'No history data available for the selected time range.'
            : 'Choose a range and load history for this element.'}
        </p>
      )}

      {!error && historyData.length > 0 && (
        <>
          {dataType === 'numeric' && <HistoryTrendChart data={historyData} />}
          {dataType !== 'numeric' && <HistoryTable data={historyData} />}
        </>
      )}
    </Card>
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

    const chartWidth = Math.max(400, Math.min(1200, points.length * 10))
    const plotWidth = chartWidth - PADDING.left - PADDING.right
    const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom

    const validValues = points.filter(p => p.value !== null).map(p => p.value as number)
    if (validValues.length === 0) {
      return { linePath: '', areaPath: '', yMin: 0, yMax: 100, yTicks: [], xLabels: [], plotWidth: 0, chartWidth: 0 }
    }

    let minVal = validValues.reduce((a, b) => a < b ? a : b, validValues[0])
    let maxVal = validValues.reduce((a, b) => a > b ? a : b, validValues[0])

    const range = maxVal - minVal || 1
    minVal = minVal - range * 0.1
    maxVal = maxVal + range * 0.1

    const yTickCount = 4
    const yTicks: number[] = []
    for (let i = 0; i <= yTickCount; i++) {
      yTicks.push(minVal + (maxVal - minVal) * (i / yTickCount))
    }

    const minTime = points[0].timestamp
    const maxTime = points[points.length - 1].timestamp
    const timeRange = maxTime - minTime || 1

    // Bottom of the chart (for area fill)
    const bottomY = PADDING.top + plotHeight

    // Area path closes back to the bottom to create a filled region
    const linePathParts: string[] = []
    const areaSegments: string[] = []
    let currentAreaSegment: { x: number; y: number }[] = []

    for (const point of points) {
      const x = PADDING.left + ((point.timestamp - minTime) / timeRange) * plotWidth

      if (point.value === null) {
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
        const isFirst = linePathParts.length === 0 || currentAreaSegment.length === 0
        linePathParts.push(`${isFirst ? 'M' : 'L'} ${x} ${y}`)
        currentAreaSegment.push({ x, y })
      }
    }

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
      <div className="flex items-center justify-center text-xs text-i3x-text-muted h-24 bg-i3x-bg border border-i3x-border rounded-lg">
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
        role="img"
        aria-label={`Trend chart of ${data.length} historical values`}
        className="bg-i3x-bg border border-i3x-border rounded-lg"
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

        <path d={areaPath} fill="rgb(var(--i3x-primary))" fillOpacity={0.25} stroke="none" />
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
          <tr>
            {columns.map(col => (
              <th
                key={col}
                scope="col"
                className="px-3 py-2 text-left font-medium text-i3x-text-muted uppercase tracking-wide border-b border-i3x-border whitespace-nowrap"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((point, i) => (
            <tr key={i} className="hover:bg-i3x-bg/50">
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
