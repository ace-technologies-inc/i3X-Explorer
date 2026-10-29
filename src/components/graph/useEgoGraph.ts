import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getClient } from '../../api/client'
import type { ObjectInstance } from '../../api/types'
import { errorText, requireClient } from '../../data/queries'
import { serverScope } from '../../data/queryClient'
import { useExplorerStore } from '../../stores/explorer'
import { expandEgoGraph, type EgoGraph, type Traversal } from './egoGraph'

// A walk is one round trip per hop; revisiting within this window reuses it without a refetch.
const EGO_GRAPH_STALE_MS = 60_000

export interface EgoGraphState {
  graph: EgoGraph | null
  isLoading: boolean
  error: string | null
}

/**
 * One walk, shared by everything that draws it.
 *
 * The list and the map used to fetch separately, the list a single
 * /objects/related on the selected element, each canvas its own depth-N walk,
 * so the list could only ever show one hop, and the two panes could disagree.
 * Owning the walk one level up means one round trip per hop for the whole tab
 * and no way for the surfaces to fall out of step.
 *
 * Walks live in the query cache (data/queryClient.ts): a revisited root and
 * depth draws at once. The previous result is deliberately kept while a new
 * walk runs: raising the depth should extend what you're looking at, not blank it.
 */
export function useEgoGraph(
  root: ObjectInstance,
  depth: number,
  descendantsOnly = false,
  traversal: Traversal = 'hierarchy'
): EgoGraphState {
  const connected = getClient() !== null
  const query = useQuery<EgoGraph>({
    queryKey: ['egoGraph', ...serverScope(), root.elementId, depth, descendantsOnly, traversal],
    queryFn: ({ signal }) => {
      // Read at walk time: a catalog refresh (the 30s poll) alone must not start a new walk.
      const { objectIndex, childrenByParent } = useExplorerStore.getState()
      return expandEgoGraph({
        client: requireClient(),
        root,
        depth,
        store: { objectIndex, childrenByParent },
        descendantsOnly,
        traversal,
        cancelled: () => signal.aborted,
      })
    },
    enabled: connected,
    staleTime: EGO_GRAPH_STALE_MS,
    placeholderData: keepPreviousData,
  })

  return {
    graph: query.data ?? null,
    // A background revalidation of the drawn walk is silent; a different walk shows the loader.
    isLoading: query.isFetching && (query.isPlaceholderData || query.data === undefined),
    error: connected ? errorText(query.error, 'Failed to walk relationships') : 'Not connected.',
  }
}
