import { useExplorerStore, type InsightsSection } from '../../stores/explorer'
import { useInsightsReport } from '../../data/useInsightsReport'
import { HomePage } from '../main/homePrimitives'
import { InfoHint } from '../main/InfoHint'
import { SegmentedControl } from '../main/primitives'
import { ConventionsSection } from './ConventionsSection'
import { SummarySection } from './SummarySection'
import { TypesSection } from './TypesSection'

/**
 * Model insights: Home's third tab. It is a tab, not a page that opens over
 * Home and has to be closed: it used to be one, with a Close button, and was
 * the only part of Home that worked that way.
 *
 * Three views, one question each, switched by the control above them.
 * **Summary** is what stands out (conventions with exceptions, types kept in
 * two places, objects breaking several conventions, objects to check).
 * **Conventions** is every rule the model keeps, by type. **Types** is where
 * each kind of data lives. A segmented control and not a second tab strip: a
 * strip of tabs directly under Home's own would read as one more level of the
 * same thing.
 *
 * It is drawn like the rest of Home: cards, a meter or a bar wherever there is
 * a share or a size, no icons, and nothing a count could say left as a
 * sentence.
 *
 * The report comes from useInsightsReport, computed off the main thread and
 * shared with the summary card on the Overview tab, so opening this tab after
 * it never recomputes. The view lives in the store (`insightsSection`), so Back
 * from an object lands on the view it was opened from.
 */

const SECTIONS: { value: InsightsSection; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'conventions', label: 'Conventions' },
  { value: 'types', label: 'Types' },
]

export function InsightsView() {
  const allObjects = useExplorerStore(state => state.allObjects)
  const objectTypes = useExplorerStore(state => state.objectTypes)
  const namespaceCount = useExplorerStore(state => state.namespaces.length)
  const isLoading = useExplorerStore(state => state.isLoading)
  const section = useExplorerStore(state => state.insightsSection)
  const setSection = useExplorerStore(state => state.setInsightsSection)

  const report = useInsightsReport(allObjects, objectTypes, namespaceCount)?.report

  if (allObjects.length === 0 && !isLoading) {
    return <Message title="No model loaded" detail="Connect to a server to load the model." />
  }
  if (!report) return <Message title="Analyzing the model…" status />

  return (
    <>
      {/* Outside the scrolling page, so the way between the views stays put while a long list scrolls. */}
      <div className="w-full max-w-[1600px] px-3 sm:px-5 pt-4 flex items-center gap-2.5">
        <SegmentedControl label="Model insights view" value={section} options={SECTIONS} onChange={setSection} />
        <InfoHint label="How is this computed?" title="Model insights" align="left">
          Everything here is an exact count over the catalog you have loaded. No sampling, no
          machine learning, no extra requests. It reads two things: which object each object says
          its parent is, and what everything is called.
        </InfoHint>
      </div>

      {/* Keyed by view, so each one opens at its top instead of inheriting the last one's scroll position. */}
      <HomePage key={section}>
        {section === 'conventions' ? (
          <ConventionsSection report={report} />
        ) : section === 'types' ? (
          <TypesSection profiles={report.profiles} />
        ) : (
          <SummarySection report={report} onOpenSection={setSection} />
        )}
      </HomePage>
    </>
  )
}

function Message({ title, detail, status = false }: { title: string; detail?: string; status?: boolean }) {
  return (
    <div className="flex-1 grid place-items-center p-6 text-center" role={status ? 'status' : undefined}>
      <div>
        <p className="text-[14px] text-i3x-text-muted">{title}</p>
        {detail && <p className="text-[13px] text-i3x-text-muted mt-1">{detail}</p>}
      </div>
    </div>
  )
}
