import { useState } from 'react'
import { Card } from '../main/primitives'
import { InfoHint } from '../main/InfoHint'
import { Chevron } from '../common/Chevron'
import { CopyJsonButton } from '../common/CopyJsonButton'
import { useElementNavigation } from '../main/navigation'
import { WindowedList } from './WindowedList'
import {
  deviationHeadline,
  groupLabel,
  type Deviation,
  type InsightRef,
  type OutlierGroup,
} from '../main/insightsReport'

/**
 * The norm-breakers, explained. The card's original sin was a bare outlier
 * list ("19 sit elsewhere", where?); here every finding's exceptions are
 * grouped by where they actually sit, with the subtree called out when the
 * whole group shares one, "19 sit under Mfg Line instead, all within
 * NORTHSITE". No "+N more" dead ends: every member of every group is browsable
 * (windowed past a screenful) and clickable.
 */

/** Groups up to this size render as inline chips; larger ones get a windowed list. */
const CHIP_LIMIT = 8
/** Past this many outlier groups, the group list itself is windowed. */
const GROUP_WINDOW_THRESHOLD = 12

export function DeviationsSection({ deviations }: { deviations: Deviation[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (deviations.length === 0) return null

  const keyOf = (d: Deviation) => `${d.kind}:${d.typeId}:${d.relatedTypeId ?? d.signature ?? ''}`
  const toggle = (key: string) =>
    setOpen(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Card
      title={`Deviations · ${deviations.length.toLocaleString()}`}
      actions={
        <InfoHint label="How are deviations ranked?" title="Deviations">
          The exceptions to each convention, strongest convention first. 990 of 1,000 ranks above 9
          of 10: the bigger the agreement, the more likely each exception is a real mistake rather
          than a small sample. Exceptions are grouped by where they actually sit, so you can tell
          one stray object from a whole subtree that was built differently.
        </InfoHint>
      }
    >
      <WindowedList
        items={deviations}
        estimateHeight={40}
        className="max-h-[30rem] -mx-2"
        getKey={keyOf}
        renderRow={deviation => (
          <DeviationRow
            deviation={deviation}
            open={open.has(keyOf(deviation))}
            onToggle={() => toggle(keyOf(deviation))}
          />
        )}
      />
    </Card>
  )
}

function DeviationRow({
  deviation,
  open,
  onToggle,
}: {
  deviation: Deviation
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="px-2">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-2 py-2 rounded-lg text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          <Chevron open={open} />
          <span className="text-[12.5px] text-i3x-text truncate">
            {deviationHeadline(deviation)}
          </span>
        </button>
        <CopyJsonButton
          title="Copy this finding as JSON"
          build={() =>
            JSON.stringify(
              {
                kind: deviation.kind,
                typeId: deviation.typeId,
                relatedTypeId: deviation.relatedTypeId ?? deviation.signature,
                conforming: deviation.conforming,
                total: deviation.total,
                outliers: deviation.groups.flatMap(group =>
                  group.members.map(member => ({ ...member, group: group.keyLabel }))
                ),
              },
              null,
              2
            )
          }
        />
      </div>
      {open &&
        // The group list itself can be large: missing-child groups are one per
        // subtree root, and thousands of scattered outliers fan into thousands
        // of one-member groups. Past a screenful, window the groups too.
        (deviation.groups.length <= GROUP_WINDOW_THRESHOLD ? (
          <div className="pb-3 pl-7 pr-2 space-y-2.5">
            {deviation.groups.map(group => (
              <GroupBlock key={group.keyId ?? group.keyLabel} kind={deviation.kind} group={group} />
            ))}
          </div>
        ) : (
          <div className="pb-3 pl-7 pr-2">
            <WindowedList
              items={deviation.groups}
              estimateHeight={56}
              className="max-h-80"
              getKey={group => group.keyId ?? group.keyLabel}
              renderRow={group => (
                <div className="pb-2.5">
                  <GroupBlock kind={deviation.kind} group={group} />
                </div>
              )}
            />
          </div>
        ))}
    </div>
  )
}

function GroupBlock({ kind, group }: { kind: Deviation['kind']; group: OutlierGroup }) {
  return (
    <div>
      <p className="text-[12px] text-i3x-text-muted mb-1">{groupLabel(kind, group)}</p>
      {group.members.length <= CHIP_LIMIT ? (
        <div className="flex flex-wrap gap-1.5">
          {group.members.map(member => (
            <MemberChip key={member.elementId} member={member} />
          ))}
        </div>
      ) : (
        <MemberList members={group.members} />
      )}
    </div>
  )
}

function MemberChip({ member }: { member: InsightRef }) {
  const { selectElement } = useElementNavigation()
  return (
    <button
      type="button"
      onClick={() => selectElement(member.elementId)}
      title={`${member.elementId} · click to open`}
      className="max-w-[16rem] truncate px-2 py-0.5 rounded-full border border-i3x-border text-[11.5px] text-i3x-text hover:border-i3x-primary hover:text-i3x-primary transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
    >
      {member.label}
      <span className="text-i3x-text-muted"> · {member.context}</span>
    </button>
  )
}

/** Large groups: every member still browsable, just windowed. */
function MemberList({ members }: { members: InsightRef[] }) {
  const { selectElement } = useElementNavigation()
  return (
    <WindowedList
      items={members}
      estimateHeight={28}
      className="max-h-56 border border-i3x-border rounded-lg"
      getKey={member => member.elementId}
      renderRow={member => (
        <button
          type="button"
          onClick={() => selectElement(member.elementId)}
          title={`${member.elementId} · click to open`}
          className="w-full h-7 flex items-baseline gap-2 px-2.5 text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary min-w-0"
        >
          <span className="text-[12px] text-i3x-text truncate">{member.label}</span>
          <span className="text-[10.5px] text-i3x-text-muted truncate">{member.context}</span>
        </button>
      )}
    />
  )
}
