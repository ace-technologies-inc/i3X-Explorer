import { useState } from 'react'
import { useExplorerStore } from '../../stores/explorer'
import { Card } from '../main/primitives'
import { InfoHint } from '../main/InfoHint'
import { Chevron } from '../common/Chevron'
import { useElementNavigation } from '../main/navigation'
import { WindowedList } from './WindowedList'
import type { ChildStat, TypeProfile } from '../main/insightsReport'

/**
 * The inferred schema, browsable: one row per type, expanding into where its
 * instances sit, what they contain (with cardinality), how deep they run, and
 * how they're named. Deliberately a windowed list, not a node-link graph, at
 * catalog scale a whole-model graph is a hairball (see CLAUDE.md), while a
 * table answers "where does this kind of data live" in one glance.
 */

/** Fold composition lines past this many child types. */
const MAX_CHILD_LINES = 6
/** Expanded placement rows past this fold into one aggregate "(scattered)" line. */
const MAX_PLACEMENT_ROWS = 12
/** Opacity ramp for the stacked placement mini-bar, rank, not value, so one hue. */
const SEGMENT_OPACITY = [0.9, 0.55, 0.32, 0.18]

export function formatShare(share: number): string {
  const value = share * 100
  if (value >= 99.95) return '100%'
  if (value >= 99) return `${value.toFixed(1)}%`
  if (value < 1) return `${value.toFixed(1)}%`
  return `${Math.round(value)}%`
}

function cardinality(stat: ChildStat): string {
  return stat.minCount === stat.maxCount
    ? `exactly ${stat.minCount}`
    : `${stat.minCount}–${stat.maxCount}`
}

export function TypeAtlas({ profiles }: { profiles: TypeProfile[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (typeId: string) =>
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(typeId)) next.delete(typeId)
      else next.add(typeId)
      return next
    })

  return (
    <Card
      title={`Type atlas · ${profiles.length.toLocaleString()} ${profiles.length === 1 ? 'type' : 'types'}`}
      actions={
        <InfoHint label="What is the type atlas?" title="Type atlas">
          For every type in use: where its instances sit, what they contain and how many, how deep
          they run, and how they are named. Click a type name to open it, or an example to jump to
          that object.
        </InfoHint>
      }
    >
      <WindowedList
        items={profiles}
        estimateHeight={44}
        className="max-h-[32rem] -mx-2"
        getKey={profile => profile.typeId}
        renderRow={profile => (
          <AtlasRow
            profile={profile}
            expanded={expanded.has(profile.typeId)}
            onToggle={() => toggle(profile.typeId)}
          />
        )}
      />
    </Card>
  )
}

