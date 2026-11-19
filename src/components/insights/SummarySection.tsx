import { useMemo, useState } from 'react'
import { useExplorerStore, type InsightsSection } from '../../stores/explorer'
import { SegmentedBar, foldParts } from '../main/homeCharts'
import { Kpi, LinkButton, Panel, Toggle } from '../main/homePrimitives'
import { InfoHint } from '../main/InfoHint'
import { useElementNavigation } from '../main/navigation'
import {
  MIN_ANOMALY_SCORE,
  placeLabel,
  type AnomalyEntry,
  type DataQuality,
  type InsightsReport,
  type Split,
  type TypeProfile,
} from '../main/insightsReport'
import { RuleRow, buildRules, ruleStatement } from './Rules'
import { WindowedList } from './WindowedList'
import { ExampleLinks, ROWS_FOOTER, RefList, ShowMore, TypeName, capitalize, contextPhrase, plural, usePaged } from './parts'

/**
 * What stands out in the model: the four numbers that sum it up, then only the
 * things worth a look. A card is drawn when it has something in it, so a clean
 * model gets a short page rather than a row of zeros.
 *
 * Nothing here is a count with no way in. A list shows its first page and a way
 * to the rest; a bar's folded tail opens into what it holds.
 */

/** Conventions with exceptions on the first page of that card. */
const RULES_PER_PAGE = 5
const SPLITS_PER_PAGE = 3
const ANOMALIES_PER_PAGE = 6
/** A split's parts keep their own hue up to this many; past it the tail folds into an "Other" that opens. */
const MAX_NAMED_PLACES = 5

export function SummarySection({
  report,
  onOpenSection,
}: {
  report: InsightsReport
  onOpenSection: (section: InsightsSection) => void
}) {
  const { summary, dataQuality } = report
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())

  const broken = useMemo(() => buildRules(report).broken, [report])
  const rules = usePaged(broken, RULES_PER_PAGE)
  const profiles = useMemo(() => new Map(report.profiles.map(profile => [profile.typeId, profile])), [report])
  const exceptions = report.deviations.reduce((sum, deviation) => sum + deviation.outlierCount, 0)

  const toCheck = [
    dataQuality.orphans.length > 0 ? `${dataQuality.orphans.length.toLocaleString()} orphaned` : null,
    dataQuality.untyped.length > 0 ? `${dataQuality.untyped.length.toLocaleString()} untyped` : null,
    dataQuality.duplicateElementIds.length > 0 ? plural(dataQuality.duplicateElementIds.length, 'duplicate ID') : null,
  ]
    .filter(Boolean)
    .join(', ')

  const toggle = (key: string) =>
    setOpen(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const hasSplits = report.splits.length > 0
  const hasQuality = summary.dataQualityIssues > 0 || dataQuality.unusedTypes.length > 0
  const hasAnomalies = report.anomalies.length > 0

  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi
          label="Conventions"
          value={summary.conventions.toLocaleString()}
          note={
            summary.conventions === 0
              ? undefined
              : summary.conventionsWithExceptions === 0
                ? 'all fully kept'
                : `${summary.conventionsWithExceptions.toLocaleString()} with exceptions`
          }
        />
        {/* Not "objects": one object off three conventions is three exceptions. */}
        <Kpi
          label="Exceptions"
          value={exceptions.toLocaleString()}
          note={exceptions === 0 ? undefined : `to ${plural(broken.length, 'convention')}`}
        />
        <Kpi label="Types in two places" value={summary.splits.toLocaleString()} note="sit under more than one kind of parent" />
        <Kpi label="Objects to check" value={summary.dataQualityIssues.toLocaleString()} note={toCheck || undefined} />
      </div>

      <Panel
        title="Conventions with exceptions"
        note={broken.length > 0 ? `${plural(broken.length, 'convention')}, the most widely kept first` : undefined}
        action={<LinkButton onClick={() => onOpenSection('conventions')}>All conventions</LinkButton>}
      >
        {broken.length === 0 ? (
          <p className="text-[13px] text-i3x-text-muted">
            {summary.conventions === 0
              ? 'No conventions stand out in this model.'
              : `All ${plural(summary.conventions, 'convention')} are kept by every instance of their type.`}
          </p>
        ) : (
          <>
            {/* Rows carry their own padding: pulled flush with the card, except above the paging row. */}
            <div className={`divide-y divide-i3x-border/60 -mt-2.5 ${rules.hidden > 0 ? '' : '-mb-2.5'}`}>
              {rules.shown.map(rule => (
                <RuleRow key={rule.key} rule={rule} text={ruleStatement(rule)} open={open.has(rule.key)} onToggle={() => toggle(rule.key)} />
              ))}
            </div>
            <ShowMore paged={rules} noun="conventions with exceptions" className={ROWS_FOOTER} />
          </>
        )}
      </Panel>

      {/* Two independent columns, so a tall card never leaves a short neighbor padded out to match it. */}
      {(hasSplits || hasQuality || hasAnomalies) && (
        <div className={`grid grid-cols-1 gap-4 items-start ${(hasSplits || hasQuality) && hasAnomalies ? 'xl:grid-cols-2' : ''}`}>
          {(hasSplits || hasQuality) && (
            <div className="space-y-4 min-w-0">
              {hasSplits && <SplitsCard splits={report.splits} profiles={profiles} />}
              {hasQuality && <QualityCard quality={dataQuality} />}
            </div>
          )}
          {hasAnomalies && <AnomaliesCard anomalies={report.anomalies} />}
        </div>
      )}
    </>
  )
}

