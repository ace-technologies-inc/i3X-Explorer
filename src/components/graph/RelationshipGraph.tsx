import type { ObjectInstance } from '../../api/types'
import { useExplorerStore } from '../../stores/explorer'
import type { EgoGraph } from './egoGraph'
import { RadialGraph } from './RadialGraph'
import { TreeGraph } from './TreeGraph'
import type { LocateRequest } from './locator'

// Re-exported so existing importers (the list's drag source) keep working.
export { ELEMENT_DRAG_TYPE } from './dragType'

export interface RelationshipGraphProps {
  /** The element at the root/center: the selected object, or whatever was dropped in. */
  root: ObjectInstance
  /** The walk both views draw, and the list beside them reads. */
  graph: EgoGraph | null
  isLoading: boolean
  error: string | null
  depth: number
  /** Element dropped onto the canvas: re-root here without navigating away. */
  onRootElement: (elementId: string) => void
  /** Kept for prop parity; both views re-root on a node click rather than navigate. */
  onSelectElement: (elementId: string) => void
  /** An element hovered outside the map (e.g. a list row), highlighted as if hovered here. */
  externalHoverId?: string | null
  /** A search pick: the active view centres on and zooms to this node. */
  locate?: LocateRequest | null
}

/**
 * The relationship map. Two views of the same ego graph share this entry point:
 * a left-to-right tree (parents left, children right, one node per row) and the
 * radial rings map (distance from the center is the hop count). Which one shows is
 * a toggle in the card header; the choice lives in the explorer store, so it
 * persists across element selections for the session.
 */
export function RelationshipGraph(props: RelationshipGraphProps) {
  const view = useExplorerStore(state => state.relationshipView)
  return view === 'radial' ? <RadialGraph {...props} /> : <TreeGraph {...props} />
}
