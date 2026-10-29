import { useMemo, useState, useEffect } from 'react'
import { useExplorerStore } from '../../stores/explorer'
import { buildAncestorChain, useElementNavigation } from './navigation'
import { HomeIcon } from '../common/icons'
import type { ObjectInstance } from '../../api/types'

const crumbLink =
  'text-i3x-text-muted hover:text-i3x-primary rounded transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary'

// A deep hierarchy would run the crumb trail off the pane, so past this many
// ancestors we keep the outermost and the nearest and fold the middle behind a
// "…" button. Deep chains are common in ISA-95 models.
const HEAD_CRUMBS = 1
const TAIL_CRUMBS = 1
const COLLAPSE_ABOVE = HEAD_CRUMBS + TAIL_CRUMBS + 1

/**
 * Folds the middle of a long ancestor chain. `null` marks where the "…" goes.
 * Collapsing only pays off if it hides more than one crumb, hence COLLAPSE_ABOVE.
 */
export function collapseCrumbs<T>(ancestors: T[]): { shown: (T | null)[]; hiddenCount: number } {
  if (ancestors.length <= COLLAPSE_ABOVE) return { shown: ancestors, hiddenCount: 0 }
  return {
    shown: [...ancestors.slice(0, HEAD_CRUMBS), null, ...ancestors.slice(-TAIL_CRUMBS)],
    hiddenCount: ancestors.length - HEAD_CRUMBS - TAIL_CRUMBS,
  }
}

function Separator() {
  return <span aria-hidden="true" className="text-i3x-text-muted/60">›</span>
}

/**
 * "Overview › root › … › parent › **current**" (home icon on the first crumb).
 *
 * `object` renders the parent chain; `label` covers selections that have no
 * ancestry (namespaces, object types), showing just root › label.
 */
export function Breadcrumb({ object, label }: { object?: ObjectInstance; label?: string }) {
  const objectIndex = useExplorerStore(state => state.objectIndex)
  const { selectElement, showHome } = useElementNavigation()
  const [expanded, setExpanded] = useState(false)

  const ancestors = useMemo(
    () => (object ? buildAncestorChain(object, objectIndex) : []),
    [object, objectIndex]
  )

  // A new selection re-collapses the trail.
  useEffect(() => setExpanded(false), [object?.elementId])

  const current = object?.displayName ?? label ?? ''
  const { shown, hiddenCount } = expanded
    ? { shown: ancestors as (ObjectInstance | null)[], hiddenCount: 0 }
    : collapseCrumbs(ancestors)

  return (
    <nav aria-label="Breadcrumb" className="text-xs min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li className="flex-shrink-0">
          <button
            type="button"
            onClick={showHome}
            title="Model overview"
            className={`${crumbLink} inline-flex items-center gap-1`}
          >
            <HomeIcon size={11} />
            Overview
          </button>
        </li>

        {shown.map(ancestor =>
          ancestor === null ? (
            <li key="ellipsis" className="flex items-center gap-1.5 flex-shrink-0">
              <Separator />
              <button
                type="button"
                onClick={() => setExpanded(true)}
                aria-label={`Show ${hiddenCount} hidden ancestors`}
                title={`Show ${hiddenCount} hidden ancestors`}
                className={`${crumbLink} px-1`}
              >
                …
              </button>
            </li>
          ) : (
            <li key={ancestor.elementId} className="flex items-center gap-1.5 min-w-0">
              <Separator />
              <button
                type="button"
                onClick={() => selectElement(ancestor.elementId)}
                title={ancestor.elementId}
                className={`${crumbLink} max-w-[9rem] sm:max-w-[11rem] truncate`}
              >
                {ancestor.displayName}
              </button>
            </li>
          )
        )}

        <li className="flex items-center gap-1.5 min-w-0" aria-current="page">
          <Separator />
          <span
            className="font-medium text-i3x-text max-w-[10rem] sm:max-w-[15rem] truncate"
            title={current}
          >
            {current}
          </span>
        </li>
      </ol>
    </nav>
  )
}
