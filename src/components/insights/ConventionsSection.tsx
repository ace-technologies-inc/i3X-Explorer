import { useState } from 'react'
import { Card } from '../main/primitives'
import { InfoHint } from '../main/InfoHint'
import { Chevron } from '../common/Chevron'
import { CheckIcon } from '../common/icons'
import { useElementNavigation } from '../main/navigation'
import { WindowedList } from './WindowedList'
import { conventionText, type Convention } from '../main/insightsReport'

/**
 * The positive findings: the modeling conventions the catalog itself
 * demonstrates, which is auto-generated documentation of the implicit schema.
 *
 * Two lists, not one. A norm that 90% of a type follows is only interesting if
 * the rest of the catalog does NOT already do the same thing; without that
 * test a flat list of 51 "conventions" is mostly tautologies and reads as
 * wallpaper (see MIN_NORM_LIFT in insightsReport.ts). The unremarkable ones
 * are still true, so they stay browsable behind a fold instead of vanishing.
 */
export function ConventionsSection({ conventions }: { conventions: Convention[] }) {
  const [showTrivial, setShowTrivial] = useState(false)
  if (conventions.length === 0) return null

  const notable = conventions.filter(convention => convention.notable)
  const trivial = conventions.filter(convention => !convention.notable)

  return (
    <Card
      title={`Conventions · ${notable.length.toLocaleString()}`}
      actions={
        <InfoHint label="What is a convention?" title="Conventions">
          Something at least 90% of a type's instances do, out of at least 8 of them, and that the
          rest of the model does not already do anyway. That last test is what keeps the list
          short: if everything sits under a Location, "every Pump sits under a Location" is the
          shape of the model, not a rule about Pumps. Those still appear, folded away at the
          bottom.
        </InfoHint>
      }
    >
      {notable.length > 0 ? (
        <WindowedList
          items={notable}
          estimateHeight={30}
          className="max-h-80"
          getKey={c => `${c.kind}:${c.typeId}:${c.relatedTypeId ?? c.signature ?? ''}`}
          renderRow={convention => <ConventionRow convention={convention} />}
        />
      ) : (
        <p className="px-2 py-1 text-[12px] text-i3x-text-muted">
          Nothing one type does that the rest of the model doesn't do too.
        </p>
      )}

      {trivial.length > 0 && (
        <div className="mt-2 pt-2 border-t border-i3x-border">
          <button
            type="button"
            onClick={() => setShowTrivial(open => !open)}
            aria-expanded={showTrivial}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            <Chevron open={showTrivial} />
            <span className="text-[12px] text-i3x-text-muted">
              {trivial.length.toLocaleString()} more hold, but the whole model does the same thing
            </span>
          </button>
          {showTrivial && (
            <WindowedList
              items={trivial}
              estimateHeight={30}
              className="max-h-64"
              getKey={c => `${c.kind}:${c.typeId}:${c.relatedTypeId ?? c.signature ?? ''}`}
              renderRow={convention => <ConventionRow convention={convention} muted />}
            />
          )}
        </div>
      )}
    </Card>
  )
}

function ConventionRow({ convention, muted }: { convention: Convention; muted?: boolean }) {
  const { selectType } = useElementNavigation()
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 min-w-0">
      <CheckIcon
        size={13}
        className={
          muted
            ? 'text-i3x-text-muted/50'
            : convention.coverage === 1
              ? 'text-i3x-success'
              : 'text-i3x-text-muted'
        }
      />
      <button
        type="button"
        onClick={() => selectType(convention.typeId)}
        title={`${convention.typeId} · ${liftText(convention)} · open this type`}
        className={`text-left text-[12.5px] truncate hover:text-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary rounded ${
          muted ? 'text-i3x-text-muted' : 'text-i3x-text'
        }`}
      >
        {conventionText(convention)}
      </button>
    </div>
  )
}

/** How much more often this type does it than the rest of the catalog. */
function liftText(convention: Convention): string {
  if (convention.baseRate === null) return 'nothing else in the catalog to compare against'
  if (!Number.isFinite(convention.lift)) return 'nothing else in the catalog does this'
  return `${convention.lift.toFixed(1)}× as often as the rest of the catalog`
}