/**
 * Types whose instances live in two kinds of place, in numbers too large to be
 * mistakes. Each is one whole split by where it sits, which is what a segmented
 * bar is for; calling the smaller part "exceptions" would be a misread.
 *
 * The bar is drawn from the type's whole placement distribution, not from the
 * split's own populations: those fold their tail into one "(elsewhere)" row
 * that names nothing, and a part nobody can open is a dead end.
 */
function SplitsCard({ splits, profiles }: { splits: Split[]; profiles: Map<string, TypeProfile> }) {
  const { selectType } = useElementNavigation()
  const typeIndex = useExplorerStore(state => state.typeIndex)
  const paged = usePaged(splits, SPLITS_PER_PAGE)

  return (
    <Panel
      title={
        <>
          Types in two places
          <InfoHint label="What is this?" title="Types in two places" align="left">
            A type whose instances sit under two different kinds of parent, in numbers too large to
            be mistakes. The smaller group is not a list of exceptions: the model really does keep
            this type in both places. If that surprises you, that is the finding.
          </InfoHint>
        </>
      }
    >
      <div className="space-y-6">
        {paged.shown.map(split => {
          // The populations the split is made of carry examples; its folded tail carries none.
          const populations = split.populations.filter(population => population.examples.length > 0)
          const placements = profiles.get(split.typeId)?.placements ?? split.populations
          return (
            <div key={split.typeId} className="min-w-0">
              <div className="mb-2.5 flex items-baseline gap-2.5">
                <TypeName typeId={split.typeId} label={split.typeLabel} className="text-[13.5px] font-semibold text-i3x-text" />
                <span className="shrink-0 text-[12px] text-i3x-text-muted tabular-nums">{plural(split.total, 'instance')}</span>
              </div>
              <SegmentedBar
                parts={foldParts(
                  placements.map(placement => ({
                    key: placement.parentTypeId ?? placement.parentTypeLabel,
                    label: capitalize(placeLabel(placement.parentTypeId, placement.parentTypeLabel)),
                    value: placement.count,
                    // "At the root" and its kind are places, not types: nothing to open.
                    inert: placement.parentTypeId === null || !typeIndex.has(placement.parentTypeId),
                  })),
                  Math.min(MAX_NAMED_PLACES, Math.max(2, populations.length))
                )}
                unit="instances"
                label={`Where ${split.typeLabel} instances sit`}
                onSelect={selectType}
              />
              {populations.length > 0 && (
                <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 text-[12.5px]">
                  {populations.map(population => (
                    // The place is printed with its examples, because the same names turn up in both.
                    <div key={population.parentTypeId ?? population.parentTypeLabel} className="contents">
                      <span className="text-i3x-text-muted">
                        For example {placeLabel(population.parentTypeId, population.parentTypeLabel)}
                      </span>
                      <ExampleLinks items={population.examples} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <ShowMore paged={paged} noun="types" className="mt-5 pt-3 border-t border-i3x-border/60" />
    </Panel>
  )
}

/**
 * The objects that break several conventions at once. One exception is an
 * exception; several on one object is worth a look. Each convention broken is
 * a dot with its reason beside it, so the count can be read and checked.
 */
function AnomaliesCard({ anomalies }: { anomalies: AnomalyEntry[] }) {
  const { selectElement } = useElementNavigation()
  const paged = usePaged(anomalies, ANOMALIES_PER_PAGE)

  return (
    <Panel
      title={
        <>
          Objects breaking several conventions
          <InfoHint label="How is this counted?" title="Objects breaking several conventions" align="left">
            One line for each separate convention the object breaks: a missing child, an unusual
            parent, a name off the pattern. Every object breaking at least {MIN_ANOMALY_SCORE} is
            listed, the most first.
          </InfoHint>
        </>
      }
      note={`${plural(anomalies.length, 'object')}, the most conventions broken first`}
    >
      <ul className={`divide-y divide-i3x-border/60 -mt-2.5 ${paged.hidden > 0 ? '' : '-mb-2.5'}`}>
        {paged.shown.map(anomaly => (
          <li key={anomaly.elementId} className="py-2.5 min-w-0">
            <div className="flex items-baseline gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => selectElement(anomaly.elementId)}
                title={`${anomaly.elementId} · click to open`}
                className="min-w-0 truncate text-left text-[13px] font-medium text-i3x-text rounded hover:text-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
              >
                {anomaly.label}
              </button>
              <span className="shrink-0 text-[12px] text-i3x-text-muted">
                {anomaly.typeLabel} {contextPhrase(anomaly.context)}
              </span>
              {/* The id is printed because names repeat: two rows here once read character for character the same. */}
              <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-i3x-text-muted" title={anomaly.elementId}>
                {anomaly.elementId}
              </span>
            </div>
            <ul className="mt-1 space-y-0.5" aria-label={`${anomaly.label} breaks ${plural(anomaly.score, 'convention')}`}>
              {anomaly.reasons.map(reason => (
                <li key={reason} className="flex items-start gap-2 text-[12.5px] leading-snug text-i3x-text">
                  <span aria-hidden="true" className="shrink-0 mt-[6px] w-1.5 h-1.5 rounded-full bg-i3x-warning" />
                  <span className="min-w-0 break-words">{capitalize(reason)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <ShowMore paged={paged} noun="objects" className={ROWS_FOOTER} />
    </Panel>
  )
}

type Duplicate = DataQuality['duplicateElementIds'][number]
type UnusedType = DataQuality['unusedTypes'][number]

// Module-level, so the virtualizer is not handed a new key function (and re-measures every row) on each render.
const duplicateKey = (duplicate: Duplicate) => duplicate.elementId
const unusedTypeKey = (type: UnusedType) => type.typeId
const renderDuplicate = (duplicate: Duplicate) => <DuplicateRow duplicate={duplicate} />
const renderUnusedType = (type: UnusedType) => <UnusedTypeRow type={type} />

function DuplicateRow({ duplicate }: { duplicate: Duplicate }) {
  const { selectElement } = useElementNavigation()
  return (
    <button
      type="button"
      onClick={() => selectElement(duplicate.elementId)}
      title={`${duplicate.elementId} · opens the surviving (last) entry`}
      className="group w-full h-7 flex items-baseline gap-2.5 text-left rounded min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
    >
      <span className="text-[12.5px] font-mono text-i3x-text truncate group-hover:text-i3x-primary">{duplicate.elementId}</span>
      <span className="shrink-0 text-[12px] text-i3x-text-muted tabular-nums">used {duplicate.count} times</span>
    </button>
  )
}

function UnusedTypeRow({ type }: { type: UnusedType }) {
  const { selectType } = useElementNavigation()
  return (
    <button
      type="button"
      onClick={() => selectType(type.typeId)}
      title={`${type.typeId} · open this type`}
      className="w-full h-7 flex items-baseline text-left rounded min-w-0 text-[13px] text-i3x-text hover:text-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
    >
      <span className="truncate">{type.label}</span>
    </button>
  )
}

/**
 * What cannot be trusted as it stands, each kind opening onto its objects: a
 * count nobody can inspect is a dead end. Declared types with no instances are
 * listed apart and are not an issue: a namespace is a type library, so a server
 * may well declare types it never instantiates.
 */
function QualityCard({ quality }: { quality: DataQuality }) {
  const [open, setOpen] = useState<string | null>(null)

  const kinds: { key: string; label: string; count: number; issue: boolean; list: React.ReactNode }[] = [
    { key: 'orphans', label: 'Orphaned objects', count: quality.orphans.length, issue: true, list: <RefList items={quality.orphans} /> },
    { key: 'untyped', label: 'Untyped objects', count: quality.untyped.length, issue: true, list: <RefList items={quality.untyped} /> },
    {
      key: 'duplicates',
      label: 'Duplicate IDs',
      count: quality.duplicateElementIds.length,
      issue: true,
      list: (
        <WindowedList
          items={quality.duplicateElementIds}
          estimateHeight={28}
          className="max-h-56"
          getKey={duplicateKey}
          renderRow={renderDuplicate}
        />
      ),
    },
    {
      key: 'unused',
      label: 'Declared types with no instances',
      count: quality.unusedTypes.length,
      issue: false,
      list: (
        <WindowedList
          items={quality.unusedTypes}
          estimateHeight={28}
          className="max-h-56"
          getKey={unusedTypeKey}
          renderRow={renderUnusedType}
        />
      ),
    },
  ]
  const shown = kinds.filter(kind => kind.count > 0)

  return (
    <Panel
      title={
        <>
          Objects to check
          <InfoHint label="What does each mean?" title="Objects to check" align="left">
            An orphan names a parent this catalog doesn't contain, usually a partial load. An untyped
            object carries no <span className="font-mono">typeId</span>, so nothing describes its
            shape. A duplicate ID means one server response used the same id twice, and the last one
            wins everywhere in this app.
            <br />
            <br />
            A declared type with no instances is not a problem: a namespace is a type library, so a
            server can declare types it never uses.
          </InfoHint>
        </>
      }
    >
      <ul className="divide-y divide-i3x-border/60 -my-2">
        {shown.map(kind => (
          <li key={kind.key} className="py-2">
            <div className="flex items-baseline gap-2.5">
              <span
                aria-hidden="true"
                className={`shrink-0 self-center w-1.5 h-1.5 rounded-full ${kind.issue ? 'bg-i3x-warning' : 'bg-i3x-text-muted/50'}`}
              />
              <span className="min-w-0 truncate text-[13px] text-i3x-text">{kind.label}</span>
              {!kind.issue && <span className="shrink-0 text-[12px] text-i3x-text-muted">not an issue</span>}
              <span className="ml-auto">
                <Toggle open={open === kind.key} onToggle={() => setOpen(open === kind.key ? null : kind.key)} label={kind.label.toLowerCase()}>
                  <span className="text-i3x-text tabular-nums">{kind.count.toLocaleString()}</span>
                </Toggle>
              </span>
            </div>
            {open === kind.key && <div className="mt-1.5 ml-1 pl-3 border-l border-i3x-border">{kind.list}</div>}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
