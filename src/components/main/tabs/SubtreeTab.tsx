import type { ObjectInstance } from '../../../api/types'
import { useExplorerStore } from '../../../stores/explorer'
import { RelationshipLegend } from '../../graph/RelationshipLegend'
import { RelatedFailuresNotice } from '../../graph/RelatedFailuresNotice'
import { TreeGraph } from '../../graph/TreeGraph'
import { useEgoGraph } from '../../graph/useEgoGraph'
import { CardCodeSample } from '../../details/CodeSamplePanel'
import { buildObjectRequestTabs } from '../../details/requestTabs'
import { Card } from '../primitives'
import { useElementNavigation } from '../navigation'
import { DepthControl } from './DepthControl'

/**
 * The dedicated subtree view: the selected element and everything beneath it,
 * out to a configurable depth.
 *
 * The Relationships tab already draws a depth-N tree, but it shares its panel
 * with the direct-relationship list and fans out from the root to the parent
 * and non-hierarchy links too. On a deeply nested model the question is usually
 * just "what's under this?", so this tab gives that one walk the whole panel:
 * descendants only (`descendantsOnly` on the walk, no parent leaf, no side
 * links), a deeper default depth, and its own depth state (`subtreeDepth`) so
 * drilling deep here doesn't drag the Relationships map along with it.
 */
export function SubtreeTab({ object }: { object: ObjectInstance }) {
  const depth = useExplorerStore(state => state.subtreeDepth)
  const setDepth = useExplorerStore(state => state.setSubtreeDepth)
  const { selectElement } = useElementNavigation()

  // Same shared walk as the Relationships tab, told to descend from the first hop.
  const { graph, isLoading, error } = useEgoGraph(object, depth, true)

  return (
    <Card
      title="Subtree"
      actions={
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-i3x-text-muted normal-case tracking-normal">Depth</span>
          <DepthControl value={depth} onChange={setDepth} />
          <CardCodeSample
            tabs={buildObjectRequestTabs(object)}
            initialTabId="relationships"
            title={object.displayName}
            subtitle="Object Instance"
          />
        </div>
      }
      className="flex h-full flex-col min-h-0"
      // A deep subtree is exactly the drawing that runs out of room first.
      expandable
    >
      <RelatedFailuresNotice failures={graph?.failures} className="mb-3 shrink-0" />
      <div className="flex-1 min-h-0">
        {/* No list beside it and no drag source in this tab, so onRootElement is
            omitted: navigation (click) is the only way onward, which is right for
            a tab whose root is always the selected element. */}
        <TreeGraph
          root={object}
          graph={graph}
          isLoading={isLoading}
          error={error}
          depth={depth}
          descendantsOnly
          onSelectElement={selectElement}
        />
      </div>

      <p className="mt-3 shrink-0 text-[11.5px] text-i3x-text-muted">
        Drag to pan · scroll to zoom · click a node to open it
      </p>

      {/* Only child edges can appear in a descendants-only walk. */}
      <RelationshipLegend buckets={['child']} className="mt-3 shrink-0" />
    </Card>
  )
}
