/**
 * A one-shot "find this node" request for the relationship map: the search box
 * and the list's focus button issue one, and the active view answers by moving
 * the viewport onto that node (if it is drawn).
 *
 * It is deliberately a *view* request, not a navigation: nothing about the walk,
 * the root or the selection changes, so the map is not re-fetched or re-drawn,
 * it is only looked at from somewhere else.
 */
export interface LocateRequest {
  elementId: string
  /** Monotonic per request, so picking the same element twice zooms twice. */
  token: number
  /**
   * `node` (the default) centres on the one node: what a search pick wants.
   * `subtree` frames the node together with everything under it and holds the
   * branch lit, dimming the rest, which is what "focus" means in the list.
   */
  scope?: 'node' | 'subtree'
}
