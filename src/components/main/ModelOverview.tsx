import type { ObjectInstance, ObjectType } from '../../api/types'
import { withOther, type ModelStats, type ObjectRef, type Tally } from './modelStats'
import { useInsightsReport } from '../../data/useInsightsReport'
import { ModelInsightsCard } from './ModelInsightsCard'
import { Card } from './primitives'
import { InfoHint } from './InfoHint'
import { useElementNavigation } from './navigation'

/** Bars past this fold into an "Other" row, a catalog can declare hundreds of types. */
const MAX_BARS = 12

/**
 * What the model is made of, and, more to the point, where to start reading it.
 *
 * On a 100k-object server the counts alone are wallpaper: knowing there are
 * 100,000 objects tells you nothing you can act on. So every row here is a way
 * IN. The hubs are where the structure actually is, the roots are the entry
 * points, a type bar opens that type, and the issues card tells you when the
 * catalog is lying to you. Nothing on this page is a dead end.
 */
export function ModelOverview({
  objects,
  objectTypes,
  namespaceCount,
  isLoading = false,
}: {
  objects: ObjectInstance[]
  objectTypes: ObjectType[]
  namespaceCount: number
  /** True while the catalog fetch is in flight, shows the skeleton instead of "No model loaded". */
  isLoading?: boolean
}) {
  const { selectElement, selectType } = useElementNavigation()

  // One shared computation for the stat row AND the insights card/page, made
  // off the main thread and memoized on the store array identities.
  const insights = useInsightsReport(objects, objectTypes, namespaceCount)

  if (objects.length === 0) {
    if (isLoading) return <OverviewSkeleton />
    return (
      <div className="flex-1 grid place-items-center text-center p-6">
        <div>
          <p className="text-sm text-i3x-text-muted">No model loaded</p>
          <p className="text-xs text-i3x-text-muted/70 mt-1">
            Connect to a server to load the model.
          </p>
        </div>
      </div>
    )
  }
  if (!insights) return <OverviewSkeleton />
  const { stats, report } = insights

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
      <StatRow stats={stats} />

      <Issues stats={stats} />

      <ModelInsightsCard report={report} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card
          title="Largest containers"
          actions={
            <InfoHint label="What is this?" title="Largest containers">
              The objects holding the most direct children. On a big model this is where the
              structure lives, so start here rather than scrolling the tree. Click one to open it.
            </InfoHint>
          }
        >
          <ObjectList
            items={stats.hubs}
            empty="Nothing in this model contains anything else."
            unit="children"
            onSelect={selectElement}
          />
        </Card>

        <Card
          title={`Entry points · ${stats.roots.toLocaleString()} root ${
            stats.roots === 1 ? 'object' : 'objects'
          }`}
          actions={
            <InfoHint label="What is this?" title="Entry points">
              Objects you can't go up from: they either name no parent, or name one this catalog
              doesn't contain. They are the tops of the hierarchy and the natural places to start.
              <br />
              <br />
              A model with thousands of roots is flat, not hierarchical, which is worth knowing
              before you go looking for a tree that isn't there.
            </InfoHint>
          }
        >
          <ObjectList
            items={stats.rootObjects}
            empty="No roots, every object names a parent."
            unit="children"
            onSelect={selectElement}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title={`Objects by type · ${stats.typesInUse.toLocaleString()} in use`}>
          <BarList
            items={withOther(stats.byType, MAX_BARS)}
            total={stats.objects}
            unit="objects"
            onSelect={selectType}
          />
        </Card>

        <Card
          title="Hierarchy shape"
          actions={
            <InfoHint label="How is depth counted?" title="Hierarchy shape">
              A root is level 0, its children level 1, and so on down the parent chain. Fan-out is
              how many direct children an object holds.
            </InfoHint>
          }
        >
          <BarList items={stats.byDepth} total={stats.objects} unit="objects" />
          <dl className="mt-4 pt-3 border-t border-i3x-border grid grid-cols-2 gap-x-4 gap-y-2">
            <Fact label="Leaf objects" value={stats.leaves.toLocaleString()} />
            <Fact label="Composition objects" value={stats.compositions.toLocaleString()} />
            <Fact
              label="Children per parent"
              value={`${stats.avgFanout.toFixed(1)} avg · ${stats.maxFanout.toLocaleString()} max`}
            />
            <Fact label="Deepest chain" value={`${stats.maxDepth.toLocaleString()} levels`} />
          </dl>
        </Card>
      </div>

      {stats.byNamespace.length > 1 && (
        <Card title="Objects by namespace">
          <BarList items={withOther(stats.byNamespace, MAX_BARS)} total={stats.objects} unit="objects" />
        </Card>
      )}
    </div>
  )
}

