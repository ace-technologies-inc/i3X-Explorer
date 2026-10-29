import type { LastKnownValue } from '../../api/types'
import { liveSupersedes, type LiveValue } from '../../stores/subscriptions'

export interface ComposedValue {
  /** The value to show: the HTTP read with every superseding live reading laid over it. */
  value: LastKnownValue | null
  /** The live readings shown in place of fetched ones; empty when the read is current. */
  overlaid: LiveValue[]
  /** Whether the root's own reading is a live one. */
  rootIsLive: boolean
}

/**
 * The current value as the Overview shows it. A live reading replaces the fetched root or
 * component reading it supersedes (by source time, see `liveSupersedes`), and the components the
 * read returned stay listed, so a root update never drops the composition.
 */
export function composeCurrentValue(
  fetched: LastKnownValue | null,
  base: Pick<LastKnownValue, 'elementId' | 'parentId' | 'namespaceUri'>,
  liveOf: (elementId: string) => LiveValue | undefined,
  fetchedAt: number
): ComposedValue {
  const overlaid: LiveValue[] = []
  const root = liveOf(base.elementId)
  const rootIsLive = root !== undefined && liveSupersedes(root, fetched ?? undefined, fetchedAt)
  if (rootIsLive) overlaid.push(root)

  let components = fetched?.components
  if (components) {
    let overlay: NonNullable<LastKnownValue['components']> | undefined
    for (const [elementId, reading] of Object.entries(components)) {
      const entry = liveOf(elementId)
      if (!entry || !liveSupersedes(entry, reading, fetchedAt)) continue
      overlay ??= { ...components }
      overlay[elementId] = {
        value: entry.value,
        quality: entry.quality ?? undefined,
        timestamp: entry.timestamp ?? undefined,
      }
      overlaid.push(entry)
    }
    components = overlay ?? components
  }

  if (overlaid.length === 0) return { value: fetched, overlaid, rootIsLive }
  const start: LastKnownValue = fetched ?? {
    elementId: base.elementId,
    parentId: base.parentId,
    namespaceUri: base.namespaceUri,
    value: root?.value as LastKnownValue['value'],
  }
  return {
    value: {
      ...start,
      ...(rootIsLive
        ? {
            value: root.value as LastKnownValue['value'],
            quality: root.quality ?? undefined,
            timestamp: root.timestamp ?? undefined,
          }
        : {}),
      components,
      // The raw body no longer describes what is shown, so Raw falls back to the composed value.
      rawResponse: undefined,
    },
    overlaid,
    rootIsLive,
  }
}
