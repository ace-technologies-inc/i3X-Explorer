import type { I3XClient } from '../../api/client'
import { bulkRejection, compositionDepth } from '../../api/normalize'
import type { LastKnownValue } from '../../api/types'

export const COMPONENT_LOOKUP_ATTEMPTS = 3

export interface RegisteredItem {
  maxDepth: number
  /** The component ids the server collects under a composition; absent for a plain object. */
  components?: string[]
}

type RegisterClient = Pick<
  I3XClient,
  'registerMonitoredItems' | 'unregisterMonitoredItems' | 'getValue'
>

/**
 * Registers an object on a subscription at its composition depth and, for a composition, reads the
 * component ids the server will deliver, retrying the read. If they still can't be read the
 * registration is undone and this throws: a composition listed without its components would drop
 * their updates without a word.
 */
export async function registerItem(
  client: RegisterClient,
  subscriptionId: string,
  object: { elementId: string; isComposition: boolean },
  knownValue?: LastKnownValue | null,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): Promise<RegisteredItem> {
  const maxDepth = compositionDepth(object.isComposition)
  const rejection = bulkRejection(await client.registerMonitoredItems(subscriptionId, [object.elementId], maxDepth))
  if (rejection) throw rejection
  if (maxDepth === 1) return { maxDepth }

  let composed = knownValue?.components ? knownValue : null
  let lastError: unknown
  for (let attempt = 1; !composed && attempt <= COMPONENT_LOOKUP_ATTEMPTS; attempt++) {
    try {
      composed = await client.getValue(object.elementId, maxDepth)
      if (!composed) lastError = new Error('the server returned no value')
    } catch (err) {
      lastError = err
    }
    if (!composed && attempt < COMPONENT_LOOKUP_ATTEMPTS) await sleep(500 * attempt)
  }

  if (!composed) {
    await client.unregisterMonitoredItems(subscriptionId, [object.elementId], maxDepth).catch(() => undefined)
    const reason = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(`Could not read the components of ${object.elementId}, so it was not subscribed: ${reason}`)
  }
  return {
    maxDepth,
    components: Object.keys(composed.components ?? {}).filter(id => id !== object.elementId),
  }
}
