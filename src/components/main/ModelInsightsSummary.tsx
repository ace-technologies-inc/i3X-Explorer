import { useMemo } from 'react'
import { useExplorerStore } from '../../stores/explorer'
import { buildRules, ruleStatement } from '../insights/Rules'
import type { InsightsReport } from './insightsReport'
import type { ModelStats } from './modelStats'
import { LinkButton, MiniFigure, Panel } from './homePrimitives'
import { Meter } from './homeCharts'

/**
 * The Model insights tab in one card on the Overview tab, and a door to it: how
 * many conventions the model keeps, how many are broken, how many objects need
 * a look, and the strongest exceptions each as a meter of how nearly the
 * convention holds.
 *
 * Always drawn while a catalog is loaded, including for a clean model: "36
 * conventions, none broken" is a finding too.
 */

/** Strongest exceptions listed here; the tab has them all, explained. */
const TOP_EXCEPTIONS = 3

/** "37 orphaned, 12 untyped": what is wrong with the objects that need a look. */
export function qualityBreakdown(report: InsightsReport, stats: ModelStats): string {
  const duplicates = Math.max(0, report.summary.dataQualityIssues - stats.orphans - stats.untyped)
  return [
    stats.orphans > 0 ? `${stats.orphans.toLocaleString()} orphaned` : null,
    stats.untyped > 0 ? `${stats.untyped.toLocaleString()} untyped` : null,
    duplicates > 0 ? `${duplicates.toLocaleString()} duplicate ${duplicates === 1 ? 'ID' : 'IDs'}` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

export function ModelInsightsSummary({
  report,
  stats,
  className = '',
}: {
  report: InsightsReport
  stats: ModelStats
  className?: string
}) {
  const setHomeTab = useExplorerStore(state => state.setHomeTab)
  const setInsightsSection = useExplorerStore(state => state.setInsightsSection)
  // Its Summary view, whichever view the tab was last on: that is where these rows are, with their exceptions.
  const open = () => {
    setInsightsSection('summary')
    setHomeTab('insights')
  }
  const { summary } = report

  // The same rows, in the same words and order, as the tab's own list.
  const exceptions = useMemo(() => buildRules(report).broken, [report])

  return (
    <Panel title="Model insights" action={<LinkButton onClick={open}>Open model insights</LinkButton>} className={className}>
      <div className="grid grid-cols-3 gap-4">
        <MiniFigure value={summary.conventions.toLocaleString()} label="Conventions" />
        <MiniFigure value={summary.conventionsWithExceptions.toLocaleString()} label="With exceptions" />
        <MiniFigure
          value={summary.dataQualityIssues.toLocaleString()}
          label="Objects to check"
          note={qualityBreakdown(report, stats) || undefined}
        />
      </div>

      {exceptions.length > 0 && (
        <div className="mt-5 pt-4 border-t border-i3x-border">
          <div className="text-[12.5px] text-i3x-text-muted">
            {exceptions.length > TOP_EXCEPTIONS
              ? `Conventions with exceptions, the ${TOP_EXCEPTIONS} most widely kept of ${exceptions.length.toLocaleString()}`
              : 'Conventions with exceptions'}
          </div>
          <ul className="mt-3 space-y-3.5">
            {exceptions.slice(0, TOP_EXCEPTIONS).map(rule => {
              const { conforming, total } = rule.convention
              const outliers = rule.deviation!.outlierCount
              const statement = ruleStatement(rule)
              return (
                <li key={rule.key}>
                  <button
                    type="button"
                    onClick={open}
                    title={`${statement} · open in Model insights`}
                    className="group block w-full text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words text-[13px] text-i3x-text group-hover:text-i3x-primary">{statement}</span>
                      <span className="shrink-0 text-[12.5px] text-i3x-text-muted tabular-nums">
                        {outliers.toLocaleString()} {outliers === 1 ? 'exception' : 'exceptions'}
                      </span>
                    </span>
                    <Meter
                      className="mt-1.5"
                      value={conforming}
                      max={total}
                      label={`${statement}: ${conforming.toLocaleString()} of ${total.toLocaleString()} do`}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
          {exceptions.length > TOP_EXCEPTIONS && (
            <div className="mt-3.5">
              <LinkButton onClick={open}>All {exceptions.length.toLocaleString()} conventions with exceptions</LinkButton>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
