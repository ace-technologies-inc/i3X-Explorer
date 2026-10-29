import { useSubscriptionsStore } from '../../stores/subscriptions'

const WIDTH = 72
const HEIGHT = 18
const PAD = 2

/** A tiny trend of an element's recent numeric values, sized to sit in a table cell. */
export function Sparkline({ elementId }: { elementId: string }) {
  const points = useSubscriptionsStore(state => state.trendData.get(elementId))
  if (!points || points.length < 2) return null

  const values = points.map(p => p.value)
  const min = Math.min(...values)
  const range = Math.max(...values) - min || 1
  const first = points[0].timestamp
  const span = points[points.length - 1].timestamp - first || 1
  const coords = points.map(p => [
    PAD + ((p.timestamp - first) / span) * (WIDTH - 2 * PAD),
    PAD + (1 - (p.value - min) / range) * (HEIGHT - 2 * PAD),
  ])
  const [lastX, lastY] = coords[coords.length - 1]

  return (
    <svg width={WIDTH} height={HEIGHT} aria-hidden="true" className="flex-shrink-0 text-i3x-success">
      <polyline
        points={coords.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="2" fill="currentColor" />
    </svg>
  )
}
