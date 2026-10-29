import { useQuery } from '@tanstack/react-query'
import { getClient } from '../api/client'
import { compositionDepth } from '../api/normalize'
import type { HistoricalValue, LastKnownValue } from '../api/types'
import { serverScope } from './queryClient'

export function errorText(error: unknown, fallback: string): string | null {
  if (!error) return null
  return error instanceof Error ? error.message : fallback
}

/**
 * The selected element's current value. A revisit shows the last value at once
 * and revalidates it in the background.
 */
export function useObjectValue(elementId: string, isComposition: boolean) {
  const client = getClient()
  const maxDepth = compositionDepth(isComposition)
  return useQuery<LastKnownValue | null>({
    queryKey: ['value', ...serverScope(), elementId, maxDepth],
    queryFn: () => requireClient().getValue(elementId, maxDepth),
    enabled: client !== null,
  })
}

/**
 * History for one element and range, fetched only on request (`refetch`). The
 * last result per element and range stays cached, so returning to the tab shows it.
 */
export function useObjectHistory(elementId: string, rangeKey: string, resolveRange: () => { startTime: string; endTime: string }) {
  return useQuery<HistoricalValue>({
    queryKey: ['history', ...serverScope(), elementId, rangeKey],
    queryFn: () => {
      const { startTime, endTime } = resolveRange()
      return requireClient().getHistory(elementId, startTime, endTime)
    },
    enabled: false,
  })
}

export function requireClient() {
  const client = getClient()
  if (!client) throw new Error('Not connected.')
  return client
}
