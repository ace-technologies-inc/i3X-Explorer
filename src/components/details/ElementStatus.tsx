// The API returns OPC-style status codes (Good | GoodNoData | Bad | Uncertain).
// A code like "GoodNoData" conflates two orthogonal facets, so everything here
// splits them apart:
//
//   Quality: the code's prefix, carried by COLOR (green / amber / red)
//   Data present: whether the code lacks a "NoData" marker, carried by SHAPE
//                  (solid neutral dot vs hollow neutral ring)
//
// This is the single source of truth for quality rendering; every surface that
// shows a status code goes through StatusFacets.

export type QualityFacet = 'good' | 'uncertain' | 'bad' | 'unknown'

export interface ElementStatus {
  quality: QualityFacet
  /** Human-readable quality prefix, e.g. "Good". Echoes the raw code when unrecognised. */
  qualityLabel: string
  /** False when the code carries a NoData marker, the reading is valid but empty. */
  hasData: boolean
}

/** Codes outside the normative enum fall through to an 'unknown' quality facet. */
export function parseStatusCode(code?: string | null): ElementStatus {
  const raw = code ?? ''
  const lower = raw.toLowerCase()

  let quality: QualityFacet = 'unknown'
  let qualityLabel = raw || 'Unknown'

  if (lower.startsWith('good')) {
    quality = 'good'
    qualityLabel = 'Good'
  } else if (lower.startsWith('bad')) {
    quality = 'bad'
    qualityLabel = 'Bad'
  } else if (lower.startsWith('uncertain')) {
    quality = 'uncertain'
    qualityLabel = 'Uncertain'
  }

  return { quality, qualityLabel, hasData: !/nodata/i.test(raw) }
}

const QUALITY_COLOR: Record<QualityFacet, string> = {
  good: 'text-i3x-success',
  uncertain: 'text-i3x-warning',
  bad: 'text-i3x-error',
  unknown: 'text-i3x-secondary',
}

// Tinted badge form used by the labeled variant, a quiet pill rather than a
// leading dot, so the Current Value status reads as a badge, not a bullet list.
const QUALITY_PILL: Record<QualityFacet, string> = {
  good: 'bg-i3x-success/15 text-i3x-success',
  uncertain: 'bg-i3x-warning/15 text-i3x-warning',
  bad: 'bg-i3x-error/15 text-i3x-error',
  unknown: 'bg-i3x-secondary/15 text-i3x-secondary',
}

const PILL = 'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium'

/** Solid = present, hollow ring = absent. Color is inherited from the wrapper. */
function Dot({ hollow = false }: { hollow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`w-2 h-2 rounded-full flex-shrink-0 ${
        hollow ? 'border-[1.5px] border-current' : 'bg-current'
      }`}
    />
  )
}

interface StatusFacetsProps {
  code?: string | null
  /**
   * 'labeled': two pill badges: "[Good] [Value present]" (Current Value card)
   * 'compact': dots + values, no field labels (Subscriptions table)
   * 'dot': the two dots alone, full code in the tooltip (dense value rows)
   */
  variant?: 'labeled' | 'compact' | 'dot'
  className?: string
}

export function StatusFacets({ code, variant = 'labeled', className = '' }: StatusFacetsProps) {
  const { quality, qualityLabel, hasData } = parseStatusCode(code)
  const dataLabel = hasData ? 'Value present' : 'No data'
  const summary = `Quality: ${qualityLabel}. ${dataLabel}.`

  if (variant === 'dot') {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`} title={code || 'Unknown'}>
        <span className={`inline-flex ${QUALITY_COLOR[quality]}`}>
          <Dot />
        </span>
        <span className="inline-flex text-i3x-text-muted">
          <Dot hollow={!hasData} />
        </span>
        <span className="sr-only">{summary}</span>
      </span>
    )
  }

  // Compact (Subscriptions table): dot + value, no field labels. Unchanged.
  if (variant === 'compact') {
    return (
      <span className={`inline-flex items-center gap-2.5 ${className}`} title={code || 'Unknown'}>
        <span className="sr-only">{summary}</span>
        <span className={`inline-flex items-center gap-1.5 text-xs ${QUALITY_COLOR[quality]}`} aria-hidden="true">
          <Dot />
          <span className="font-medium">{qualityLabel}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-i3x-text-muted" aria-hidden="true">
          <Dot hollow={!hasData} />
          <span className="font-medium">{dataLabel}</span>
        </span>
      </span>
    )
  }

  // Labeled (Current Value): two pill badges. Quality is a tinted pill (color =
  // quality); data-presence is a neutral pill, filled when a value is present and
  // outlined when it isn't, carrying the solid/hollow distinction without a dot.
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} title={code || 'Unknown'}>
      <span className="sr-only">{summary}</span>
      <span className={`${PILL} ${QUALITY_PILL[quality]}`} aria-hidden="true">
        {qualityLabel}
      </span>
      <span
        aria-hidden="true"
        className={`${PILL} text-i3x-text-muted ${
          hasData ? 'bg-i3x-bg' : 'border border-i3x-border'
        }`}
      >
        {dataLabel}
      </span>
    </span>
  )
}
