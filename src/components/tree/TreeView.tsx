import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useExplorerStore, CHILD_PAGE_SIZE } from '../../stores/explorer'
import { useConnectionStore } from '../../stores/connection'
import { getClient } from '../../api/client'
import type { ObjectInstance, RelationshipType } from '../../api/types'
import { TreeNode, TreeMoreNode, TreeRowIcon, IndentGuides } from './TreeNode'
import { buildTreeMenu } from './treeMenu'
import { Chevron } from '../common/Chevron'
import { CubeIcon, LinkIcon } from '../common/icons'
import { ContextMenu, type MenuEntry } from '../common/ContextMenu'
import { NumberPromptDialog } from '../common/NumberPromptDialog'
import { useElementNavigation } from '../main/navigation'
import { loadHierarchicalRoots, refreshAllObjects } from '../../services/catalog'
import { traceSpan } from '../../diagnostics/perfTrace'
import {
  buildTreeRows,
  activateRow,
  expandRow,
  resolveCompositionFlags,
  resolveRelationshipGroups,
  loadRelationshipInstances,
  ESTIMATED_ROW_HEIGHT,
  NAMESPACES_FOLDER_ID,
  OBJECTS_FOLDER_ID,
  HIERARCHICAL_FOLDER_ID,
  type TreeRow,
  type NodeRow,
} from './treeData'

const BACKGROUND_POLL_ENABLED = true

// Nearest ancestors pinned at the top of the scroll viewport while you're deep
// inside a large expansion. More than this and the header eats the viewport.
const MAX_STICKY_ROWS = 3

// Type-ahead: keystrokes within this window accumulate into one search buffer.
const TYPE_AHEAD_RESET_MS = 700

/** Next focusable row index from `from` in `dir`; `from` when there is none. */
function stepFocus(rows: TreeRow[], from: number, dir: 1 | -1): number {
  let i = from + dir
  while (i >= 0 && i < rows.length && rows[i].kind === 'marker') i += dir
  return i >= 0 && i < rows.length ? i : from
}

/** Next node row (wrapping) whose label starts with the type-ahead buffer. */
function findTypeAhead(rows: TreeRow[], from: number, buffer: string): number {
  for (let offset = 1; offset <= rows.length; offset++) {
    const i = (from + offset) % rows.length
    const row = rows[i]
    if (row.kind === 'node' && row.label.toLowerCase().startsWith(buffer)) return i
  }
  return -1
}

/**
 * The sidebar tree. The ENTIRE tree, Namespaces, Objects, Hierarchy, is one
 * flattened row array (buildTreeRows) windowed by a single virtualizer, so the
 * DOM holds only the rows near the viewport no matter how many are visible.
 * Huge child lists are additionally paged with "Show more" rows (see
 * CHILD_PAGE_SIZE), a sticky ancestor header keeps context pinned while
 * scrolling deep inside one parent, and the whole thing is keyboard-driven
 * (arrows, Home/End, Enter, type-ahead) per the ARIA tree pattern.
 */
