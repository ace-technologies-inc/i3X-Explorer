import { useCallback } from 'react'
import { useExplorerStore, type DetailTab } from '../../stores/explorer'
import type { ObjectInstance } from '../../api/types'

/**
 * Navigation contract for the main content panel.
 *
 * The panel never imports or reaches into the tree, both drive the same
 * `selectItem` / `selectedItem` state in the explorer store, so the tree can
 * highlight whatever the panel (or, later, the graphs) selected, and vice versa.
 *
 *   selectElement(elementId): open an object in the detail view
 *   showHome(): clear the selection, landing on the Home shell
 */
export interface ElementNavigation {
  /** `tab` deep-links the detail view; omitted, a new element opens on Overview. */
  selectElement: (elementId: string, tab?: DetailTab) => void
  /**
   * Navigate to an object we already hold in full, e.g. a related object just
   * fetched from POST /objects/related, which may not be in the store's flat
   * list. Unlike selectElement this never no-ops for want of a store entry.
   */
  selectObject: (object: ObjectInstance, tab?: DetailTab) => void
  /**
   * Open an object type. The overview's type bars use this: "1,204 Sensors" is
   * only useful if it's also the way to go look at them.
   */
  selectType: (typeId: string) => void
  showHome: () => void
}

/** Walk `parentId` up to the root. Returns ancestors root-first, excluding `object`. */
export function buildAncestorChain(
  object: ObjectInstance,
  objectIndex: Map<string, ObjectInstance>
): ObjectInstance[] {
  const chain: ObjectInstance[] = []
  const visited = new Set<string>([object.elementId])
  let current = object

  while (current.parentId && current.parentId !== '/' && !visited.has(current.parentId)) {
    // O(1) index lookup: a per-ancestor allObjects.find made each walk
    // O(depth × n), ~1M comparisons on a 50k catalog.
    const parent = objectIndex.get(current.parentId)
    if (!parent) break
    visited.add(parent.elementId)
    chain.unshift(parent)
    current = parent
  }

  return chain
}

export function useElementNavigation(): ElementNavigation {
  const selectElement = useCallback((elementId: string, tab?: DetailTab) => {
    // Store-only resolution. This PR is presentational: if the object isn't
    // already in the store we no-op rather than fetching it.
    const { objectIndex, expandedNodes, selectItem } = useExplorerStore.getState()
    const target = objectIndex.get(elementId)
    if (!target) return

    // Expand the whole ancestor path in one write before selecting, so the tree
    // doesn't re-render once per ancestor. Mirrors SearchModal.
    const expanded = new Set(expandedNodes)
    expanded.add('folder:hierarchical')
    for (const ancestor of buildAncestorChain(target, objectIndex)) {
      expanded.add(`hier:${ancestor.elementId}`)
    }

    useExplorerStore.setState({ expandedNodes: expanded })
    selectItem({ type: 'object', id: `hier:${target.elementId}`, data: target }, tab)
  }, [])

  const selectObject = useCallback((object: ObjectInstance, tab?: DetailTab) => {
    // Prefer the store's copy (kept in sync by the poll); fall back to the object
    // we were handed. Ancestor expansion walks whatever the store knows.
    const { objectIndex, expandedNodes, selectItem } = useExplorerStore.getState()
    const target = objectIndex.get(object.elementId) ?? object

    const expanded = new Set(expandedNodes)
    expanded.add('folder:hierarchical')
    for (const ancestor of buildAncestorChain(target, objectIndex)) {
      expanded.add(`hier:${ancestor.elementId}`)
    }

    useExplorerStore.setState({ expandedNodes: expanded })
    selectItem({ type: 'object', id: `hier:${target.elementId}`, data: target }, tab)
  }, [])

  const selectType = useCallback((typeId: string) => {
    const { objectTypes, expandedNodes, selectItem } = useExplorerStore.getState()
    const target = objectTypes.find(type => type.elementId === typeId)
    if (!target) return

    // A type lives under its namespace in the tree, so open that path too.
    const expanded = new Set(expandedNodes)
    expanded.add('folder:namespaces')
    expanded.add(`ns:${target.namespaceUri}`)

    useExplorerStore.setState({ expandedNodes: expanded })
    selectItem({ type: 'objectType', id: `type:${target.elementId}`, data: target })
  }, [])

  const showHome = useCallback(() => {
    useExplorerStore.getState().selectItem(null)
  }, [])

  return { selectElement, selectObject, selectType, showHome }
}
