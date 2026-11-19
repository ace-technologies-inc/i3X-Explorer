import { useState } from 'react'
import { DataBar, Meter, RankedBars, foldRows } from '../main/homeCharts'
import { Panel, Toggle } from '../main/homePrimitives'
import { InfoHint } from '../main/InfoHint'
import { useElementNavigation } from '../main/navigation'
import { useExplorerStore } from '../../stores/explorer'
import { placeLabel, type ChildStat, type TypePlacement, type TypeProfile } from '../main/insightsReport'
import { ExampleLinks, NameLine, ShowMore, TypeName, capitalize, formatShare, usePaged } from './parts'

/**
 * The schema the instances imply, one row per type: how many there are, where
 * they sit, what they contain, how deep they run. A row opens onto the full
 * distributions. A table, not a node-link graph: at catalog scale a graph of
 * types is a hairball, while a row answers "where does this kind of data live"
 * at a glance.
 *
 * A row names what fits and counts the rest as a button that opens the row,
 * where every one of them is listed: never "and 3 other places" as dead text.
 */

const TYPES_PER_PAGE = 50
/** Parent types and child types named in a row before the rest are counted. */
const NAMED_IN_ROW = 2
/** Child types on the first page of an opened row. */
const CHILDREN_PER_PAGE = 8
/** Places drawn as their own bar in an opened row before the tail folds into an "Other" that opens. */
const PLACES_IN_DETAIL = 10
/** Opacity by rank for the placement strip: one hue, since the parts differ from row to row and so cannot be named by color. */
const RANK_OPACITY = [0.95, 0.55, 0.32, 0.18]
const TAIL_OPACITY = 0.1

const GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.1fr)_10rem_minmax(0,1.4fr)_minmax(0,1.1fr)_4.5rem_3rem] items-center gap-x-5 gap-y-1'

function cardinality(stat: ChildStat): string {
  return stat.minCount === stat.maxCount ? `exactly ${stat.minCount}` : `${stat.minCount} to ${stat.maxCount}`
}

function levels(profile: TypeProfile): string {
  return profile.depthMin === profile.depthMax ? String(profile.depthMin) : `${profile.depthMin} to ${profile.depthMax}`
}

/** A placement as a name for a cell or a bar: the parent type, or the place when it is not a type. */
function placeName(placement: TypePlacement): string {
  return placement.parentTypeId !== null
    ? placement.parentTypeLabel
    : capitalize(placeLabel(placement.parentTypeId, placement.parentTypeLabel))
}

