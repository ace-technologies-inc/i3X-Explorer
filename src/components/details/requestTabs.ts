import { compositionDepth } from '../../api/normalize'
import {
  describeGetHistory,
  describeGetObject,
  describeGetRelatedObjects,
  describeGetValue,
  type RequestDescriptor,
} from '../../api/requestShape'
import type { ObjectInstance } from '../../api/types'

/** One selectable request shape behind a single trigger, e.g. a relationship filter. */
export interface RequestInspectorVariant {
  id: string
  label: string
  descriptor: RequestDescriptor
}

/**
 * One request kind in the inspector's tab bar. Either a single fixed request
 * (`descriptor`) or a set the reader can switch between in place (`variants`,
 * e.g. the relationship-type filter). Never both.
 */
export interface RequestInspectorTab {
  id: string
  label: string
  descriptor?: RequestDescriptor
  variants?: RequestInspectorVariant[]
  /** Accessible name for the variant picker, e.g. 'Relationship filter'. */
  variantLabel?: string
}

/**
 * The real set of requests an engineer can inspect for one object, built purely
 * from the object and detected version — the same version branching the client
 * itself uses. Every descriptor here is an accurate request shape (no fabricated
 * data); the value depth and the history window mirror the deterministic
 * defaults the detail tabs start from.
 */
export function buildObjectRequestTabs(object: ObjectInstance): RequestInspectorTab[] {
  // Mirror ObjectDetailView.loadValue: composition objects read the whole tree.
  const valueMaxDepth = compositionDepth(object.isComposition)
  // The same one-hour sample window the History tab opens on by default.
  const startTime = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const endTime = new Date().toISOString()

  return [
    {
      id: 'overview',
      label: 'Overview',
      descriptor: describeGetObject(object.elementId),
    },
    {
      id: 'value',
      label: 'Value',
      descriptor: describeGetValue(object.elementId, valueMaxDepth),
    },
    {
      id: 'relationships',
      label: 'Relationships',
      descriptor: describeGetRelatedObjects(object.elementId, undefined),
    },
    {
      id: 'history',
      label: 'History',
      descriptor: describeGetHistory(object.elementId, startTime, endTime, 1),
    },
  ]
}
