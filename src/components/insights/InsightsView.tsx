import { useEffect, useState, type ReactNode } from 'react'
import { useExplorerStore } from '../../stores/explorer'
import type { InsightsSummary } from '../main/insightsReport'
import { useInsightsReport } from '../../data/useInsightsReport'
import { InfoHint } from '../main/InfoHint'
import { CloseIcon } from '../common/icons'
import { TypeAtlas } from './TypeAtlas'
import { ConventionsSection } from './ConventionsSection'
import { DeviationsSection } from './DeviationsSection'
import { SplitsSection } from './SplitsSection'
import { DataQualitySection } from './DataQualitySection'
import { AnomaliesSection } from './AnomaliesSection'

/**
 * The Model Insights page: a main-panel state alongside Home, element detail
 * and the diff view. Organized around the questions an engineer brings to a
 * single source of truth: where does this kind of data live (type atlas),
 * what does the model promise (conventions), what breaks the promises
 * (deviations, explained), where is the model genuinely two things (splits),
 * and what can't be trusted (data quality).
 *
 * The report comes from useInsightsReport, computed off the main thread and
 * shared with the Home card, so opening this page after it never recomputes.
 * The page is a stop in the navigation
 * history (`activePage` in stores/explorer.ts): navigating away leaves it, and
 * Back comes straight back to it.
 */

/** Section anchors, shared by the tiles and the section wrappers. */
const SECTION_IDS = {
  atlas: 'insights-atlas',
  conventions: 'insights-conventions',
  deviations: 'insights-deviations',
  splits: 'insights-splits',
  quality: 'insights-quality',
} as const

/** How long the target section keeps its highlight after a tile is used. */
const FLASH_MS = 1400

export function InsightsView() {
  const closeView = useExplorerStore(s => s.closePage)
  const allObjects = useExplorerStore(s => s.allObjects)
  const objectTypes = useExplorerStore(s => s.objectTypes)
  const namespaceCount = useExplorerStore(s => s.namespaces.length)

  const report = useInsightsReport(allObjects, objectTypes, namespaceCount)?.report

  // A fresh object per click, so clicking the same tile twice re-triggers.
  const [flash, setFlash] = useState<{ id: string } | null>(null)
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  // The tiles used to only scroll, which on a short page did nothing visible.
  // Now they also hand the section keyboard focus (so the next Tab lands
  // inside it) and highlight it, which is a real jump rather than a nudge.
  const goToSection = (id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    target.focus({ preventScroll: true })
    setFlash({ id })
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-i3x-bg">
      <header className="px-3 sm:px-5 py-4 bg-i3x-surface border-b border-i3x-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-i3x-text flex items-center gap-2">
            Model insights
            <InfoHint label="How is this computed?" title="Model insights">
              Everything here is an exact count over the catalog you have loaded. No sampling, no
              machine learning, no extra requests. It reads two things: which object each object
              says its parent is, and what everything is called.
            </InfoHint>
          </h1>
          <p className="text-xs text-i3x-text-muted mt-1">
            The schema the instances imply: conventions the model follows, the exceptions that
            break them, and where the data actually lives.
          </p>
        </div>
        <button
          onClick={closeView}
          title="Close model insights"
          aria-label="Close model insights"
          className="p-1.5 rounded text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg transition-colors motion-reduce:transition-none shrink-0"
        >
          <CloseIcon size={15} />
        </button>
      </header>

      {allObjects.length === 0 ? (
        <div className="flex-1 grid place-items-center p-6 text-center">
          <div>
            <p className="text-sm text-i3x-text-muted">No model loaded</p>
            <p className="text-xs text-i3x-text-muted/70 mt-1">
              Connect to a server to analyze its catalog.
            </p>
          </div>
        </div>
      ) : !report ? (
        <div className="flex-1 grid place-items-center p-6 text-center">
          <p className="text-sm text-i3x-text-muted">Analyzing the catalog…</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
          <SummaryTiles summary={report.summary} onGo={goToSection} />

          <Section id={SECTION_IDS.atlas} flashed={flash?.id === SECTION_IDS.atlas}>
            <TypeAtlas profiles={report.profiles} />
          </Section>

          <Section id={SECTION_IDS.conventions} flashed={flash?.id === SECTION_IDS.conventions}>
            <ConventionsSection conventions={report.conventions} />
          </Section>

          <Section id={SECTION_IDS.deviations} flashed={flash?.id === SECTION_IDS.deviations}>
            <DeviationsSection deviations={report.deviations} />
          </Section>

          <Section id={SECTION_IDS.splits} flashed={flash?.id === SECTION_IDS.splits}>
            <SplitsSection splits={report.splits} />
          </Section>

          <Section id={SECTION_IDS.quality} flashed={flash?.id === SECTION_IDS.quality}>
            <DataQualitySection quality={report.dataQuality} />
          </Section>

          <AnomaliesSection anomalies={report.anomalies} />
        </div>
      )}
    </div>
  )
}

/** Focusable jump target. `tabIndex={-1}` makes .focus() legal on a section. */
function Section({
  id,
  flashed,
  children,
}: {
  id: string
  flashed: boolean
  children: ReactNode
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      className={`scroll-mt-2 rounded-xl outline-none transition-shadow motion-reduce:transition-none ${
        flashed ? 'ring-2 ring-i3x-primary/60' : ''
      }`}
    >
      {children}
    </section>
  )
}

function SummaryTiles({
  summary,
  onGo,
}: {
  summary: InsightsSummary
  onGo: (id: string) => void
}) {
  // Conventions and Deviations overlap on purpose: a norm with exceptions is
  // both. Saying so on the tile beats printing two numbers that quietly share
  // rows.
  const conventionCaption = [
    summary.conventionsWithExceptions > 0
      ? `${summary.conventionsWithExceptions.toLocaleString()} also under Deviations`
      : null,
    summary.trivialConventions > 0
      ? `${summary.trivialConventions.toLocaleString()} more match the whole model`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const tiles: { label: string; value: number; caption?: string; target: string }[] = [
    { label: 'Types analyzed', value: summary.typesAnalyzed, target: SECTION_IDS.atlas },
    {
      label: 'Conventions',
      value: summary.conventions,
      caption: conventionCaption || undefined,
      target: SECTION_IDS.conventions,
    },
    {
      label: 'Deviations',
      value: summary.deviations,
      caption: summary.deviations > 0 ? 'exceptions to those conventions' : undefined,
      target: SECTION_IDS.deviations,
    },
    { label: 'Splits', value: summary.splits, target: SECTION_IDS.splits },
    {
      label: 'Data-quality issues',
      value: summary.dataQualityIssues,
      caption:
        summary.unusedTypes > 0
          ? `${summary.unusedTypes.toLocaleString()} unused types, not an issue`
          : undefined,
      target: SECTION_IDS.quality,
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {tiles.map(tile => (
        <button
          key={tile.label}
          type="button"
          aria-controls={tile.target}
          title={`Go to ${tile.label}`}
          onClick={() => onGo(tile.target)}
          className="bg-i3x-surface border border-i3x-border rounded-xl px-4 py-3 text-left hover:border-i3x-primary transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          <div className="text-2xl font-semibold text-i3x-text leading-tight tabular-nums">
            {tile.value.toLocaleString()}
          </div>
          <div className="text-[11px] text-i3x-text-muted mt-0.5">{tile.label}</div>
          {tile.caption && (
            <div className="text-[10.5px] text-i3x-text-muted/70 mt-0.5 leading-snug">
              {tile.caption}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
