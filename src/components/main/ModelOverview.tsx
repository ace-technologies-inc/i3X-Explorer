import { useMemo, useState } from 'react'
import type { Namespace, ObjectInstance, ObjectType } from '../../api/types'
import { useExplorerStore } from '../../stores/explorer'
import { listRootObjects, type ModelStats, type ObjectRef, type Tally } from './modelStats'
import { useInsightsReport } from '../../data/useInsightsReport'
import { traceSpan } from '../../diagnostics/perfTrace'
import { WindowedList } from '../insights/WindowedList'
import { ModelInsightsSummary } from './ModelInsightsSummary'
import {
  ColumnChart,
  OBJECT_BAR_HEIGHT,
  ObjectBar,
  ObjectBars,
  RankedBars,
  SegmentedBar,
  foldParts,
  foldRows,
  type BarRow,
} from './homeCharts'
import { HomePage, Kpi, LinkButton, Panel, Toggle } from './homePrimitives'
import { InfoHint } from './InfoHint'
import { useElementNavigation } from './navigation'

/** Ranked bars past this fold into an "Other" row that opens: a catalog can declare hundreds of types. */
const MAX_BARS = 12

/** Rows in a list of objects: enough to start from, few enough that the card stays a summary. */
const LIST_ROWS = 6

/**
 * The two model tabs of Home, both drawn from one computation.
 *
 * `overview` is the model at a glance: four headline numbers, what it is made
 * of as one bar, its shape level by level, where to start (the roots), and how
 * consistent it is. `model` is the same data to read closely: every type as a
 * ranked bar, the hierarchy with its figures, the objects holding the most
 * children, and the namespaces.
 *
 * On a 100k-object server a count alone is wallpaper, so nothing here is only a
 * count: a part opens its type, a row opens its object. And nothing is cut
 * short without a way to the rest: a folded "Other" opens, the first roots of
 * thousands can be told to show them all, and the namespaces that hold nothing
 * are listed.
 */
