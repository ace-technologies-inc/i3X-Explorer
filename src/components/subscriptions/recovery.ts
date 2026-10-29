import type { I3XClient } from '../../api/client'
import { groupByDepth, useSubscriptionsStore } from '../../stores/subscriptions'

/**
 * Server-side subscription expiry recovery, extracted from the transport
 * provider so the concurrency rules are unit-testable.
 *
 * The old inline version had three compounding faults: nothing stopped the 2s
 * poller during recovery (so its 404s re-entered recovery up to the attempt
 * cap, concurrently), only the first entrant saw the monitored items (later
 * ones read an already-emptied store and created empty subscriptions, the last
 * of which won as active), and the attempt counter only reset on data delivery
 * (an empty active subscription delivers nothing, so recovery jammed at the
 * cap for the rest of the session).
 */

export const MAX_RECOVERY_ATTEMPTS = 3

/**
 * A success only refunds the attempt budget when the *previous* success is
 * older than this. A server that expires each new subscription within seconds
 * must converge to the cap instead of cycling create/expire forever.
 */
export const RECOVERY_RESET_WINDOW_MS = 30_000

/** Lives in a ref in the provider; mutated in place across incidents. */
export interface RecoveryHarness {
  isRecovering: boolean
  attempts: number
  lastSuccessAt: number
}

export interface RecoveryDeps {
  client: Pick<I3XClient, 'createSubscription' | 'deleteSubscription' | 'registerMonitoredItems'>
  /** Tear down BOTH transports (SSE and poller), the re-entry source. */
  stopTransports: () => void
  startStream: (subscriptionId: string) => Promise<void>
  harness: RecoveryHarness
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Returns true when a replacement subscription is streaming again. */
export async function performRecovery(
  oldSubscriptionId: string,
  deps: RecoveryDeps
): Promise<boolean> {
  const { client, stopTransports, startStream, harness } = deps
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))

  if (harness.isRecovering) return false
  harness.isRecovering = true
  try {
    stopTransports()

    // Capture the monitored items synchronously, before any await gives a
    // concurrent caller (or the store mutations below) a chance to empty them.
    const store = useSubscriptionsStore.getState()
    const previous = store.subscriptions.get(oldSubscriptionId)
    const monitoredItems = previous?.monitoredItems ?? []
    const monitoredDepth = previous?.monitoredDepth
    const components = previous?.components
    const stoppedItems = previous?.stoppedItems
    // The items carry over, so their values and trends stay on screen.
    store.removeSubscription(oldSubscriptionId, { keepValues: true })
    // Best-effort: the server-side subscription is likely already gone
    // (404/410), but this clears the clientId entry from the client-side map.
    try { await client.deleteSubscription(oldSubscriptionId) } catch { /* already gone */ }

    while (harness.attempts < MAX_RECOVERY_ATTEMPTS) {
      harness.attempts++
      console.warn(`Subscription ${oldSubscriptionId} expired on server, recovering (attempt ${harness.attempts})...`)
      try {
        const { subscriptionId: newId } = await client.createSubscription()
        const running = monitoredItems.filter(id => !stoppedItems?.includes(id))
        const rejected: string[] = []
        for (const [depth, elementIds] of groupByDepth({ monitoredDepth }, running)) {
          const outcome = await client.registerMonitoredItems(newId, elementIds, depth)
          rejected.push(...outcome.rejected.map(({ elementId }) => elementId))
        }
        if (rejected.length > 0) {
          console.warn(`Subscription ${newId} did not accept ${rejected.join(', ')}; listed as stopped`)
        }
        useSubscriptionsStore.getState().addSubscription({
          id: newId,
          createdAt: new Date().toISOString(),
          monitoredItems,
          isStreaming: false,
          monitoredDepth,
          components,
          stoppedItems: [...(stoppedItems ?? []), ...rejected],
        })
        useSubscriptionsStore.getState().setActiveSubscription(newId)
        await startStream(newId)
        if (now() - harness.lastSuccessAt > RECOVERY_RESET_WINDOW_MS) {
          harness.attempts = 0
        }
        harness.lastSuccessAt = now()
        return true
      } catch (err) {
        console.error(`Subscription recovery attempt ${harness.attempts} failed:`, err)
        await sleep(1000 * harness.attempts)
      }
    }
    console.warn(`Subscription ${oldSubscriptionId} recovery aborted after ${MAX_RECOVERY_ATTEMPTS} attempts`)
    return false
  } finally {
    harness.isRecovering = false
  }
}
