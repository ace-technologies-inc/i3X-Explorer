import { QueryClient } from '@tanstack/react-query'
import { getClient } from '../api/client'

/**
 * Read cache for per-element server data (values, history, relationship walks).
 * A revisited element renders its last result at once while a background fetch
 * revalidates it. Each query key starts with the server it came from, and the
 * cache is cleared whenever the connection changes.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The views offer their own Refresh/Reload; a retry storm against a struggling server helps no one.
      retry: false,
      refetchOnWindowFocus: false,
      gcTime: 5 * 60_000,
    },
  },
})

/** The server half of every query key, so results never cross connections. */
export function serverScope(): readonly [string] {
  return [getClient()?.getBaseUrl() ?? '']
}

export function clearServerQueries(): void {
  void queryClient.cancelQueries()
  queryClient.clear()
}
