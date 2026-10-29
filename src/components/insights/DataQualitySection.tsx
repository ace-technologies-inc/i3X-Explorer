import { useState } from 'react'
import { Card } from '../main/primitives'
import { InfoHint } from '../main/InfoHint'
import { Chevron } from '../common/Chevron'
import { useElementNavigation } from '../main/navigation'
import { WindowedList } from './WindowedList'
import type { DataQuality, InsightRef } from '../main/insightsReport'
import type { ReactNode } from 'react'

/**
 * The model-quality hub: the Home strip's orphan/untyped counts, but with the
 * actual objects browsable, because an orphan count you can't inspect is a
 * dead end. Hidden entirely when there is nothing to say.
 *
 * Types with no instances sit BELOW the issue list and are not counted in it.
 * In I3X a namespace is a type library, so a server that publishes a profile
 * it doesn't fully instantiate is behaving correctly. Counting those made the
 * page's largest number its most benign fact.
 */
export function DataQualitySection({ quality }: { quality: DataQuality }) {
  const issues =
    quality.orphans.length + quality.untyped.length + quality.duplicateElementIds.length
  if (issues === 0 && quality.unusedTypes.length === 0) return null

  return (
    <Card
      title={`Data quality · ${issues.toLocaleString()} ${issues === 1 ? 'issue' : 'issues'}`}
      actions={
        <InfoHint label="What counts as an issue?" title="Data quality">
          An orphan names a parent this catalog doesn't contain, usually a partial load. An
          untyped object carries no <span className="font-mono">typeId</span>, so nothing
          describes its shape. A duplicate elementId means one server response used the same id
          twice, and the last one wins everywhere in this app.
        </InfoHint>
      }
    >
      {issues === 0 ? (
        <p className="px-2 py-1 text-[12px] text-i3x-text-muted">
          No orphans, untyped objects, or duplicate ids.
        </p>
      ) : (
        <div className="space-y-1">
          <QualityBlock label="Orphaned objects" count={quality.orphans.length}>
            <RefList refs={quality.orphans} />
          </QualityBlock>
          <QualityBlock label="Untyped objects" count={quality.untyped.length}>
            <RefList refs={quality.untyped} />
          </QualityBlock>
          <QualityBlock label="Duplicate elementIds" count={quality.duplicateElementIds.length}>
            <DuplicateList duplicates={quality.duplicateElementIds} />
          </QualityBlock>
        </div>
      )}

      {quality.unusedTypes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-i3x-border">
          <QualityBlock
            label="Declared types with no instances"
            count={quality.unusedTypes.length}
            note="Not an issue. A namespace is a type library, so a profile can declare types this server never instantiates. Worth a look only if you expected those objects to be here."
          >
            <TypeList types={quality.unusedTypes} />
          </QualityBlock>
        </div>
      )}
    </Card>
  )
}

function QualityBlock({
  label,
  count,
  note,
  children,
}: {
  label: string
  count: number
  /** Shown under the header. Used to say when a count is not a problem. */
  note?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <Chevron open={open} />
        <span className="text-[12.5px] text-i3x-text">{label}</span>
        <span className="ml-auto text-[11.5px] text-i3x-text-muted tabular-nums">
          {count.toLocaleString()}
        </span>
      </button>
      {note && <p className="pl-7 pr-2 text-[11px] text-i3x-text-muted/80">{note}</p>}
      {open && <div className="pl-7 pb-2 pt-1">{children}</div>}
    </div>
  )
}

/** Windowed, an orphan list on a partial load can be thousands long. */
function RefList({ refs }: { refs: InsightRef[] }) {
  const { selectElement } = useElementNavigation()
  return (
    <WindowedList
      items={refs}
      estimateHeight={28}
      className="max-h-56"
      getKey={ref => ref.elementId}
      renderRow={ref => (
        <button
          type="button"
          onClick={() => selectElement(ref.elementId)}
          title={`${ref.elementId} · click to open`}
          className="w-full h-7 flex items-baseline gap-2 px-2 rounded text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary min-w-0"
        >
          <span className="text-[12px] text-i3x-text truncate">{ref.label}</span>
          <span className="text-[10.5px] text-i3x-text-muted truncate">{ref.context}</span>
        </button>
      )}
    />
  )
}

function TypeList({ types }: { types: { typeId: string; label: string }[] }) {
  const { selectType } = useElementNavigation()
  return (
    <WindowedList
      items={types}
      estimateHeight={28}
      className="max-h-56"
      getKey={type => type.typeId}
      renderRow={type => (
        <button
          type="button"
          onClick={() => selectType(type.typeId)}
          title={`${type.typeId} · open this type`}
          className="w-full h-7 flex items-baseline px-2 rounded text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary min-w-0"
        >
          <span className="text-[12px] text-i3x-text truncate">{type.label}</span>
        </button>
      )}
    />
  )
}

function DuplicateList({ duplicates }: { duplicates: { elementId: string; count: number }[] }) {
  const { selectElement } = useElementNavigation()
  return (
    <WindowedList
      items={duplicates}
      estimateHeight={28}
      className="max-h-56"
      getKey={dup => dup.elementId}
      renderRow={dup => (
        <button
          type="button"
          onClick={() => selectElement(dup.elementId)}
          title={`${dup.elementId} · opens the surviving (last) entry`}
          className="w-full h-7 flex items-baseline gap-2 px-2 rounded text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary min-w-0"
        >
          <span className="text-[12px] font-mono text-i3x-text truncate">{dup.elementId}</span>
          <span className="text-[10.5px] text-i3x-text-muted">×{dup.count}</span>
        </button>
      )}
    />
  )
}