/** The headline numbers. Proportional figures, tabular-nums makes display sizes look loose. */
/**
 * Shown while the catalog is still arriving. Mirrors the real layout (stat
 * row, then two card columns) so the page doesn't jump when the data lands.
 * Stays up until the model actually lands, isLoading covers the whole
 * object-list prefetch (see services/connection.ts), so there is no blank
 * frame between the skeleton and the populated overview.
 */
function OverviewSkeleton() {
  return (
    <div
      className="flex-1 min-h-0 overflow-hidden px-3 sm:px-5 py-4 space-y-3"
      role="status"
      aria-label="Loading model overview"
    >
      <div className="space-y-3 animate-pulse motion-reduce:animate-none" aria-hidden="true">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="bg-i3x-surface border border-i3x-border rounded-xl p-4 space-y-2">
              <div className="h-2.5 w-3/5 rounded bg-i3x-text/10" />
              <div className="h-5 w-2/5 rounded bg-i3x-text/10" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="bg-i3x-surface border border-i3x-border rounded-xl p-4">
              <div className="h-2.5 w-1/3 rounded bg-i3x-text/10" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 5 }, (_, j) => (
                  <div
                    key={j}
                    className="h-3.5 rounded bg-i3x-text/10"
                    style={{ width: `${90 - j * 12}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatRow({ stats }: { stats: ModelStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      <Stat label="Objects" value={stats.objects} />
      <Stat label="Object types" value={stats.typesInUse} sub={`of ${stats.typesDeclared} declared`} />
      <Stat label="Namespaces" value={stats.namespaces} />
      <Stat
        label="Containment links"
        value={stats.links}
        hint={
          <InfoHint label="What counts as a link?" title="Containment links">
            Every object that names a parent this catalog contains. These parent/child links are
            the only relationships the app knows without asking the server about each object
            separately.
            <br />
            <br />
            Other kinds of relationship have to be fetched one object at a time. They are shown in
            full on an element's <b className="text-i3x-text">Relationships</b> tab and are not
            counted here.
          </InfoHint>
        }
      />
      <Stat label="Root objects" value={stats.roots} />
      <Stat
        label="Hierarchy depth"
        value={stats.maxDepth}
        sub={stats.maxDepth === 1 ? 'level below root' : 'levels below root'}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  hint,
}: {
  label: string
  value: number
  sub?: string
  hint?: React.ReactNode
}) {
  return (
    <div className="relative bg-i3x-surface border border-i3x-border rounded-xl px-4 py-3">
      {hint && <span className="absolute top-2.5 right-2.5">{hint}</span>}
      <div className="text-2xl font-semibold text-i3x-text leading-tight">
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] text-i3x-text-muted mt-0.5">{label}</div>
      {sub && <div className="text-[10.5px] text-i3x-text-muted/70 mt-0.5">{sub}</div>}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-i3x-text-muted">{label}</dt>
      <dd className="text-[13px] text-i3x-text tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * Only renders when something is actually wrong. A permanently-visible "0 issues"
 * panel trains people to ignore the space it occupies.
 */
function Issues({ stats }: { stats: ModelStats }) {
  const found: { text: string; hint: React.ReactNode }[] = []

  if (stats.orphans > 0) {
    found.push({
      text: `${stats.orphans.toLocaleString()} orphaned ${
        stats.orphans === 1 ? 'object' : 'objects'
      }`,
      hint: (
        <InfoHint label="What is an orphan?" title="Orphaned objects" align="left">
          They name a parent this catalog doesn't contain, usually because only part of the model
          is loaded. Since you can't go up from one, they are counted as roots and listed under{' '}
          <b className="text-i3x-text">Entry points</b>.
        </InfoHint>
      ),
    })
  }

  if (stats.untyped > 0) {
    found.push({
      text: `${stats.untyped.toLocaleString()} untyped ${
        stats.untyped === 1 ? 'object' : 'objects'
      }`,
      hint: (
        <InfoHint label="What does untyped mean?" title="Untyped objects" align="left">
          They carry no <span className="font-mono">typeId</span>, so nothing describes their
          shape and there is nothing to group them with.
        </InfoHint>
      ),
    })
  }

  // Declared types with no instances are NOT listed here. In I3X a namespace
  // is a type library, so publishing a profile this server doesn't fully
  // instantiate is normal, and it was routinely the largest number in a strip
  // whose whole point is "something is wrong". The full list is still
  // browsable on the Model Insights page, filed as information, not an issue.

  if (found.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-i3x-warning/5 border border-i3x-warning/30 rounded-xl px-4 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-i3x-warning">
        Worth knowing
      </span>
      {found.map(issue => (
        <span key={issue.text} className="inline-flex items-center gap-1.5 text-[12px] text-i3x-text">
          {issue.text}
          {issue.hint}
        </span>
      ))}
    </div>
  )
}

/** A ranked list of objects, each one a way into the tree. */
function ObjectList({
  items,
  empty,
  unit,
  onSelect,
}: {
  items: ObjectRef[]
  empty: string
  unit: string
  onSelect: (elementId: string) => void
}) {
  if (items.length === 0) return <p className="text-xs text-i3x-text-muted">{empty}</p>

  return (
    <ul className="space-y-0.5">
      {items.map(item => (
        <li key={item.elementId}>
          <button
            type="button"
            onClick={() => onSelect(item.elementId)}
            title={item.elementId}
            className="w-full flex items-baseline gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            <span className="text-[13px] text-i3x-text truncate">{item.label}</span>
            <span className="text-[11px] text-i3x-text-muted truncate">{item.typeLabel}</span>
            <span className="ml-auto shrink-0 text-[12px] text-i3x-text-muted tabular-nums">
              {item.children.toLocaleString()} {unit}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Ranked magnitude, so: one hue for every bar. Coloring bars darker-where-bigger
 * would double-encode the length as hue and burn the only free channel on
 * information the bar already shows.
 */
function BarList({
  items,
  total,
  unit,
  onSelect,
}: {
  items: Tally[]
  total: number
  unit: string
  /** When given, each row opens its category. The "Other" fold-up row stays inert. */
  onSelect?: (key: string) => void
}) {
  const max = items.reduce((peak, item) => Math.max(peak, item.count), 0)
  if (max === 0) return <p className="text-xs text-i3x-text-muted">Nothing to count.</p>

  return (
    <ul className="space-y-1.5">
      {items.map(item => {
        const share = total > 0 ? (item.count / total) * 100 : 0
        const clickable = onSelect !== undefined && !item.isOther

        const body = (
          <>
            <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
              <span className="text-[12px] text-i3x-text truncate text-left">{item.label}</span>
              <span className="text-[12px] text-i3x-text-muted tabular-nums">
                {item.count.toLocaleString()}
              </span>
            </span>
            <span className="block mt-1 h-1.5 rounded-full bg-i3x-bg overflow-hidden">
              {/* Anchored to the baseline, rounded only at the data end. */}
              <span
                className="block h-full rounded-r-[4px]"
                style={{
                  width: `${Math.max((item.count / max) * 100, 1)}%`,
                  background: 'rgb(var(--i3x-primary) / 0.8)',
                }}
              />
            </span>
          </>
        )

        const tooltip = `${item.label}, ${item.count.toLocaleString()} ${unit} (${share.toFixed(1)}%)${
          clickable ? ' · click to open' : ''
        }`

        return (
          <li key={item.key}>
            {clickable ? (
              <button
                type="button"
                onClick={() => onSelect!(item.key)}
                title={tooltip}
                className="w-full block px-1 py-0.5 -mx-1 rounded-lg hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
              >
                {body}
              </button>
            ) : (
              <span className="block px-1 py-0.5 -mx-1" title={tooltip}>
                {body}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