function AtlasRow({
  profile,
  expanded,
  onToggle,
}: {
  profile: TypeProfile
  expanded: boolean
  onToggle: () => void
}) {
  const { selectType, selectElement } = useElementNavigation()
  // Instance typeIds aren't guaranteed to be declared in /objecttypes;
  // selectType would silently no-op for those, so render text, not a dead button.
  const typeIndex = useExplorerStore(s => s.typeIndex)

  const placementSummary = profile.placements
    .map(p => `${p.parentTypeLabel} ${formatShare(p.share)}`)
    .join(' · ')
  const childSummary = profile.children.map(c => c.childTypeLabel).join(', ')

  const shownPlacements = profile.placements.slice(0, MAX_PLACEMENT_ROWS)
  const foldedPlacements = profile.placements.length - shownPlacements.length
  const foldedCount = profile.placements
    .slice(MAX_PLACEMENT_ROWS)
    .reduce((sum, p) => sum + p.count, 0)

  return (
    <div className="px-2">
      <div className="flex items-center gap-2 py-2 rounded-lg hover:bg-i3x-bg min-w-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${profile.typeLabel}`}
          className="p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          <Chevron open={expanded} />
        </button>
        {typeIndex.has(profile.typeId) ? (
          <button
            type="button"
            onClick={() => selectType(profile.typeId)}
            title={`${profile.typeId} · open this type`}
            className="text-[13px] text-i3x-text font-medium truncate hover:text-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary rounded"
          >
            {profile.typeLabel}
          </button>
        ) : (
          <span
            title={`${profile.typeId} · not declared by the server`}
            className="text-[13px] text-i3x-text font-medium truncate"
          >
            {profile.typeLabel}
          </span>
        )}
        <span className="text-[11.5px] text-i3x-text-muted tabular-nums shrink-0">
          {profile.instanceCount.toLocaleString()}
        </span>
        {/* Stacked placement bar: rank → opacity, one hue; labels live in the tooltip. */}
        <span
          className="hidden sm:flex w-28 h-1.5 rounded-full overflow-hidden bg-i3x-bg shrink-0 gap-px"
          title={placementSummary}
        >
          {profile.placements.slice(0, SEGMENT_OPACITY.length + 1).map((placement, rank) => (
            <span
              key={placement.parentTypeId ?? placement.parentTypeLabel}
              className="h-full"
              style={{
                width: `${Math.max(placement.share * 100, 2)}%`,
                background: `rgb(var(--i3x-primary) / ${SEGMENT_OPACITY[rank] ?? 0.12})`,
              }}
            />
          ))}
        </span>
        <span className="flex-1 min-w-0 truncate text-[11.5px] text-i3x-text-muted" title={childSummary}>
          {childSummary && `contains ${childSummary}`}
        </span>
      </div>

      {expanded && (
        <div className="pb-3 pl-7 pr-2 space-y-3">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-i3x-text-muted mb-1.5">
              Where they sit
            </div>
            <ul className="space-y-1">
              {shownPlacements.map(placement => (
                <li key={placement.parentTypeId ?? placement.parentTypeLabel} className="min-w-0">
                  <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                    {placement.parentTypeId && typeIndex.has(placement.parentTypeId) ? (
                      <button
                        type="button"
                        onClick={() => selectType(placement.parentTypeId!)}
                        title={`${placement.parentTypeId} · open this type`}
                        className="text-left text-[12px] text-i3x-text truncate hover:text-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary rounded"
                      >
                        {placement.parentTypeLabel}
                      </button>
                    ) : (
                      <span className="text-[12px] text-i3x-text-muted truncate">
                        {placement.parentTypeLabel}
                      </span>
                    )}
                    <span className="text-[11.5px] text-i3x-text-muted tabular-nums">
                      {placement.count.toLocaleString()} · {formatShare(placement.share)}
                    </span>
                  </span>
                  <span className="block mt-0.5 h-1.5 rounded-full bg-i3x-bg overflow-hidden">
                    <span
                      className="block h-full rounded-r-[4px]"
                      style={{
                        width: `${Math.max(placement.share * 100, 1)}%`,
                        background: 'rgb(var(--i3x-primary) / 0.8)',
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
            {foldedPlacements > 0 && (
              // Not a dead end: a type scattered across dozens of parent types
              // IS the finding, the aggregate is the honest statement of it.
              <p className="mt-1 text-[11px] text-i3x-text-muted">
                …scattered across {foldedPlacements.toLocaleString()} more parent types (
                {foldedCount.toLocaleString()} objects)
              </p>
            )}
          </div>

          {profile.children.length > 0 && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-i3x-text-muted mb-1.5">
                What they contain
              </div>
              <ul className="space-y-0.5">
                {profile.children.slice(0, MAX_CHILD_LINES).map(stat => (
                  <li key={stat.childTypeId} className="text-[12px] text-i3x-text">
                    <span className="font-mono text-i3x-text-muted">{cardinality(stat)}</span>{' '}
                    {stat.childTypeLabel}{' '}
                    <span className="text-i3x-text-muted">
                      ({formatShare(stat.presenceShare)} of instances)
                    </span>
                  </li>
                ))}
              </ul>
              {profile.children.length > MAX_CHILD_LINES && (
                <p className="mt-1 text-[11px] text-i3x-text-muted">
                  +{profile.children.length - MAX_CHILD_LINES} more child types
                </p>
              )}
            </div>
          )}

          <p className="text-[11.5px] text-i3x-text-muted">
            {profile.depthMin === profile.depthMax
              ? `Level ${profile.depthMin}`
              : `Levels ${profile.depthMin}–${profile.depthMax}`}
            {profile.naming &&
              ` · names follow ${profile.naming.signature} (${formatShare(profile.naming.share)})`}
          </p>

          {profile.examples.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-i3x-text-muted">Examples:</span>
              {profile.examples.map(example => (
                <button
                  key={example.elementId}
                  type="button"
                  onClick={() => selectElement(example.elementId)}
                  title={`${example.elementId} · click to open`}
                  className="max-w-[14rem] truncate px-2 py-0.5 rounded-full border border-i3x-border text-[11.5px] text-i3x-text hover:border-i3x-primary hover:text-i3x-primary transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
                >
                  {example.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