export function TypesSection({ profiles }: { profiles: TypeProfile[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const paged = usePaged(profiles, TYPES_PER_PAGE)
  const largest = profiles.reduce((max, profile) => Math.max(max, profile.instanceCount), 0)

  const setRow = (typeId: string, show: boolean) =>
    setOpen(current => {
      if (current.has(typeId) === show) return current
      const next = new Set(current)
      if (show) next.add(typeId)
      else next.delete(typeId)
      return next
    })

  return (
    <Panel
      title={
        <>
          Types
          <InfoHint label="What does each column show?" title="Types" align="left">
            For every type in use: how many instances it has, the kind of object they sit under,
            the kinds they contain, and how many levels below a root they are. The strip under
            "Sits under" is one whole split by parent type: a solid strip means every instance
            sits in the same kind of place.
          </InfoHint>
        </>
      }
      note={`${profiles.length.toLocaleString()} in use`}
    >
      <div className={`${GRID} hidden lg:grid pb-2 text-[12px] text-i3x-text-muted border-b border-i3x-border`}>
        <span>Type</span>
        <span>Instances</span>
        <span>Sits under</span>
        <span>Contains</span>
        <span>Level</span>
        <span />
      </div>
      <div className="divide-y divide-i3x-border/60">
        {paged.shown.map(profile => (
          <TypeRow
            key={profile.typeId}
            profile={profile}
            share={largest > 0 ? profile.instanceCount / largest : 0}
            open={open.has(profile.typeId)}
            onSetOpen={show => setRow(profile.typeId, show)}
          />
        ))}
      </div>
      <ShowMore paged={paged} noun="types" className="pt-3 border-t border-i3x-border/60" />
    </Panel>
  )
}

function TypeRow({
  profile,
  share,
  open,
  onSetOpen,
}: {
  profile: TypeProfile
  /** Its instance count against the largest type's. */
  share: number
  open: boolean
  onSetOpen: (open: boolean) => void
}) {
  const placement = profile.placements.map(part => `${placeName(part)} ${formatShare(part.share)}`).join(' · ')
  const drawn = profile.placements.slice(0, RANK_OPACITY.length)
  const tail = profile.placements.slice(RANK_OPACITY.length).reduce((sum, part) => sum + part.count, 0)

  return (
    <div className="py-2.5">
      <div className={GRID}>
        <TypeName typeId={profile.typeId} label={profile.typeLabel} className="text-[13px] font-medium text-i3x-text" />

        <div className="order-3 col-span-2 lg:order-none lg:col-span-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
          <DataBar share={share} />
          <span className="text-[12.5px] text-i3x-text-muted tabular-nums">{profile.instanceCount.toLocaleString()}</span>
        </div>

        <div className="order-4 col-span-2 lg:order-none lg:col-span-1 min-w-0">
          {profile.placements.length > 0 && (
            <>
              <NameLine
                names={profile.placements.map(part => (
                  <span key={part.parentTypeId ?? part.parentTypeLabel} className="text-i3x-text">
                    {placeName(part)} <span className="text-i3x-text-muted tabular-nums">{formatShare(part.share)}</span>
                  </span>
                ))}
                max={NAMED_IN_ROW}
                onMore={() => onSetOpen(true)}
                moreLabel={`Show every place ${profile.typeLabel} instances sit`}
              />
              <div className="mt-1 flex h-1.5" style={{ gap: 2 }} role="img" aria-label={`Sits under: ${placement}`} title={placement}>
                {drawn.map((part, rank) => (
                  <span
                    key={part.parentTypeId ?? part.parentTypeLabel}
                    className="h-full rounded-full"
                    style={{ flex: `${part.count} 1 0%`, minWidth: 3, background: `rgb(var(--i3x-series-1) / ${RANK_OPACITY[rank]})` }}
                  />
                ))}
                {/* Whatever is past the ranked parts is still part of the whole, so it is drawn as one last piece. */}
                {tail > 0 && (
                  <span
                    className="h-full rounded-full"
                    style={{ flex: `${tail} 1 0%`, minWidth: 3, background: `rgb(var(--i3x-series-1) / ${TAIL_OPACITY})` }}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <div className="hidden lg:block min-w-0">
          {profile.children.length === 0 ? (
            <span className="text-[12.5px] text-i3x-text-muted">-</span>
          ) : (
            <NameLine
              names={profile.children.map(child => (
                <span key={child.childTypeId} className="text-i3x-text-muted">
                  {child.childTypeLabel}
                </span>
              ))}
              max={NAMED_IN_ROW}
              onMore={() => onSetOpen(true)}
              moreLabel={`Show everything ${profile.typeLabel} instances contain`}
            />
          )}
        </div>
        <div className="hidden lg:block text-[12.5px] text-i3x-text-muted tabular-nums">{levels(profile)}</div>
        <div className="order-2 lg:order-none text-right">
          <Toggle open={open} onToggle={() => onSetOpen(!open)} label={`details of ${profile.typeLabel}`} />
        </div>
      </div>
      {open && <TypeDetail profile={profile} />}
    </div>
  )
}

function TypeDetail({ profile }: { profile: TypeProfile }) {
  const { selectType } = useElementNavigation()
  const typeIndex = useExplorerStore(state => state.typeIndex)
  const children = usePaged(profile.children, CHILDREN_PER_PAGE)
  const { naming } = profile

  return (
    <div className="mt-3 rounded-lg bg-i3x-bg px-4 py-4 grid grid-cols-1 xl:grid-cols-2 gap-x-10 gap-y-5">
      <div className="min-w-0">
        <div className="text-[12.5px] text-i3x-text-muted mb-1.5">Where they sit</div>
        <RankedBars
          rows={foldRows(
            profile.placements.map(part => ({
              key: part.parentTypeId ?? part.parentTypeLabel,
              label: placeName(part),
              value: part.count,
              // "At the root" and its kind are places, not types: nothing to open.
              inert: part.parentTypeId === null || !typeIndex.has(part.parentTypeId),
            })),
            PLACES_IN_DETAIL
          )}
          unit="instances"
          total={profile.instanceCount}
          onSelect={selectType}
        />
      </div>

      <div className="min-w-0 space-y-5">
        {profile.children.length > 0 && (
          <div>
            <div className="text-[12.5px] text-i3x-text-muted mb-2">What they contain</div>
            <ul className="space-y-2.5">
              {children.shown.map(stat => (
                <li key={stat.childTypeId} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-x-4">
                  <span className="min-w-0 break-words text-[13px] text-i3x-text">
                    <span className="text-i3x-text-muted">{cardinality(stat)}</span> {stat.childTypeLabel}
                  </span>
                  <Meter
                    value={stat.presence}
                    max={profile.instanceCount}
                    label={`${formatShare(stat.presenceShare)} of ${profile.typeLabel} instances contain a ${stat.childTypeLabel}`}
                  />
                  <span className="w-28 text-[12.5px] text-i3x-text-muted tabular-nums text-right">
                    {formatShare(stat.presenceShare)} of instances
                  </span>
                </li>
              ))}
            </ul>
            <ShowMore paged={children} noun="child types" />
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <dt className="text-[12px] text-i3x-text-muted">Levels below a root</dt>
            <dd className="mt-0.5 text-[13px] text-i3x-text tabular-nums">{levels(profile)}</dd>
          </div>
          {naming && (
            <div className="min-w-0">
              <dt className="text-[12px] text-i3x-text-muted">Names look like</dt>
              <dd className="mt-0.5 text-[13px] text-i3x-text break-words">
                {naming.example}{' '}
                <span className="text-i3x-text-muted">
                  pattern {naming.signature}, {formatShare(naming.share)} of names
                </span>
              </dd>
            </div>
          )}
        </dl>

        {profile.examples.length > 0 && (
          <div>
            <div className="text-[12.5px] text-i3x-text-muted mb-1">Examples</div>
            <ExampleLinks items={profile.examples} />
          </div>
        )}
      </div>
    </div>
  )
}
