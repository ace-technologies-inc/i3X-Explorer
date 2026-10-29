import { Card } from '../main/primitives'
import { InfoHint } from '../main/InfoHint'
import { SplitIcon } from '../common/icons'
import { useElementNavigation } from '../main/navigation'
import { WindowedList } from './WindowedList'
import { formatShare } from './TypeAtlas'
import type { Split } from '../main/insightsReport'

/**
 * Types whose placement is genuinely two (or more) things. Calling 710
 * objects "outliers" when they are 6% of a type concentrated in one
 * alternative home isn't a defect report, it's a misread, these render as
 * distributions, with examples, and never appear in Deviations.
 */
export function SplitsSection({ splits }: { splits: Split[] }) {
  const { selectType, selectElement } = useElementNavigation()
  if (splits.length === 0) return null

  return (
    <Card
      title={`Splits · ${splits.length.toLocaleString()}`}
      actions={
        <InfoHint label="What is a split?" title="Splits">
          A type whose instances live in two different kinds of place, in numbers too large to be
          mistakes. Calling the smaller group "exceptions" would be a misread, so it is shown as a
          split instead. If the split itself surprises you, that is the finding.
        </InfoHint>
      }
    >
      {/* Windowed like every other list on this page: split count is bounded
          only by the number of types, and a scattered multi-line plant model
          can qualify hundreds of them. */}
      <WindowedList
        items={splits}
        estimateHeight={120}
        className="max-h-[32rem]"
        getKey={split => split.typeId}
        renderRow={split => (
          <div className="min-w-0 pb-4">
            <p className="text-[12.5px] text-i3x-text flex items-center gap-1.5 mb-1.5">
              <SplitIcon size={13} className="text-i3x-text-muted" />
              <button
                type="button"
                onClick={() => selectType(split.typeId)}
                title={`${split.typeId} · open this type`}
                className="hover:text-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary rounded truncate"
              >
                <b>{split.typeLabel}</b>
              </button>
              <span className="text-i3x-text-muted">
                · {split.total.toLocaleString()} instances, {split.populations.length} placement
                patterns
              </span>
            </p>
            <ul className="space-y-1.5 pl-5">
              {split.populations.map(population => (
                <li key={population.parentTypeId ?? population.parentTypeLabel} className="min-w-0">
                  <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                    <span className="text-[12px] text-i3x-text truncate">
                      {population.parentTypeLabel}
                    </span>
                    <span className="text-[11.5px] text-i3x-text-muted tabular-nums">
                      {population.count.toLocaleString()} · {formatShare(population.share)}
                    </span>
                  </span>
                  <span className="block mt-0.5 h-1.5 rounded-full bg-i3x-bg overflow-hidden">
                    <span
                      className="block h-full rounded-r-[4px]"
                      style={{
                        width: `${Math.max(population.share * 100, 1)}%`,
                        background: 'rgb(var(--i3x-primary) / 0.8)',
                      }}
                    />
                  </span>
                  {population.examples.length > 0 && (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {population.examples.map(example => (
                        <button
                          key={example.elementId}
                          type="button"
                          onClick={() => selectElement(example.elementId)}
                          title={`${example.elementId} · click to open`}
                          className="max-w-[14rem] truncate px-2 py-0.5 rounded-full border border-i3x-border text-[11px] text-i3x-text hover:border-i3x-primary hover:text-i3x-primary transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
                        >
                          {example.label}
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      />
    </Card>
  )
}
