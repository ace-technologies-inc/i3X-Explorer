import { useMemo, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/**
 * The one virtualized list on the insights page: dynamic row heights via
 * measureElement (atlas rows expand in place), rows in normal flow between
 * top/bottom spacer padding. Same windowing pattern as the tree and the diff
 * view, factored out because this page needs it in several places.
 *
 * HEIGHT CONTRACT (this shipped broken once; do not undo it):
 *
 * Every call site bounds this list with `max-h-*` only, so the container has no
 * height of its own and takes one from its content. The virtualizer gives up
 * when the scroll container measures zero (virtual-core `calculateRange`:
 * `outerSize === 0` sets `range = null`), and an empty range renders no rows,
 * which leaves the content at zero height, which leaves the container at zero.
 * That is a stable fixed point, so nothing ever drew and the ResizeObserver
 * never fired to break the tie.
 *
 * The spacer below therefore carries `minHeight: getTotalSize()`: the full
 * virtual height of the list, which is derived from the size estimates and
 * does NOT depend on the range. The container measures
 * min(max-height, virtual height) on the very first layout, the range
 * computes, and rows render.
 *
 * Do not "fix" a future recurrence by giving the container a fixed `h-*`: the
 * `max-h-*` bound is what lets a three-item list shrink to fit instead of
 * rendering a 32rem empty box.
 */
export function WindowedList<T>({
  items,
  estimateHeight,
  className = '',
  getKey,
  renderRow,
}: {
  items: T[]
  /** Initial row-height guess; real heights are measured after mount. */
  estimateHeight: number
  /** Scroll-container classes. Bound the height with `max-h-*`, never `h-*`. */
  className?: string
  getKey?: (item: T, index: number) => string
  renderRow: (item: T, index: number) => ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // A new key function makes the virtualizer re-measure every row, so it changes only with the list.
  const getItemKey = useMemo(
    () => (getKey ? (index: number) => getKey(items[index], index) : undefined),
    [getKey, items]
  )
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateHeight,
    overscan: 8,
    getItemKey,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0

  return (
    <div ref={scrollRef} data-windowed-list="" className={`overflow-y-auto ${className}`}>
      <div style={{ minHeight: totalSize, paddingTop, paddingBottom }}>
        {virtualItems.map(virtualItem => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
          >
            {renderRow(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