export function TreeView() {
  // Narrow selectors so the tree re-renders only for the slices it uses, not on
  // every unrelated store update (e.g. live subscription values).
  const namespaces = useExplorerStore(s => s.namespaces)
  const objectTypes = useExplorerStore(s => s.objectTypes)
  const relationshipTypes = useExplorerStore(s => s.relationshipTypes)
  const objects = useExplorerStore(s => s.objects)
  const allObjects = useExplorerStore(s => s.allObjects)
  const hierarchicalRoots = useExplorerStore(s => s.hierarchicalRoots)
  const childObjects = useExplorerStore(s => s.childObjects)
  const childrenByParent = useExplorerStore(s => s.childrenByParent)
  const compositionCache = useExplorerStore(s => s.compositionCache)
  const expandedNodes = useExplorerStore(s => s.expandedNodes)
  const childPageLimits = useExplorerStore(s => s.childPageLimits)
  const objectIndex = useExplorerStore(s => s.objectIndex)
  const searchIndex = useExplorerStore(s => s.searchIndex)
  const objectCountByType = useExplorerStore(s => s.objectCountByType)
  const catalogObjectsByType = useExplorerStore(s => s.catalogObjectsByType)
  const searchQuery = useExplorerStore(s => s.searchQuery)
  const setSearchQuery = useExplorerStore(s => s.setSearchQuery)
  const pollIntervalMs = useExplorerStore(s => s.pollIntervalMs)
  const manualRefreshTick = useExplorerStore(s => s.manualRefreshTick)
  const selectedId = useExplorerStore(s => s.selectedItem?.id ?? null)
  const showRelationshipsInTree = useExplorerStore(s => s.showRelationshipsInTree)
  const toggleShowRelationshipsInTree = useExplorerStore(s => s.toggleShowRelationshipsInTree)
  const showComponentsInTree = useExplorerStore(s => s.showComponentsInTree)
  const toggleShowComponentsInTree = useExplorerStore(s => s.toggleShowComponentsInTree)
  const relatedObjects = useExplorerStore(s => s.relatedObjects)
  const hierarchyComponents = useExplorerStore(s => s.hierarchyComponents)
  const relationshipInstances = useExplorerStore(s => s.relationshipInstances)
  const compositionErrors = useExplorerStore(s => s.compositionErrors)
  const relationshipErrors = useExplorerStore(s => s.relationshipErrors)
  const isConnected = useConnectionStore(state => state.isConnected)

  // The input tracks searchQuery directly; the expensive rebuild follows the
  // deferred value, so typing never blocks on filtering a 58k-object catalog.
  const deferredQuery = useDeferredValue(searchQuery)
  const filterText = deferredQuery.toLowerCase()

  // The whole visible tree as one ordered array. Memoized so scroll-driven
  // re-renders reuse it; it rebuilds only when tree data/expansion/filter change.
  const buildInput = useMemo(
    () => ({
      namespaces,
      objectTypes,
      relationshipTypes,
      objectsByType: objects,
      allObjects,
      hierarchicalRoots,
      childObjects,
      childrenByParent,
      compositionCache,
      expandedNodes,
      childPageLimits,
      filterText,
      objectIndex,
      searchIndex,
      objectCountByType,
      catalogObjectsByType,
      showRelationshipsInTree,
      showComponentsInTree,
      relatedObjects,
      hierarchyComponents,
      relationshipInstances,
      compositionErrors,
      relationshipErrors,
    }),
    [namespaces, objectTypes, relationshipTypes, objects, allObjects, hierarchicalRoots,
     childObjects, childrenByParent, compositionCache, expandedNodes,
     childPageLimits, filterText, objectIndex, searchIndex, objectCountByType, catalogObjectsByType,
     showRelationshipsInTree, showComponentsInTree, relatedObjects, relationshipInstances, hierarchyComponents,
     compositionErrors, relationshipErrors]
  )
  const baseRows = useMemo(
    () => traceSpan('tree rows', () => buildTreeRows({ ...buildInput, selectedId: null })),
    [buildInput]
  )
  // The selection only changes the output when its row is paged out, so a
  // plain click doesn't pay for a full rebuild.
  const rows = useMemo(() => {
    if (!selectedId || baseRows.some(r => r.kind === 'node' && r.id === selectedId)) return baseRows
    return traceSpan('tree rows (selection)', () => buildTreeRows({ ...buildInput, selectedId }))
  }, [baseRows, buildInput, selectedId])

  // ── Virtualization ────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT)
  const rowHeightRef = useRef(ESTIMATED_ROW_HEIGHT)

  // A new key function makes the virtualizer re-measure every row (all 223k with
  // the Objects folder open), so it changes only when the rows do.
  const getItemKey = useCallback((index: number) => rows[index].key, [rows])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey,
  })
  // The estimate isn't a measurement input, so a corrected row height has to re-measure explicitly.
  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0

  // Measure the true row height once from the first mounted node row so the
  // spacer math matches the DOM regardless of platform font metrics.
  const measuredRef = useRef(false)
  const measureFirstRow = useCallback((el: HTMLDivElement | null) => {
    if (!el || measuredRef.current) return
    const h = el.getBoundingClientRect().height
    if (h > 0) {
      measuredRef.current = true
      rowHeightRef.current = h
      if (Math.abs(h - rowHeight) > 0.5) setRowHeight(h)
    }
  }, [rowHeight])

  // ── Lazy composition chevrons ─────────────────────────────────────────────
  // Resolve real child counts for the composition ('obj:') rows currently in
  // view, so optimistic chevrons self-correct without resolving the whole
  // catalog at once. Debounced so it fires once scrolling settles.
  useEffect(() => {
    const client = getClient()
    if (!client) return
    const targets: ObjectInstance[] = []
    for (const vi of virtualItems) {
      const row = rows[vi.index]
      if (row.kind !== 'node' || row.nodeType !== 'object' || !row.id.startsWith('obj:')) continue
      const obj = row.data as ObjectInstance
      if (obj.isComposition && !compositionCache.has(obj.elementId) && !compositionErrors.has(obj.elementId)) targets.push(obj)
    }
    if (targets.length === 0) return
    const handle = setTimeout(() => { void resolveCompositionFlags(client, targets) }, 150)
    return () => clearTimeout(handle)
  }, [virtualItems, rows, compositionCache, compositionErrors])

  // ── Lazy relationship resolution ──────────────────────────────────────────
  // Resolve all visible hierarchy objects, including childless ones whose
  // components can belong to a different parentId hierarchy.
  // Include ancestors of visible rows so scrolling into a branch resolves its
  // ordering even when the parent itself is above the virtual window.
  useEffect(() => {
    const client = getClient()
    if (!client) return
    const targets = new Map<string, ObjectInstance>()
    for (const vi of virtualItems) {
      let index = vi.index
      while (index >= 0) {
        const row = rows[index]
        if (row.kind === 'node' && row.nodeType === 'object' && row.id.startsWith('hier:')) {
          const obj = row.data as ObjectInstance
          if ((!relatedObjects.has(obj.elementId) || !hierarchyComponents.has(obj.elementId)) && !relationshipErrors.has(obj.elementId)) {
            targets.set(obj.elementId, obj)
          }
        }
        index = row.parentIndex
      }
    }
    if (targets.size === 0) return
    const handle = setTimeout(() => { void resolveRelationshipGroups(client, [...targets.values()]) }, 150)
    return () => clearTimeout(handle)
  }, [virtualItems, rows, relatedObjects, hierarchyComponents, relationshipErrors])

  // ── Sticky ancestor header ────────────────────────────────────────────────
  // While scrolled deep inside one parent's (possibly enormous) child list, its
  // ancestor chain stays pinned at the top of the viewport, so "where am I" is
  // always answered. Clicking a pinned row jumps back to it.
  const [firstIndex, setFirstIndex] = useState(0)
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const next = Math.max(0, Math.floor(event.currentTarget.scrollTop / rowHeightRef.current))
    setFirstIndex(prev => (prev === next ? prev : next))
    // Rows shift under a fixed-position menu; close it rather than drift.
    setMenu(null)
  }, [])

  const fullAncestors = useCallback((index: number): number[] => {
    const chain: number[] = []
    let p = rows[Math.min(index, rows.length - 1)]?.parentIndex ?? -1
    while (p >= 0) {
      chain.unshift(p)
      p = rows[p].parentIndex
    }
    return chain
  }, [rows])

  const stickyChain = useMemo(() => {
    if (firstIndex <= 0 || rows.length === 0) return [] as number[]
    // Fixed-point: the header occupies rows of its own height, so the chain is
    // computed for the row that ends up visible just below it.
    let chain: number[] = []
    for (let iteration = 0; iteration < 4; iteration++) {
      const next = fullAncestors(firstIndex + chain.length)
      if (next.length === chain.length) { chain = next; break }
      chain = next
    }
    return chain.slice(-MAX_STICKY_ROWS)
  }, [rows, firstIndex, fullAncestors])

  const stickyLenRef = useRef(0)
  stickyLenRef.current = stickyChain.length

  const jumpToRow = useCallback((index: number) => {
    // Land the row just below the sticky rows that will remain above it.
    const pinned = Math.min(fullAncestors(index).length, MAX_STICKY_ROWS)
    virtualizer.scrollToOffset(Math.max(0, (index - pinned) * rowHeightRef.current))
  }, [virtualizer, fullAncestors])

  // ── Context menu ──────────────────────────────────────────────────────────
  // Entries are built at open time (buildTreeMenu) and capture the row's data
  // in closures, so they stay valid even if the row list shifts underneath.
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  // "Show a specific number…" from a "Show more" row's menu. Electron's
  // renderer has no window.prompt, so the count comes from a real dialog.
  const [pagePrompt, setPagePrompt] = useState<{ parentId: string; hidden: number } | null>(null)
  const { selectElement } = useElementNavigation()

  const promptForChildCount = useCallback((parentId: string, hidden: number) => {
    setPagePrompt({ parentId, hidden })
  }, [])

  const openMenuForRow = useCallback((index: number, x: number, y: number) => {
    const row = rows[index]
    if (!row) return
    const entries = buildTreeMenu(row, selectElement, promptForChildCount)
    if (!entries) return
    setFocusedIndex(index)
    setMenu({ x, y, entries })
  }, [rows, selectElement, promptForChildCount])

  const closeMenu = useCallback(() => {
    setMenu(null)
    // Hand focus back to the tree so keyboard navigation resumes seamlessly.
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const handleRowContextMenu = useCallback((index: number) => (event: React.MouseEvent) => {
    event.preventDefault()
    openMenuForRow(index, event.clientX, event.clientY)
  }, [openMenuForRow])

  /** Keyboard path (Shift+F10 / Menu key): anchor the menu to the focused row. */
  const openMenuAtRow = useCallback((index: number) => {
    const scrollEl = scrollRef.current
    if (!scrollEl || !rows[index]) return
    const rect = scrollEl.getBoundingClientRect()
    const h = rowHeightRef.current
    const y = rect.top + (index * h - scrollEl.scrollTop) + h
    const x = rect.left + Math.min(rows[index].depth * 16 + 60, rect.width / 2)
    openMenuForRow(index, x, y)
  }, [rows, openMenuForRow])

  // ── Keyboard navigation (ARIA tree pattern) ───────────────────────────────
  // Roving focus lives on the tree container (aria-activedescendant); arrows
  // move, Left/Right collapse/expand, Enter/Space activate, letters type-ahead.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const typeAheadRef = useRef({ buffer: '', at: 0 })

  const ensureRowVisible = useCallback((index: number) => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const h = rowHeightRef.current
    const top = index * h
    const stickyPx = stickyLenRef.current * h
    if (top < scrollEl.scrollTop + stickyPx) {
      scrollEl.scrollTop = Math.max(0, top - stickyPx)
    } else if (top + h > scrollEl.scrollTop + scrollEl.clientHeight) {
      scrollEl.scrollTop = top + h - scrollEl.clientHeight
    }
  }, [])

  const moveFocus = useCallback((index: number) => {
    if (index < 0 || index >= rows.length) return
    setFocusedIndex(index)
    ensureRowVisible(index)
  }, [rows.length, ensureRowVisible])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return
    // Leave modified keys to the browser/app (shortcuts, devtools, etc.).
    if (event.ctrlKey || event.metaKey || event.altKey) return

    const current = focusedIndex !== null && focusedIndex < rows.length
      ? focusedIndex
      : Math.max(0, rows.findIndex(r => r.kind === 'node' && r.id === selectedId))
    const row = rows[current]

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveFocus(stepFocus(rows, current, 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        moveFocus(stepFocus(rows, current, -1))
        break
      case 'ArrowRight':
        event.preventDefault()
        if (row?.kind !== 'node') break
        if (row.hasChildren && !row.isExpanded) {
          expandRow(row)
          setFocusedIndex(current)
        } else if (row.isExpanded && rows[current + 1]?.parentIndex === current) {
          moveFocus(current + 1)
        }
        break
      case 'ArrowLeft':
        event.preventDefault()
        if (!row) break
        if (row.kind === 'node' && row.hasChildren && row.isExpanded) {
          useExplorerStore.getState().collapseNode(row.id)
          setFocusedIndex(current)
        } else if (row.parentIndex >= 0) {
          moveFocus(row.parentIndex)
        }
        break
      case 'Home':
        event.preventDefault()
        moveFocus(stepFocus(rows, -1, 1))
        break
      case 'End':
        event.preventDefault()
        moveFocus(stepFocus(rows, rows.length, -1))
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (row?.kind === 'node') activateRow(row)
        else if (row?.kind === 'more') {
          useExplorerStore.getState().raiseChildLimit(row.parentId, CHILD_PAGE_SIZE)
        }
        setFocusedIndex(current)
        break
      case 'ContextMenu':
        event.preventDefault()
        openMenuAtRow(current)
        break
      case 'F10':
        if (!event.shiftKey) break
        event.preventDefault()
        openMenuAtRow(current)
        break
      default: {
        // Type-ahead: printable characters jump to the next matching label.
        if (event.key.length !== 1) break
        event.preventDefault()
        const now = performance.now()
        const state = typeAheadRef.current
        state.buffer = now - state.at < TYPE_AHEAD_RESET_MS
          ? state.buffer + event.key.toLowerCase()
          : event.key.toLowerCase()
        state.at = now
        const match = findTypeAhead(rows, current, state.buffer)
        if (match >= 0) moveFocus(match)
      }
    }
  }, [rows, focusedIndex, selectedId, moveFocus, openMenuAtRow])

  // ── Reveal the selected node ──────────────────────────────────────────────
  // Uniform row heights mean every row has a position whether mounted or not,
  // so reveal is pure index math, no DOM probing across tree sections.
  const lastRevealedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedId) return
    // Selection unchanged: data moved, the user didn't. Don't fight their scroll.
    if (lastRevealedRef.current === selectedId) return
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const index = rows.findIndex(r => r.kind === 'node' && r.id === selectedId)
    // Not in the visible forest yet (data loading, ancestor collapsed): leave
    // the ref unset so a later rows change retries.
    if (index === -1) return
    lastRevealedRef.current = selectedId
    setFocusedIndex(index)
    const h = rowHeightRef.current
    const top = index * h
    const viewTop = scrollEl.scrollTop + stickyLenRef.current * h
    if (top >= viewTop && top + h <= scrollEl.scrollTop + scrollEl.clientHeight) return
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [selectedId, rows, virtualizer])

  // ── Expansion entry animation ─────────────────────────────────────────────
  // Track which node most recently expanded; its direct children get a short
  // ease-in when they mount. Scroll-driven mounts never qualify, so scrolling
  // stays animation-free.
  const prevExpandedRef = useRef(expandedNodes)
  const lastExpandRef = useRef<{ id: string; at: number } | null>(null)
  if (prevExpandedRef.current !== expandedNodes) {
    for (const id of expandedNodes) {
      if (!prevExpandedRef.current.has(id)) {
        lastExpandRef.current = { id, at: performance.now() }
        break
      }
    }
    prevExpandedRef.current = expandedNodes
  }
  const expandInfo = lastExpandRef.current
  const animatingExpandId =
    expandInfo && performance.now() - expandInfo.at < 400 ? expandInfo.id : null

  // ── Active indent guide ───────────────────────────────────────────────────
  // The guide column under the selected node is accented for its descendants,
  // so the subtree you're working in reads at a glance.
  const selectedRowIndex = useMemo(
    () => (selectedId ? rows.findIndex(r => r.kind === 'node' && r.id === selectedId) : -1),
    [rows, selectedId]
  )
  const activeGuideFor = useCallback((index: number): number | null => {
    if (selectedRowIndex < 0) return null
    let p = rows[index].parentIndex
    while (p >= 0) {
      if (p === selectedRowIndex) return (rows[selectedRowIndex] as NodeRow).depth
      p = rows[p].parentIndex
    }
    return null
  }, [rows, selectedRowIndex])

  // ── Background refresh ────────────────────────────────────────────────────
  const refreshTree = useCallback(async () => {
    const client = getClient()
    if (!client) return

    const { expandedNodes, relationshipTypes } = useExplorerStore.getState()
    const typeIds: string[] = []
    const compositionIds: string[] = []
    const hierarchyIds: string[] = []
    const relationships: RelationshipType[] = []
    let refreshCatalog = false
    let refreshRoots = false
    const catalogLoaded = useExplorerStore.getState().allObjectsLoaded
    for (const nodeId of expandedNodes) {
      // With the catalog loaded, a type's instances come from it (refreshed off the main thread).
      if (nodeId.startsWith('type:')) {
        if (catalogLoaded) refreshCatalog = true
        else typeIds.push(nodeId.slice('type:'.length))
      }
      // Hierarchy rows merge catalog children with related targets, refreshed below.
      else if (nodeId.startsWith('obj:')) compositionIds.push(nodeId.slice('obj:'.length))
      else if (nodeId.startsWith('hier:')) hierarchyIds.push(nodeId.slice('hier:'.length))
      else if (nodeId.startsWith('reltype:')) {
        const relationship = relationshipTypes.find(r => r.elementId === nodeId.slice('reltype:'.length))
        if (relationship) relationships.push(relationship)
      } else if (nodeId === OBJECTS_FOLDER_ID) refreshCatalog = true
      else if (nodeId === HIERARCHICAL_FOLDER_ID) {
        refreshCatalog = true
        refreshRoots = true
      }
    }

    const logged = <T,>(what: string, request: Promise<T>): Promise<T | null> =>
      request.catch(err => {
        console.error(`Background refresh: ${what} failed`, err)
        return null
      })

    // These write the store themselves; everything below is applied in one batch.
    const selfApplying = Promise.all([
      refreshCatalog ? logged('all objects', refreshAllObjects(client, true)) : null,
      refreshRoots ? logged('root objects', loadHierarchicalRoots(client)) : null,
      ...relationships.map(relationship => loadRelationshipInstances(client, relationship)),
    ])

    const [definitions, typeObjects, related] = await Promise.all([
      logged('namespaces/types', Promise.all([
        client.getNamespaces(),
        client.getObjectTypes(),
        client.getRelationshipTypes(),
      ])),
      Promise.all(typeIds.map(id => logged(`type ${id}`, client.getObjects(id)))),
      Promise.all(compositionIds.map(id => client.getRelatedObjects(id, 'HasComponent').catch((err: unknown) => {
        console.error(`Background refresh: children ${id} failed`, err)
        return err instanceof Error ? err : new Error(String(err))
      }))),
    ])
    const children = related.map((list, i) => list instanceof Error ? null : list.filter(child =>
      child.isComposition &&
      child.elementId !== compositionIds[i] &&
      child.parentId === compositionIds[i]
    ))

    await resolveCompositionFlags(client, [
      ...typeObjects.flatMap(list => list ?? []),
      ...children.flatMap(list => list ?? []),
    ])

    const store = useExplorerStore.getState()
    if (definitions) {
      store.setNamespaces(definitions[0])
      store.setObjectTypes(definitions[1])
      store.setRelationshipTypes(definitions[2])
    }
    typeIds.forEach((id, i) => { const list = typeObjects[i]; if (list) store.setObjects(id, list) })
    compositionIds.forEach((id, i) => { const list = children[i]; if (list) store.setChildObjects(id, list) })
    store.setCompositionErrors(compositionIds.map((id, i) => {
      const result = related[i]
      return [id, result instanceof Error ? result.message : null] as [string, string | null]
    }))

    await selfApplying
    const { objectIndex, relatedObjects } = useExplorerStore.getState()
    const hierarchyObjects = new Map<string, ObjectInstance>()
    const unresolved = new Set(hierarchyIds)
    for (const id of hierarchyIds) {
      const object = objectIndex.get(id)
      if (object) {
        hierarchyObjects.set(id, object)
        unresolved.delete(id)
      }
    }
    if (unresolved.size > 0) {
      for (const targets of relatedObjects.values()) {
        for (const object of targets) {
          if (unresolved.has(object.elementId)) hierarchyObjects.set(object.elementId, object)
        }
      }
    }
    await resolveRelationshipGroups(client, [...hierarchyObjects.values()], true)
  }, [])

  // Background poll on configured interval (0 = disabled)
  useEffect(() => {
    if (!isConnected || !BACKGROUND_POLL_ENABLED || pollIntervalMs === 0) return
    const intervalId = setInterval(refreshTree, pollIntervalMs)
    return () => clearInterval(intervalId)
  }, [isConnected, pollIntervalMs, refreshTree])

  // Manual refresh trigger
  useEffect(() => {
    if (!isConnected || manualRefreshTick === 0) return
    refreshTree()
  }, [manualRefreshTick, isConnected, refreshTree])

  // Auto-expand the three root folders whenever a search query is active so
  // matches are visible without the user having to click each folder open.
  useEffect(() => {
    if (!searchQuery.trim()) return
    const { expandNode } = useExplorerStore.getState()
    expandNode(NAMESPACES_FOLDER_ID)
    expandNode(OBJECTS_FOLDER_ID)
    expandNode(HIERARCHICAL_FOLDER_ID)
  }, [searchQuery])

  const hasNamespaces = namespaces.length > 0
  const firstNodeItem = virtualItems.find(vi => rows[vi.index]?.kind === 'node')

  return (
    <div className="flex flex-col h-full min-h-0 text-i3x-text">
      {/* Filter input, fixed header above the scrolling tree body. The sidebar
          gives the tree its full width edge-to-edge; the input carries its own
          side padding while rows bleed to the panel edges. */}
      <div className="shrink-0 bg-i3x-surface px-2 pb-2 mb-1">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Filter tree…"
          className="w-full px-2 py-1 text-sm bg-i3x-bg border border-i3x-border rounded text-i3x-text placeholder:text-i3x-text-muted focus:outline-none focus:border-i3x-primary"
        />
        {/* Toggles whether the Hierarchy folder also draws each object's
            non-hierarchical relationships (grouped by relationship type,
            in the relationship accent color) alongside its normal children. */}
        <button
          type="button"
          onClick={toggleShowRelationshipsInTree}
          aria-pressed={showRelationshipsInTree}
          title={
            showRelationshipsInTree
              ? 'Hide non-hierarchical relationships in the tree'
              : 'Show non-hierarchical relationships in the tree'
          }
          className={`mt-1.5 flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
            showRelationshipsInTree
              ? 'bg-i3x-relationship/15 text-i3x-relationship'
              : 'text-i3x-text-muted hover:bg-i3x-text/[0.06] hover:text-i3x-text'
          }`}
        >
          <LinkIcon size={13} />
          <span className="flex-1 text-left">Graph Relationships</span>
          <span
            className={`h-3.5 w-6 flex-shrink-0 rounded-full transition-colors ${
              showRelationshipsInTree ? 'bg-i3x-relationship' : 'bg-i3x-border'
            }`}
          >
            <span
              className={`block h-3 w-3 translate-y-px rounded-full bg-i3x-surface transition-transform ${
                showRelationshipsInTree ? 'translate-x-[11px]' : 'translate-x-px'
              }`}
            />
          </span>
        </button>
        <button
          type="button"
          onClick={toggleShowComponentsInTree}
          aria-pressed={showComponentsInTree}
          title={showComponentsInTree ? 'Hide component relationships in the tree' : 'Show component relationships in the tree'}
          className={`mt-1 flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
            showComponentsInTree
              ? 'tree-component-active'
              : 'text-i3x-text-muted hover:bg-i3x-text/[0.06] hover:text-i3x-text'
          }`}
        >
          <CubeIcon size={13} />
          <span className="flex-1 text-left">Component Relationships</span>
          <span
            className={`h-3.5 w-6 flex-shrink-0 rounded-full transition-colors ${
              showComponentsInTree ? 'tree-component-switch' : 'bg-i3x-border'
            }`}
          >
            <span
              className={`block h-3 w-3 translate-y-px rounded-full bg-i3x-surface transition-transform ${
                showComponentsInTree ? 'translate-x-[11px]' : 'translate-x-px'
              }`}
            />
          </span>
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        {/* Sticky ancestor header: pinned to the viewport above the windowed
            rows (right-2 keeps it clear of the vertical scrollbar). */}
        {stickyChain.length > 0 && (
          <div className="absolute top-0 left-0 right-2 z-10 border-b border-i3x-border bg-i3x-surface/95 backdrop-blur-[2px] shadow-sm overflow-hidden">
            {stickyChain.map(index => {
              const row = rows[index] as NodeRow
              return (
                <div
                  key={row.key}
                  onClick={() => jumpToRow(index)}
                  onContextMenu={handleRowContextMenu(index)}
                  title={`Jump to ${row.label}`}
                  style={{ paddingLeft: `${row.depth * 16 + 8}px`, height: rowHeight }}
                  className="flex items-center gap-2 pr-2 cursor-pointer hover:bg-i3x-text/[0.06]"
                >
                  <span className="w-4 flex-shrink-0 flex items-center justify-center">
                    <Chevron open />
                  </span>
                  <span className="flex-shrink-0 flex items-center">
                    <TreeRowIcon row={row} />
                  </span>
                  <span className={`flex-1 min-w-0 text-sm truncate ${row.isComponent ? 'tree-component' : ''}`}>{row.label}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Tree body, vertical scroll only. Rows are exactly the panel width:
            long labels truncate with an ellipsis (full name in the tooltip),
            so the count pills stay pinned at the right edge at any panel
            width, and widening the sidebar reveals more of each name. */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="tree"
          aria-label="Model tree"
          aria-activedescendant={focusedIndex !== null ? `tree-row-${focusedIndex}` : undefined}
          className="h-full overflow-y-auto overflow-x-hidden focus:outline-none pr-1.5"
        >
          <div style={{ paddingTop, paddingBottom }}>
            {virtualItems.map(vi => {
                const row = rows[vi.index]
                const parentRow = row.parentIndex >= 0 ? rows[row.parentIndex] : undefined
                const entering =
                  animatingExpandId !== null &&
                  parentRow?.kind === 'node' &&
                  parentRow.id === animatingExpandId
                const enterDelay = entering
                  ? Math.min(Math.max(vi.index - row.parentIndex - 1, 0), 10) * 14
                  : 0
                const wrapperClass = entering ? 'tree-row-enter' : undefined
                const wrapperStyle = enterDelay > 0 ? { animationDelay: `${enterDelay}ms` } : undefined
                const focused = focusedIndex === vi.index
                const activeGuide = activeGuideFor(vi.index)

                if (row.kind === 'marker') {
                  return (
                    <div key={row.key} className={wrapperClass} style={wrapperStyle}>
                      <div
                        style={{ paddingLeft: `${row.depth * 16 + 8}px`, height: rowHeight }}
                        className="relative flex items-center text-i3x-text-muted text-sm"
                      >
                        <IndentGuides depth={row.depth} active={activeGuide} />
                        {row.message}
                      </div>
                    </div>
                  )
                }
                if (row.kind === 'more') {
                  return (
                    <div
                      key={row.key}
                      id={`tree-row-${vi.index}`}
                      className={wrapperClass}
                      style={wrapperStyle}
                      onClick={() => setFocusedIndex(vi.index)}
                      onContextMenu={handleRowContextMenu(vi.index)}
                    >
                      <TreeMoreNode row={row} height={rowHeight} focused={focused} activeGuide={activeGuide} />
                    </div>
                  )
                }
                const measure = vi.key === firstNodeItem?.key ? measureFirstRow : undefined
                return (
                  <div
                    key={row.key}
                    ref={measure}
                    className={wrapperClass}
                    style={wrapperStyle}
                    onClick={() => setFocusedIndex(vi.index)}
                    onContextMenu={handleRowContextMenu(vi.index)}
                  >
                    <TreeNode
                      row={row}
                      focused={focused}
                      activeGuide={activeGuide}
                      domId={`tree-row-${vi.index}`}
                    />
                  </div>
                )
              })}
          </div>

          {!hasNamespaces && (
            <div className="text-center text-i3x-text-muted text-sm py-4">
              {searchQuery ? 'No results found' : 'Connect to a server to browse'}
            </div>
          )}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={closeMenu} />}

      {pagePrompt && (
        <NumberPromptDialog
          title="Show more children"
          description={`${pagePrompt.hidden.toLocaleString()} ${
            pagePrompt.hidden === 1 ? 'child is' : 'children are'
          } still hidden under this node.`}
          label="How many more to show?"
          initial={Math.min(pagePrompt.hidden, CHILD_PAGE_SIZE * 4)}
          min={1}
          max={pagePrompt.hidden}
          onConfirm={count => {
            useExplorerStore.getState().raiseChildLimit(pagePrompt.parentId, count)
            setPagePrompt(null)
            scrollRef.current?.focus({ preventScroll: true })
          }}
          onCancel={() => {
            setPagePrompt(null)
            scrollRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </div>
  )
}
