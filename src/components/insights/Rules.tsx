import { useState } from 'react'
import { DataBar, Meter } from '../main/homeCharts'
import { Toggle } from '../main/homePrimitives'
import {
  groupPlace,
  normKey,
  normPredicate,
  type Convention,
  type Deviation,
  type InsightsReport,
  type OutlierGroup,
} from '../main/insightsReport'
import { WindowedList } from './WindowedList'
import { CopyLink, RefList, capitalize, plural } from './parts'

/**
 * A convention drawn as what it is: a share of a type's instances. The meter is
 * the share that keeps it; where it is broken, the row opens onto the
 * exceptions, grouped by where they actually sit.
 *
 * This is one list where there used to be two. "Conventions" and "Deviations"
 * were separate cards, the second repeating the rows of the first that had
 * exceptions, and a tile had to explain that the two counts overlapped.
 */

export interface Rule {
  key: string
  convention: Convention
  /** Its exceptions, when it has any. */
  deviation: Deviation | null
  /** For a naming convention: a real name that fits the pattern, which reads better than "A-9". */
  example: string | null
}

export interface Rules {
  /** Conventions that say something about their type, in the engine's order. */
  notable: Rule[]
  /** True, but the whole model does the same: kept out of the way. */
  shared: Rule[]
  /** The notable ones with exceptions, the most widely kept first (the engine's ranking of the deviations). */
  broken: Rule[]
}

export function buildRules(report: InsightsReport): Rules {
  const deviations = new Map(report.deviations.map(deviation => [normKey(deviation), deviation]))
  const naming = new Map(report.profiles.map(profile => [profile.typeId, profile.naming]))

  const byKey = new Map<string, Rule>()
  const rules = report.conventions.map((convention): Rule => {
    const key = normKey(convention)
    // A type's naming convention is its dominant pattern, the one its profile carries an example of.
    const pattern = convention.kind === 'naming' ? naming.get(convention.typeId) : null
    const rule: Rule = {
      key,
      convention,
      deviation: deviations.get(key) ?? null,
      example: pattern && pattern.signature === convention.signature ? pattern.example : null,
    }
    byKey.set(key, rule)
    return rule
  })

  return {
    notable: rules.filter(rule => rule.convention.notable),
    shared: rules.filter(rule => !rule.convention.notable),
    broken: report.deviations.flatMap(deviation => {
      const rule = byKey.get(normKey(deviation))
      return rule ? [rule] : []
    }),
  }
}

/** "sits under a Line", "names look like ST-01003": what the type does, without the type. */
export function rulePredicate(rule: Rule): string {
  return normPredicate(rule.convention, rule.example)
}

/** The same with its subject, for a list that is not grouped by type. */
export function ruleStatement(rule: Rule): string {
  return `${rule.convention.typeLabel} ${rulePredicate(rule)}`
}

/** On a wide window: the convention, its meter, the counts, the exceptions. Narrower, the meter drops under the text. */
export const RULE_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_12rem_9rem_10.5rem] items-center gap-x-5 gap-y-1.5'

export function RuleRow({
  rule,
  text,
  open,
  onToggle,
  muted = false,
}: {
  rule: Rule
  /** `rulePredicate` under a type heading, `ruleStatement` on its own. */
  text: string
  open: boolean
  onToggle: () => void
  muted?: boolean
}) {
  const { convention, deviation } = rule
  const counts = `${convention.conforming.toLocaleString()} of ${convention.total.toLocaleString()}`
  const statement = ruleStatement(rule)

  return (
    <div className="py-2.5">
      <div className={RULE_GRID}>
        {/* Wraps, never cut short: a convention is a sentence, and half a sentence is not one. */}
        <div className={`min-w-0 break-words text-[13px] ${muted ? 'text-i3x-text-muted' : 'text-i3x-text'}`}>
          {text}
          {rule.example && (
            <span className="ml-2 text-[12px] text-i3x-text-muted whitespace-nowrap">pattern {convention.signature}</span>
          )}
        </div>
        <Meter
          className="order-3 col-span-2 lg:order-none lg:col-span-1"
          value={convention.conforming}
          max={convention.total}
          label={`${statement}: ${counts} do`}
        />
        <div className="order-2 lg:order-none text-[12.5px] text-i3x-text-muted tabular-nums text-right whitespace-nowrap">{counts}</div>
        <div className="order-4 col-span-2 lg:order-none lg:col-span-1 lg:text-right">
          {deviation && (
            <Toggle open={open} onToggle={onToggle} label={`exceptions to ${statement}`}>
              <span className="text-i3x-text tabular-nums">{plural(deviation.outlierCount, 'exception')}</span>
            </Toggle>
          )}
        </div>
      </div>
      {open && deviation && <Exceptions deviation={deviation} />}
    </div>
  )
}

