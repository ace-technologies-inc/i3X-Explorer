import {
  BUCKET_COLOR,
  BUCKET_DASH,
  BUCKET_LABEL,
  COMPOSITION_DASH,
  type RelationshipBucket,
} from './relationshipColors'

/**
 * The color key for both graphs. Rendered as HTML beneath its diagram's
 * container rather than inside the drawing, so it never overlaps nodes and it
 * wraps on a narrow pane.
 *
 * `buckets` names the edge kinds actually present in the diagram, showing a
 * key for an edge type that can't appear would be a lie.
 */
export function RelationshipLegend({
  buckets,
  showNodeStyles = true,
  className = '',
}: {
  buckets: RelationshipBucket[]
  /** Composition vs Leaf/Value swatches. */
  showNodeStyles?: boolean
  className?: string
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-i3x-text-muted ${className}`}
    >
      {buckets.map(bucket => (
        <span key={bucket} className="inline-flex items-center gap-2">
          <LineSwatch color={BUCKET_COLOR[bucket]} dash={BUCKET_DASH[bucket]} />
          {BUCKET_LABEL[bucket]}
        </span>
      ))}

      {showNodeStyles && (
        <>
          <span className="inline-flex items-center gap-2">
            <BoxSwatch fill="rgb(var(--i3x-bg))" dash={COMPOSITION_DASH} />
            Composition
          </span>
          <span className="inline-flex items-center gap-2">
            <BoxSwatch fill="rgb(var(--i3x-surface))" dash={null} />
            Leaf/Value
          </span>
        </>
      )}
    </div>
  )
}

function LineSwatch({ color, dash }: { color: string; dash: number[] | null }) {
  return (
    <svg width="25" height="8" aria-hidden="true" className="flex-shrink-0 overflow-visible">
      <line
        x1="0"
        y1="4"
        x2="25"
        y2="4"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dash ? dash.join(',') : undefined}
      />
    </svg>
  )
}

function BoxSwatch({ fill, dash }: { fill: string; dash: number[] | null }) {
  return (
    <svg width="25" height="12" aria-hidden="true" className="flex-shrink-0">
      <rect
        x="0.75"
        y="0.75"
        width="23.5"
        height="10.5"
        rx="2"
        fill={fill}
        stroke="rgb(var(--i3x-border))"
        strokeWidth="1.5"
        strokeDasharray={dash ? dash.join(',') : undefined}
      />
    </svg>
  )
}