export function ModelOverview({
  objects,
  objectTypes,
  namespaces,
  isLoading = false,
  section,
}: {
  section: 'overview' | 'model'
  objects: ObjectInstance[]
  objectTypes: ObjectType[]
  namespaces: Namespace[]
  /** True while the catalog fetch is in flight, shows the skeleton instead of "No model loaded". */
  isLoading?: boolean
}) {
  const { selectElement, selectType, selectNamespace } = useElementNavigation()
  const setHomeTab = useExplorerStore(state => state.setHomeTab)

  // One shared computation for both tabs AND the Model insights tab, made off the
  // main thread and memoized on the store array identities.
  const insights = useInsightsReport(objects, objectTypes, namespaces.length)

  if (objects.length === 0 && !isLoading) {
    return (
      <HomePage>
        <div className="py-20 text-center">
          <p className="text-[14px] text-i3x-text-muted">No model loaded</p>
          <p className="text-[13px] text-i3x-text-muted mt-1">Connect to a server to load the model.</p>
        </div>
      </HomePage>
    )
  }
  if (objects.length === 0 || !insights) {
    return (
      <HomePage>
        <Skeleton />
      </HomePage>
    )
  }
  const { stats, report } = insights
  const typesNote = `${stats.typesInUse.toLocaleString()} ${stats.typesInUse === 1 ? 'type' : 'types'} in use${
    stats.typesDeclared > stats.typesInUse ? `, of ${stats.typesDeclared.toLocaleString()} declared` : ''
  }`

  if (section === 'model') {
    return (
      <HomePage>
        {/* Two independent columns, so a tall card never leaves a short neighbor padded out to match it. */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <div className="space-y-4 min-w-0">
            <Panel title="Objects by type" note={typesNote}>
              <RankedBars rows={foldRows(stats.byType.map(tallyRow), MAX_BARS)} unit="objects" total={stats.objects} onSelect={selectType} />
            </Panel>
            <Panel title="Objects with the most children">
              <ObjectList items={stats.hubs.slice(0, LIST_ROWS)} empty="Nothing in this model contains anything else." onSelect={selectElement} />
            </Panel>
          </div>
          <div className="space-y-4 min-w-0">
            <HierarchyPanel stats={stats} detailed />
            <NamespacesPanel stats={stats} namespaces={namespaces} onSelect={selectNamespace} />
          </div>
        </div>
      </HomePage>
    )
  }

  return (
    <HomePage>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Objects" value={stats.objects.toLocaleString()} note={`${stats.roots.toLocaleString()} at the root`} />
        <Kpi
          label="Object types"
          value={stats.typesInUse.toLocaleString()}
          note={stats.typesDeclared > stats.typesInUse ? `of ${stats.typesDeclared.toLocaleString()} declared` : 'all in use'}
        />
        <Kpi
          label="Namespaces"
          value={stats.namespaces.toLocaleString()}
          note={`${stats.byNamespace.length.toLocaleString()} hold objects`}
        />
        <Kpi
          label="Hierarchy depth"
          value={stats.maxDepth.toLocaleString()}
          note={stats.maxDepth === 1 ? 'level below the roots' : 'levels below the roots'}
        />
      </div>

      <Panel
        title="Objects by type"
        note={typesNote}
        action={<LinkButton onClick={() => setHomeTab('model')}>All types</LinkButton>}
      >
        <SegmentedBar
          parts={foldParts(stats.byType.map(tally => ({ key: tally.key, label: tally.label, value: tally.count })))}
          unit="objects"
          label="Objects by type"
          onSelect={selectType}
        />
      </Panel>

      {/* Three across only where each still has room for its rows; otherwise two, with Model insights underneath. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        <RootObjectsPanel stats={stats} objects={objects} objectTypes={objectTypes} onSelect={selectElement} />
        <HierarchyPanel stats={stats} />
        <ModelInsightsSummary report={report} stats={stats} className="lg:col-span-2 2xl:col-span-1" />
      </div>
    </HomePage>
  )
}

function tallyRow(tally: Tally): BarRow {
  return { key: tally.key, label: tally.label, value: tally.count }
}

function objectRow(item: ObjectRef): BarRow {
  return {
    key: item.elementId,
    label: item.label,
    // The parent tells apart objects that share a name, which a real model has plenty of.
    note: item.parentLabel ? `${item.typeLabel} in ${item.parentLabel}` : item.typeLabel,
    value: item.children,
    title: item.elementId,
  }
}

// Module-level, so the virtualizer is not handed a new key function (and re-measures every row) on each render.
const rowKey = (row: BarRow) => row.key

/**
 * The tops of the hierarchy, largest first: the first few, and on request every
 * one of them. A model with thousands of roots is flat, not hierarchical, which
 * the count beside the title says before anyone goes hunting for a tree that
 * isn't there.
 */
function RootObjectsPanel({
  stats,
  objects,
  objectTypes,
  onSelect,
}: {
  stats: ModelStats
  objects: ObjectInstance[]
  objectTypes: ObjectType[]
  onSelect: (elementId: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const top = stats.rootObjects.slice(0, LIST_ROWS)
  const hasMore = stats.roots > top.length

  // Built only once asked for: the stats carry the top few, not a list that can be tens of thousands long.
  const all = useMemo(
    () => (showAll && hasMore ? traceSpan('list root objects', () => listRootObjects(objects, objectTypes).map(objectRow)) : null),
    [showAll, hasMore, objects, objectTypes]
  )

  return (
    <Panel
      title="Root objects"
      note={
        !hasMore
          ? 'By children'
          : all
            ? `All ${all.length.toLocaleString()}, the largest first`
            : `The ${top.length} largest of ${stats.roots.toLocaleString()}, by children`
      }
      action={
        hasMore ? (
          <LinkButton onClick={() => setShowAll(value => !value)}>
            {showAll ? `Show the ${top.length} largest` : `Show all ${stats.roots.toLocaleString()}`}
          </LinkButton>
        ) : undefined
      }
    >
      {all ? (
        <WindowedList
          items={all}
          estimateHeight={OBJECT_BAR_HEIGHT}
          // About eight rows: tall enough to browse, short enough that the cards beside this one are not stretched far.
          className="max-h-[19rem] pr-2"
          getKey={rowKey}
          renderRow={(row, index) => (
            <div className={index === 0 ? '' : 'border-t border-i3x-border/60'}>
              <ObjectBar row={row} peak={all[0].value} unit="children" onSelect={onSelect} />
            </div>
          )}
        />
      ) : (
        <ObjectList items={top} empty="No roots, every object names a parent." onSelect={onSelect} />
      )}
    </Panel>
  )
}

/**
 * Objects by namespace, and under the bars the namespaces that hold none: "8 of
 * 11 hold objects" is a count of three things nobody could otherwise see.
 */
function NamespacesPanel({
  stats,
  namespaces,
  onSelect,
}: {
  stats: ModelStats
  namespaces: Namespace[]
  onSelect: (uri: string) => void
}) {
  const [emptyOpen, setEmptyOpen] = useState(false)
  const declared = new Set(namespaces.map(namespace => namespace.uri))
  const used = new Set(stats.byNamespace.map(tally => tally.key))
  const empty = namespaces.filter(namespace => !used.has(namespace.uri))

  // One namespace holding everything, and none standing empty, is not a comparison.
  if (stats.byNamespace.length <= 1 && empty.length === 0) return null

  return (
    <Panel
      title="Objects by namespace"
      note={`${stats.byNamespace.length.toLocaleString()} of ${stats.namespaces.toLocaleString()} namespaces hold objects`}
    >
      <RankedBars
        rows={foldRows(
          // An object can name a namespace the server does not declare: drawn, but there is nothing to open.
          stats.byNamespace.map(tally => ({ ...tallyRow(tally), inert: !declared.has(tally.key) })),
          MAX_BARS
        )}
        unit="objects"
        total={stats.objects}
        onSelect={onSelect}
      />
      {empty.length > 0 && (
        <div className="mt-4 pt-3 border-t border-i3x-border">
          <Toggle open={emptyOpen} onToggle={() => setEmptyOpen(value => !value)} label="the namespaces that hold no objects">
            <span className="text-i3x-text-muted">
              {empty.length.toLocaleString()} {empty.length === 1 ? 'namespace holds' : 'namespaces hold'} no objects
            </span>
          </Toggle>
          {emptyOpen && (
            <ul className="mt-1.5">
              {empty.map(namespace => (
                <li key={namespace.uri}>
                  <button
                    type="button"
                    onClick={() => onSelect(namespace.uri)}
                    title={`${namespace.uri} · click to open`}
                    className="group w-full py-1 flex items-baseline gap-2.5 text-left rounded min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
                  >
                    <span className="text-[13px] text-i3x-text truncate group-hover:text-i3x-primary">
                      {namespace.displayName || namespace.uri}
                    </span>
                    {namespace.displayName && namespace.displayName !== namespace.uri && (
                      <span className="min-w-0 flex-1 text-[12px] text-i3x-text-muted truncate">{namespace.uri}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  )
}

/** The hierarchy's shape: one column per level, and the figures that explain it. */
function HierarchyPanel({ stats, detailed = false }: { stats: ModelStats; detailed?: boolean }) {
  return (
    <Panel
      title={
        <>
          Hierarchy
          {detailed && (
            <InfoHint label="How is depth counted?" title="Hierarchy" align="left">
              A root is level 0, its children level 1, and so on down the parent chain. A root is an
              object you can't go up from: it names no parent, or names one this catalog doesn't
              contain.
              <br />
              <br />
              Only parent and child links are counted here. Other relationships are fetched one
              object at a time and shown on an element's <b className="text-i3x-text">Relationships</b>{' '}
              tab.
            </InfoHint>
          )}
        </>
      }
      note="Objects per level"
    >
      <ColumnChart
        columns={stats.byDepth.map((tally, level) => ({
          key: tally.key,
          label: tally.label,
          // Under the column, "Root" then the bare level number: the card already says these are levels.
          tick: level === 0 ? 'Root' : String(level),
          value: tally.count,
        }))}
        unit="objects"
        label={`Objects at each hierarchy level: ${stats.byDepth.map(tally => `${tally.label} ${tally.count.toLocaleString()}`).join(', ')}`}
      />
      <dl className={`mt-4 grid gap-x-5 gap-y-3 ${detailed ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        <Fact label="Roots" value={stats.roots.toLocaleString()} />
        <Fact label="Leaves" value={stats.leaves.toLocaleString()} />
        <Fact label="Children per parent" value={`${stats.avgFanout.toFixed(1)} avg`} />
        {detailed && <Fact label="Most under one parent" value={stats.maxFanout.toLocaleString()} />}
      </dl>
    </Panel>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-i3x-text-muted truncate" title={label}>
        {label}
      </dt>
      <dd className="mt-0.5 text-[13.5px] font-medium text-i3x-text tabular-nums">{value}</dd>
    </div>
  )
}

/** A ranked list of objects with their sizes drawn, each one a way into the tree. */
function ObjectList({
  items,
  empty,
  onSelect,
}: {
  items: ObjectRef[]
  empty: string
  onSelect: (elementId: string) => void
}) {
  if (items.length === 0) return <p className="text-[13px] text-i3x-text-muted">{empty}</p>
  return <ObjectBars rows={items.map(objectRow)} unit="children" onSelect={onSelect} />
}

/**
 * Shown while the catalog is still arriving. Mirrors the real page (four
 * figures, then cards) so nothing jumps when the data lands. Stays up until the
 * model is on screen: isLoading covers the whole object-list prefetch (see
 * services/connection.ts), so there is no blank frame in between.
 */
function Skeleton() {
  const card = 'bg-i3x-surface border border-i3x-border rounded-xl'
  return (
    <div role="status" aria-label="Loading the model">
      <div className="space-y-4 animate-pulse motion-reduce:animate-none" aria-hidden="true">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`${card} px-5 py-4 space-y-3`}>
              <div className="h-3 w-20 rounded bg-i3x-text/10" />
              <div className="h-7 w-24 rounded bg-i3x-text/10" />
              <div className="h-3 w-28 rounded bg-i3x-text/10" />
            </div>
          ))}
        </div>
        <div className={`${card} p-5 space-y-4`}>
          <div className="h-3.5 w-44 rounded bg-i3x-text/10" />
          <div className="h-7 rounded bg-i3x-text/10" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className={`${card} p-5`}>
              <div className="h-3.5 w-32 rounded bg-i3x-text/10" />
              <div className="mt-5 space-y-4">
                {Array.from({ length: 5 }, (_, j) => (
                  <div key={j} className="h-3 rounded bg-i3x-text/10" style={{ width: `${92 - j * 11}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
