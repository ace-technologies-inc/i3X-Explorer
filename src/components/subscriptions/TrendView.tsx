import { useMemo } from 'react'
import { useSubscriptionsStore } from '../../stores/subscriptions'

// Colors
const COLORS = {
  bg: '#1e1e1e',
  surface: '#252526',
  border: '#3c3c3c',
  text: '#cccccc',
  textMuted: '#808080',
  primary: '#3b82f6',
  success: '#22c55e',
  grid: '#333333'
}

// Chart dimensions
const CHART_WIDTH = 400
const CHART_HEIGHT = 120
const PADDING = { top: 10, right: 10, bottom: 25, left: 50 }
const PLOT_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const PLOT_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

interface TrendViewProps {
  elementId: string
}

export function TrendView({ elementId }: TrendViewProps) {
  const trendData = useSubscriptionsStore(
    (state) => state.trendData.get(elementId) || []
  )

  const { path, yMin, yMax, yTicks, xLabels } = useMemo(() => {
    if (trendData.length < 2) {
      return { path: '', yMin: 0, yMax: 100, yTicks: [], xLabels: [] }
    }

    // Calculate Y axis range
    const values = trendData.map(p => p.value)
    let minVal = Math.min(...values)
    let maxVal = Math.max(...values)

    // Add some padding to the range
    const range = maxVal - minVal || 1
    minVal = minVal - range * 0.1
    maxVal = maxVal + range * 0.1

    // Generate Y ticks
    const yTickCount = 4
    const yTicks: number[] = []
    for (let i = 0; i <= yTickCount; i++) {
      yTicks.push(minVal + (maxVal - minVal) * (i / yTickCount))
    }

    // Calculate X axis range (time)
    const minTime = trendData[0].timestamp
    const maxTime = trendData[trendData.length - 1].timestamp
    const timeRange = maxTime - minTime || 1

    // Generate path
    const pathPoints = trendData.map((point, i) => {
      const x = PADDING.left + ((point.timestamp - minTime) / timeRange) * PLOT_WIDTH
      const y = PADDING.top + PLOT_HEIGHT - ((point.value - minVal) / (maxVal - minVal)) * PLOT_HEIGHT
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })

    // Generate X labels (time)
    const xLabels = [
      { x: PADDING.left, label: formatTime(minTime) },
      { x: PADDING.left + PLOT_WIDTH, label: formatTime(maxTime) }
    ]

    return {
      path: pathPoints.join(' '),
      yMin: minVal,
      yMax: maxVal,
      yTicks,
      xLabels
    }
  }, [trendData])

  if (trendData.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-xs"
        style={{
          width: CHART_WIDTH,
          height: CHART_HEIGHT,
          backgroundColor: COLORS.surface,
          borderRadius: '6px',
          color: COLORS.textMuted
        }}
      >
        Waiting for data...
      </div>
    )
  }

  return (
    <svg
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      style={{ backgroundColor: COLORS.surface, borderRadius: '6px' }}
    >
      {/* Grid lines */}
      {yTicks.map((tick, i) => {
        const y = PADDING.top + PLOT_HEIGHT - ((tick - yMin) / (yMax - yMin)) * PLOT_HEIGHT
        return (
          <g key={i}>
            <line
              x1={PADDING.left}
              y1={y}
              x2={PADDING.left + PLOT_WIDTH}
              y2={y}
              stroke={COLORS.grid}
              strokeWidth="1"
              strokeDasharray="2,2"
            />
            <text
              x={PADDING.left - 5}
              y={y + 3}
              textAnchor="end"
              fill={COLORS.textMuted}
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
          textAnchor={i === 0 ? 'start' : 'end'}
          fill={COLORS.textMuted}
          fontSize="9"
        >
          {label.label}
        </text>
      ))}

      {/* Data line */}
      <path
        d={path}
        fill="none"
        stroke={COLORS.success}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Current value dot */}
      {trendData.length > 0 && (() => {
        const last = trendData[trendData.length - 1]
        const minTime = trendData[0].timestamp
        const maxTime = last.timestamp
        const timeRange = maxTime - minTime || 1
        const x = PADDING.left + ((last.timestamp - minTime) / timeRange) * PLOT_WIDTH
        const y = PADDING.top + PLOT_HEIGHT - ((last.value - yMin) / (yMax - yMin)) * PLOT_HEIGHT
        return (
          <circle
            cx={x}
            cy={y}
            r="4"
            fill={COLORS.success}
          />
        )
      })()}
    </svg>
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
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