/** Past this many groups the groups themselves are windowed: a missing child can fan out to one group per line. */
const GROUP_WINDOW = 12

// `||`, not `??`: the group of unnamed objects has an empty keyId.
const groupKey = (group: OutlierGroup) => group.keyId || group.keyLabel

/**
 * The exceptions to one convention, grouped by where they sit, so one stray
 * object can be told from a whole subtree that was built differently. Every
 * group is drawn against the largest, and opens onto its objects.
 */
function Exceptions({ deviation }: { deviation: Deviation }) {
  // A convention broken in one place has nothing to choose between: its objects are shown at once.
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(deviation.groups.length === 1 ? [groupKey(deviation.groups[0])] : [])
  )
  const largest = deviation.groups.reduce((max, group) => Math.max(max, group.members.length), 0)

  const toggle = (key: string) =>
    setOpen(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const row = (group: OutlierGroup) => {
    const key = groupKey(group)
    const place = groupPlace(deviation.kind, group)
    const isOpen = open.has(key)
    return (
      <div className="py-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,8rem)_auto] items-center gap-x-4">
          <span className="min-w-0 break-words text-[13px] text-i3x-text">
            {capitalize(place)}
            {/* A naming group is named by one of its members; the shape they share is printed beside it. */}
            {deviation.kind === 'naming' && group.keyId !== '' && (
              <span className="ml-2 text-[12px] text-i3x-text-muted whitespace-nowrap">pattern {group.keyLabel}</span>
            )}
          </span>
          <DataBar share={largest > 0 ? group.members.length / largest : 0} />
          <Toggle open={isOpen} onToggle={() => toggle(key)} label={`the ${plural(group.members.length, 'object')} ${place}`}>
            <span className="w-12 text-right text-i3x-text tabular-nums">{group.members.length.toLocaleString()}</span>
          </Toggle>
        </div>
        {isOpen && (
          <div className="mt-1 ml-1 pl-3 border-l border-i3x-border">
            <RefList items={group.members} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-lg bg-i3x-bg px-4 py-3">
      <div className="flex items-baseline justify-between gap-4 pb-1">
        <span className="text-[12.5px] text-i3x-text-muted">
          Where the {plural(deviation.outlierCount, 'exception')} {deviation.outlierCount === 1 ? 'is' : 'are'}
        </span>
        <CopyLink
          build={() =>
            JSON.stringify(
              {
                kind: deviation.kind,
                typeId: deviation.typeId,
                relatedTypeId: deviation.relatedTypeId ?? deviation.signature,
                conforming: deviation.conforming,
                total: deviation.total,
                outliers: deviation.groups.flatMap(group => group.members.map(member => ({ ...member, group: group.keyLabel }))),
              },
              null,
              2
            )
          }
        >
          Copy as JSON
        </CopyLink>
      </div>
      {deviation.groups.length <= GROUP_WINDOW ? (
        deviation.groups.map(group => <div key={groupKey(group)}>{row(group)}</div>)
      ) : (
        <WindowedList items={deviation.groups} estimateHeight={36} className="max-h-80" getKey={groupKey} renderRow={row} />
      )}
    </div>
  )
}
