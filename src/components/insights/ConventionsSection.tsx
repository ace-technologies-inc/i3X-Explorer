import { useMemo, useState } from 'react'
import { Panel, Toggle } from '../main/homePrimitives'
import { InfoHint } from '../main/InfoHint'
import { SegmentedControl } from '../main/primitives'
import type { InsightsReport } from '../main/insightsReport'
import { RULE_GRID, RuleRow, buildRules, rulePredicate, ruleStatement, type Rule } from './Rules'
import { ShowMore, TypeName, plural, usePaged } from './parts'

/**
 * Every convention the model keeps, grouped by the type it is about: the
 * modeling rules nobody wrote down, read off the instances. The subject is
 * printed once per type, and each rule under it is a meter.
 */

type Filter = 'all' | 'exceptions' | 'kept'

/** Types on the first page: enough for most models, bounded for one that declares thousands. */
const TYPES_PER_PAGE = 40

interface TypeGroup {
  typeId: string
  typeLabel: string
  /** Instances the type's conventions were measured over. */
  instances: number
  rules: Rule[]
}

/** Largest types first; within a type, what is broken before what is kept. */
function groupByType(rules: Rule[]): TypeGroup[] {
  const groups = new Map<string, TypeGroup>()
  for (const rule of rules) {
    const { typeId, typeLabel, total } = rule.convention
    const group = groups.get(typeId) ?? { typeId, typeLabel, instances: 0, rules: [] }
    group.instances = Math.max(group.instances, total)
    group.rules.push(rule)
    groups.set(typeId, group)
  }
  for (const group of groups.values()) group.rules.sort((a, b) => a.convention.coverage - b.convention.coverage)
  return [...groups.values()].sort((a, b) => b.instances - a.instances || a.typeLabel.localeCompare(b.typeLabel))
}

export function ConventionsSection({ report }: { report: InsightsReport }) {
  const { notable, shared } = useMemo(() => buildRules(report), [report])
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [sharedOpen, setSharedOpen] = useState(false)

  const broken = notable.filter(rule => rule.deviation !== null).length
  const groups = useMemo(
    () =>
      groupByType(
        filter === 'all' ? notable : notable.filter(rule => (rule.deviation !== null) === (filter === 'exceptions'))
      ),
    [notable, filter]
  )
  const paged = usePaged(groups, TYPES_PER_PAGE)

  const toggle = (key: string) =>
    setOpen(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Panel
      title={
        <>
          Conventions
          <InfoHint label="What is a convention?" title="Conventions" align="left">
            Something at least 90% of a type's instances do, out of at least 8 of them, and that the
            rest of the model does not already do anyway. That last test is what keeps the list
            short: if everything sits under a Location, "every Pump sits under a Location" is the
            shape of the model, not a rule about Pumps.
            <br />
            <br />
            The bar is the share of the type's instances that keep the convention. Exceptions are
            grouped by where they sit, so one stray object can be told from a whole area built
            differently.
          </InfoHint>
        </>
      }
      note={notable.length > 0 ? `${plural(notable.length, 'convention')} across ${plural(groupByTypeCount(notable), 'type')}` : undefined}
      action={
        notable.length > 0 && (
          <SegmentedControl
            label="Which conventions"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${notable.length.toLocaleString()}` },
              { value: 'exceptions', label: `With exceptions ${broken.toLocaleString()}` },
              { value: 'kept', label: `Fully kept ${(notable.length - broken).toLocaleString()}` },
            ]}
          />
        )
      }
    >
      {groups.length === 0 ? (
        <p className="text-[13px] text-i3x-text-muted">
          {notable.length === 0
            ? "Nothing one type does that the rest of the model doesn't do too."
            : filter === 'exceptions'
              ? 'Every convention is kept by all of its type.'
              : 'Every convention has at least one exception.'}
        </p>
      ) : (
        <>
          <div className={`${RULE_GRID} hidden lg:grid pb-2 text-[12px] text-i3x-text-muted border-b border-i3x-border`}>
            <span>Convention</span>
            <span>Kept by</span>
            <span className="text-right">Instances</span>
            <span className="text-right">Exceptions</span>
          </div>
          {paged.shown.map(group => (
            <section key={group.typeId} aria-label={group.typeLabel} className="pt-4 first:pt-0 lg:first:pt-4">
              <div className="flex items-baseline gap-2.5">
                <TypeName typeId={group.typeId} label={group.typeLabel} className="text-[13.5px] font-semibold text-i3x-text" />
                <span className="shrink-0 text-[12px] text-i3x-text-muted tabular-nums">{plural(group.instances, 'instance')}</span>
              </div>
              <div className="divide-y divide-i3x-border/60">
                {group.rules.map(rule => (
                  <RuleRow key={rule.key} rule={rule} text={rulePredicate(rule)} open={open.has(rule.key)} onToggle={() => toggle(rule.key)} />
                ))}
              </div>
            </section>
          ))}
          <ShowMore paged={paged} noun="types" className="mt-2 pt-3 border-t border-i3x-border/60" />
        </>
      )}

      {shared.length > 0 && (
        <div className="mt-5 pt-4 border-t border-i3x-border">
          <Toggle open={sharedOpen} onToggle={() => setSharedOpen(value => !value)} label="the conventions the rest of the model keeps too">
            <span className="text-i3x-text-muted">
              {plural(shared.length, 'more convention')} the rest of the model keeps too
            </span>
          </Toggle>
          {sharedOpen && (
            <div className="mt-1 divide-y divide-i3x-border/60">
              {shared.map(rule => (
                <RuleRow key={rule.key} rule={rule} text={ruleStatement(rule)} open={false} onToggle={() => undefined} muted />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function groupByTypeCount(rules: Rule[]): number {
  return new Set(rules.map(rule => rule.convention.typeId)).size
}
