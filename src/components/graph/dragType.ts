/**
 * The MIME a dragged relationship row carries, and the handle the graph drop
 * target looks for. Lives in its own module so both graph views and the list can
 * share it without an import cycle.
 */
export const ELEMENT_DRAG_TYPE = 'application/x-i3x-element-id'
