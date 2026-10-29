/**
 * The relationship color language, carried over from the original
 * RelationshipGraph so the map, the cascade and the legend all read the same.
 *
 * Color encodes the RELATIONSHIP, not the node: amber for the edge up to a
 * parent, green for edges down to children, blue for inheritance, gray for
 * anything else. Dashes separate the structural edges (solid) from the
 * referential ones (dashed).
 *
 * Values are `rgb(var(--i3x-...))` so both themes work; SVG and canvas both
 * accept them (canvas resolves the custom property against the element it is
 * drawn on, so the strings are resolved to literals via getComputedStyle first,
 * see resolveThemeColors).
 */

export type RelationshipBucket = 'parent' | 'child' | 'inherits' | 'other'

const PARENT_TYPES = new Set(['HasParent', 'ComponentOf'])
const CHILD_TYPES = new Set(['HasChildren', 'HasComponent', 'InheritedBy'])

/** First match wins, mirroring the original ternary chain. */
export function bucketOf(relationshipType: string | null | undefined): RelationshipBucket {
  if (!relationshipType) return 'other'
  if (PARENT_TYPES.has(relationshipType)) return 'parent'
  if (CHILD_TYPES.has(relationshipType)) return 'child'
  if (relationshipType === 'InheritsFrom') return 'inherits'
  return 'other'
}

/**
 * Reading order for relationships: the parent first (where this sits), then its
 * children, then inheritance, then everything else. Shared by the walk and the
 * list so a neighbour's position never depends on which one ordered it.
 */
export const BUCKET_ORDER: Record<RelationshipBucket, number> = {
  parent: 0,
  child: 1,
  inherits: 2,
  other: 3,
}

export const BUCKET_COLOR: Record<RelationshipBucket, string> = {
  parent: 'rgb(var(--i3x-warning))',
  child: 'rgb(var(--i3x-success))',
  inherits: 'rgb(var(--i3x-primary))',
  other: 'rgb(var(--i3x-border))',
}

export const BUCKET_LABEL: Record<RelationshipBucket, string> = {
  parent: 'Parent/ComponentOf',
  child: 'Child',
  inherits: 'Inherits',
  other: 'Other',
}

/** Only "other" is dashed; parent, child and inherits are all solid. `null` = solid. */
export const BUCKET_DASH: Record<RelationshipBucket, number[] | null> = {
  parent: null,
  child: null,
  inherits: null,
  other: [5, 5],
}

/** SVG `strokeDasharray` form of BUCKET_DASH. */
export function dashArray(bucket: RelationshipBucket): string | undefined {
  const dash = BUCKET_DASH[bucket]
  return dash ? dash.join(',') : undefined
}

/** Composition nodes are drawn hollow with a dashed border, leaves solid. */
export const COMPOSITION_DASH = [6, 3]

export function nodeFill(isComposition: boolean): string {
  return isComposition ? 'rgb(var(--i3x-bg))' : 'rgb(var(--i3x-surface))'
}

/**
 * Canvas cannot resolve `rgb(var(--x))`; it needs literal colors. Resolve the
 * theme's custom properties against a live element, so a theme switch just
 * re-resolves rather than hard-coding hex anywhere.
 */
export function resolveThemeColor(element: Element, cssColor: string): string {
  const match = /^rgb\(var\((--[a-z0-9-]+)\)\)$/i.exec(cssColor)
  if (!match) return cssColor
  const channels = getComputedStyle(element).getPropertyValue(match[1]).trim()
  return channels ? `rgb(${channels})` : '#888'
}
