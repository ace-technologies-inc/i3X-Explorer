import { useQuery } from '@tanstack/react-query'
import { getClient } from '../api/client'
import type { ObjectInstance } from '../api/types'
import { isCatalogSkeleton } from './catalogInstaller'
import { requireClient } from './queries'
import { serverScope } from './queryClient'

export interface ObjectDetails {
  object: ObjectInstance
  detailsPending: boolean
  /** Why the full object could not be loaded; the skeleton is shown meanwhile. */
  detailsError: Error | null
  retryDetails: () => void
}

/**
 * The full object for the detail view. Catalog skeletons, and objects that
 * arrived without metadata (e.g. from the metadata-free related batch), render
 * at once and are replaced by the full object from the server. A catalog
 * refresh revalidates it (see `services/catalog.ts`).
 */
export function useObjectDetails(object: ObjectInstance): ObjectDetails {
  const client = getClient()
  const needsDetails = isCatalogSkeleton(object) || object.metadata === undefined

  const query = useQuery<ObjectInstance | null>({
    queryKey: ['objectDetails', ...serverScope(), object.elementId],
    queryFn: () => requireClient().getObject(object.elementId),
    enabled: needsDetails && client !== null,
  })

  const retryDetails = () => void query.refetch()
  if (!needsDetails) return { object, detailsPending: false, detailsError: null, retryDetails }
  return {
    object: query.data ?? object,
    detailsPending: query.isPending && query.fetchStatus !== 'idle',
    detailsError: query.data ? null : query.error,
    retryDetails,
  }
}
