import { create } from 'zustand'
import type { Namespace, ObjectType, ObjectInstance, RelationshipType } from '../api/types'
import { buildObjectIndexes } from '../api/objectCatalog'
import type { ObjectCatalog } from '../api/objectCatalog'
import { sameJson } from './sameJson'

export type TreeNodeType = 'namespace' | 'objectType' | 'relationshipType' | 'object' | 'folder'

export interface TreeNode {
  id: string
  type: TreeNodeType
  label: string
  data?: Namespace | ObjectType | ObjectInstance | RelationshipType
  children?: TreeNode[]
  isLoading?: boolean
  isExpanded?: boolean
}

export interface SelectedItem {
  type: TreeNodeType
  id: string
  data: Namespace | ObjectType | ObjectInstance | RelationshipType
}

/** The tabs of the element detail view. Part of a history stop, see NavEntry. */
export type DetailTab = 'overview' | 'relationships' | 'history' | 'subtree'

/** A full-panel page that overlays the selection: the two of them, or neither. */
export type MainPage = 'insights' | 'diff' | null

/**
 * One stop in the navigation history: everything the main panel needs to
 * redraw exactly what you were looking at.
 *
 * The stack used to hold bare selections, so Back restored *an element* but not
 * the page you were on: leaving the Subtree tab of an object and coming back
 * landed on its Overview, and the Insights and diff pages weren't history stops
 * at all (they were closed by any navigation and could not be returned to).
 * A stop is therefore a triple, and every one of those is a real navigation:
 * switching tabs pushes, opening a page pushes, closing it pushes.
 */
export interface NavEntry {
  /** null is Home; with a page set it's the page opened from Home. */
  item: SelectedItem | null
  /** Which detail tab was open. Only meaningful when `item` is an object. */
  tab: DetailTab
  /** The full-panel page drawn over the selection, if any. */
  page: MainPage
}

const HOME_ENTRY: NavEntry = { item: null, tab: 'overview', page: null }
export const POLL_OPTIONS: readonly { label: string; ms: number; isDefault?: boolean }[] = [
  { label: 'Refresh every 15 seconds', ms: 15_000 },
  { label: 'Refresh every 30 seconds', ms: 30_000, isDefault: true },
  { label: 'Refresh every 60 seconds', ms: 60_000 },
  { label: 'No automatic refresh', ms: 0 },
]
export const DEFAULT_POLL_INTERVAL_MS = POLL_OPTIONS.find(option => option.isDefault)?.ms ?? POLL_OPTIONS[0].ms
const POLL_INTERVAL_STORAGE_KEY = 'i3x-poll-interval-ms'
const CATALOG_CACHE_STORAGE_KEY = 'i3x-catalog-cache-enabled'

export function normalizePollIntervalMs(value: unknown): number {
  if (typeof value === 'string' && value.trim() === '') return DEFAULT_POLL_INTERVAL_MS
  const interval = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return POLL_OPTIONS.some(option => option.ms === interval) ? interval : DEFAULT_POLL_INTERVAL_MS
}

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The preference remains usable for this session when storage is unavailable.
  }
}

function readPollIntervalMs(): number {
  const saved = readPreference(POLL_INTERVAL_STORAGE_KEY)
  return saved === null ? DEFAULT_POLL_INTERVAL_MS : normalizePollIntervalMs(saved)
}

/** Where the catalog on screen came from: the local cache (while revalidating) or the server. */
export interface CatalogOrigin {
  kind: 'cache' | 'network'
  at: string
}

// Bounded so a long browsing session can't grow the stack without limit.
const MAX_HISTORY = 50

function sameElements<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}

// A parent with more children than this shows the first page plus a
// "Show more" row instead of dumping everything at once. Virtualization keeps
// rendering cheap regardless, this cap is about the *user*: 20k siblings under
// one node bury its siblings and make scrolling past it a chore. One screenful
// at a time is the point, so the page is small; the "Show more" row reveals
// another page, its right-click menu takes a custom number or reveals
// everything. The flat Objects folder is exempt (browsing everything is its
// whole point).
export const CHILD_PAGE_SIZE = 50
// Don't bother truncating for a trivial overflow, a "Show 6 more" row costs
// more attention than the 6 rows it hides.
export const CHILD_PAGE_SLACK = 10

// Hops the Relationships map walks out from the selected element. The default is
// one hop (just the direct relationships); deeper walks are opt-in. The ceiling
// caps the round trips a deep custom walk can fire (one per hop) on a deeply-linked model.
export const MIN_RELATIONSHIP_DEPTH = 1
export const MAX_RELATIONSHIP_DEPTH = 10
export const DEFAULT_RELATIONSHIP_DEPTH = 1

// Hops the Subtree tab walks DOWN from the selected element. Deeper than the
// Relationships default: the tab exists for deeply nested models, and a
// descendants-only walk stays narrow enough to afford the extra round trips.
export const DEFAULT_SUBTREE_DEPTH = 3

// The depth picker shows pills 1..N; "+" reveals one deeper per click, up to the
// ceiling. N lives in the store so the revealed pills persist across element
// selections for the session (the tab is re-mounted per element).
export const INITIAL_RELATIONSHIP_DEPTH_PILLS = 2

// Which way the Relationships map draws the same ego graph: a left-to-right tree
// (default) or the radial rings map. Lives in the store so the choice persists
// across element selections for the session.
export type RelationshipView = 'tree' | 'radial'

// How far the Relationships walk deepens past the root. 'hierarchy' follows only
// composition/child edges down (the I3X maxDepth semantics: depth = containment
// depth), so reference edges off the root show at one hop but never expand.
// 'references' also follows lateral 'other' edges (custom Has* relationship types)
// downward, so context modeled as graph edges deepens with the depth control.
// Never walks back up (parent/inherits) in either mode. Default 'hierarchy' keeps
// the spec-aligned, readable view; references is opt-in for reference-heavy models.
export type RelationshipTraversal = 'hierarchy' | 'references'
export const DEFAULT_RELATIONSHIP_TRAVERSAL: RelationshipTraversal = 'hierarchy'

// Per-map display settings, driven from the gear menu in a relationship map's
// control cluster. They change what the Tree and Rings views draw (not the walk
// itself), so they live in the store and persist across selections like the view
// choice does. All are experimental toggles a user can turn on to see what helps.
//
// leafMode handles the leaf (non-container) nodes that clutter a deep walk:
// 'hide' drops them, 'collapse' drops them but tags each parent with a "+N" of
// how many it hid, 'show' (default) leaves them in.
export type GraphLeafMode = 'show' | 'hide' | 'collapse'

/** One source element with the objects it reaches through a relationship type. */
export interface RelationshipInstance {
  source: ObjectInstance
  targets: ObjectInstance[]
}

/** What /objects/related-by-type returned for one relationship type. */
export interface RelationshipTypeInstances {
  instances: RelationshipInstance[]
  error?: string
  /** Source elements the server reported as failed while the rest loaded. */
  failures?: { elementId: string; message: string }[]
}

/** Tree id of a source row under a relationship type (the type id is encoded so it can't contain ':'). */
export function relationshipSourceRowId(relationshipTypeId: string, sourceId: string): string {
  return `relobj:${encodeURIComponent(relationshipTypeId)}:${sourceId}`
}

export function parseRelationshipSourceRowId(id: string): { relationshipTypeId: string; sourceId: string } | null {
  if (!id.startsWith('relobj:')) return null
  const rest = id.slice('relobj:'.length)
  const sep = rest.indexOf(':')
  if (sep < 0) return null
  return { relationshipTypeId: decodeURIComponent(rest.slice(0, sep)), sourceId: rest.slice(sep + 1) }
}

// A node is only visible once every folder/ancestor above it is expanded, so
// restoring a selection means restoring that path too. Mirrors the expansion
// SearchModal and the main panel perform before they call selectItem.
function expandedPathTo(
  item: SelectedItem,
  expandedNodes: Set<string>,
  objectIndex: Map<string, ObjectInstance>,
  relationshipTypes: RelationshipType[]
): Set<string> {
  const expanded = new Set(expandedNodes)

  if (item.id.startsWith('hier:')) {
    expanded.add('folder:hierarchical')
    const visited = new Set<string>()
    let current = item.data as ObjectInstance
    while (current.parentId && current.parentId !== '/' && !visited.has(current.elementId)) {
      visited.add(current.elementId)
      // O(1) lookup: a per-ancestor scan of allObjects made Back/Forward
      // O(depth × n), which is ~1M comparisons on a 50k catalog.
      const parent = objectIndex.get(current.parentId)
      if (!parent) break
      expanded.add(`hier:${parent.elementId}`)
      current = parent
    }
  } else if (item.id.startsWith('obj:')) {
    // The Objects folder lists every object at the top level, so no ancestor walk.
    expanded.add('folder:objects')
  } else if (item.id.startsWith('ns:')) {
    expanded.add('folder:namespaces')
    } else if (item.id.startsWith('type:')) {
    expanded.add('folder:namespaces')
    expanded.add(`ns:${(item.data as ObjectType).namespaceUri}`)
  } else if (item.id.startsWith('reltype:')) {
    expanded.add('folder:namespaces')
    expanded.add(`ns:${(item.data as RelationshipType).namespaceUri}`)
  } else if (item.id.startsWith('relobj:')) {
    const parsed = parseRelationshipSourceRowId(item.id)
    const relationship = relationshipTypes.find(r => r.elementId === parsed?.relationshipTypeId)
    if (relationship) {
      expanded.add('folder:namespaces')
      expanded.add(`ns:${relationship.namespaceUri}`)
      expanded.add(`reltype:${relationship.elementId}`)
    }
  }

  return expanded
}

interface ExplorerState {
  namespaces: Namespace[]
  objectTypes: ObjectType[]
  relationshipTypes: RelationshipType[]
  objects: Map<string, ObjectInstance[]> // keyed by typeId
  allObjects: ObjectInstance[] // flat list of all objects
  allObjectsLoaded: boolean
  allObjectsFingerprint: string | null
  /** Fingerprint of the catalog whose full objects the catalog engine holds (details, copy, snapshot). */
  catalogDetailsFingerprint: string | null
  catalogOrigin: CatalogOrigin | null
  /** Persisted: keep the last catalog per server locally so reconnects paint instantly. */
  catalogCacheEnabled: boolean
  hierarchicalRoots: ObjectInstance[] // root objects for the Hierarchy folder (from root=true query)
  childObjects: Map<string, ObjectInstance[]> // keyed by parent elementId
  // elementId → count of qualifying compositional children (children where
  // isComposition && parentId === this elementId). Resolved authoritatively
  // via batched POST /objects/related so it never disagrees with the render
  // filter applied at expansion time. Also drives chevron state (count > 0).
  compositionCache: Map<string, number>
  // elementId → its object type, rebuilt once whenever objectTypes changes.
  // Shared by every tree node for icon bucketing so a node never has to build
  // a Map over all object types on its own.
  typeIndex: Map<string, ObjectType>
  // parentId → its direct children, rebuilt once whenever allObjects changes.
  // The hierarchy view looks up children here in O(1) instead of scanning the
  // entire allObjects array (O(n)) on every node.
  childrenByParent: Map<string, ObjectInstance[]>
  // elementId → object, rebuilt once whenever allObjects changes. Ancestor walks
  // (breadcrumb, back/forward, search results) used to call allObjects.find per
  // level, making each walk O(depth × n). With this they are O(depth).
  objectIndex: Map<string, ObjectInstance>
  // elementId → pre-lowercased "name\0elementId\0namespaceUri" blob, rebuilt
  // with allObjects. The tree filter runs per keystroke over the whole catalog;
  // one prebuilt blob turns 3 toLowerCase calls per object per keystroke into a
  // single .includes(). Objects fetched outside allObjects fall back inline.
  searchIndex: Map<string, string>
  // typeId → instance count over allObjects, rebuilt with allObjects so the
  // tree's type rows don't recount the catalog on every rebuild.
  objectCountByType: Map<string, number>
  // typeId → its instances in allObjects; type rows read this instead of fetching once the catalog is loaded.
  catalogObjectsByType: Map<string, ObjectInstance[]>
  expandedNodes: Set<string>
  // Node id → how many children are currently revealed for parents whose child
  // list is paged (see CHILD_PAGE_SIZE). Absent = first page. Infinity = all.
  childPageLimits: Map<string, number>
  selectedItem: SelectedItem | null
  // Which detail tab the current stop is on, and which full-panel page (if any)
  // is drawn over it. Both mirror history[historyIndex]: the history is the
  // source of truth for what the main panel shows, so Back/Forward restore the
  // page you were on and not merely the element.
  detailTab: DetailTab
  activePage: MainPage
  // Visited stops, oldest first; Home is a real one, Back must land on it rather
  // than skip over it, so the stack starts seeded with it and historyIndex is
  // the cursor into it.
  history: NavEntry[]
  historyIndex: number
  isLoading: boolean
  searchQuery: string
  pollIntervalMs: number
  manualRefreshTick: number
  sidebarCollapsed: boolean
  // How many hops the Relationships map walks out from the selected element.
  // Lives here, not in the tab: MainPanel re-keys the detail view per element, so
  // tab-local state would snap back to the default on every selection.
  relationshipDepth: number
  // Highest depth pill the picker currently shows (1..this). "+" bumps it.
  // Shared by the Relationships and Subtree pickers: revealing a deeper pill is
  // a session-level "I go deep here" signal, not a per-tab one.
  relationshipDepthShown: number
  // Which view the Relationships map draws: 'tree' or 'radial'.
  relationshipView: RelationshipView
  // Whether the Relationships walk deepens through reference ('other') edges or
  // only through the composition hierarchy. Persists for the session like the view.
  relationshipTraversal: RelationshipTraversal
  // Per-map display settings (the gear menu). See GraphLeafMode above.
  graphLeafMode: GraphLeafMode
  // Fade nodes/edges the further they sit from the root, so the near
  // neighborhood reads first without hiding anything.
  graphFadeDistant: boolean
  // Order siblings by descendant count (biggest branch first) rather than by
  // relationship bucket then name.
  graphSortBySize: boolean
  // Tint each node by its object type instead of the neutral fill (edges carry
  // the relationship color regardless).
  graphColorByType: boolean
  // How many hops the Subtree tab walks down from the selected element. Same
  // reason as relationshipDepth for living here rather than in the tab.
  subtreeDepth: number
  // Whether the Hierarchy folder also draws non-hierarchical relationships
  // (grouped by relationship type, under each object) alongside its normal
  // parent/child children. A user preference, so it is not cleared by reset().
  showRelationshipsInTree: boolean
  /** Whether HasComponent edges are visible in the Hierarchy folder; kept across reset(). */
  showComponentsInTree: boolean
  // elementId → all related objects, including hierarchy and component edges.
  // Resolved lazily via /objects/related for whatever hierarchy
  // rows are currently visible. Presence of the key means "resolved" (even when
  // the array is empty), mirroring compositionCache's undefined-vs-0 contract.
  relatedObjects: Map<string, ObjectInstance[]>
  /** Parent elementId -> target IDs reached through HasComponent. */
  hierarchyComponents: Map<string, string[]>
  // relationship type elementId → its instances from /objects/related-by-type,
  // loaded when the type's row in the Namespaces folder is expanded.
  relationshipInstances: Map<string, RelationshipTypeInstances>
  /** elementId → why its HasComponent children lookup (the obj: rows) last failed; cleared by the next success. */
  compositionErrors: Map<string, string>
  /** elementId → why its all-relationships lookup (the hier: rows) last failed; cleared by the next success. */
  relationshipErrors: Map<string, string>
  // Tree node ids whose lazily-fetched child list is loading.
  loadingNodes: Set<string>

  setNamespaces: (namespaces: Namespace[]) => void
  setObjectTypes: (types: ObjectType[]) => void
  setRelationshipTypes: (types: RelationshipType[]) => void
  setObjects: (typeId: string, objects: ObjectInstance[]) => void
  setRelationshipInstances: (relationshipTypeId: string, value: RelationshipTypeInstances) => void
  setNodeLoading: (nodeId: string, loading: boolean) => void
  setAllObjects: (objects: ObjectInstance[]) => void
  setAllObjectsCatalog: (catalog: ObjectCatalog) => void
  setHierarchicalRoots: (roots: ObjectInstance[]) => void
  setChildObjects: (parentId: string, children: ObjectInstance[]) => void
  mergeCompositionFlags: (entries: Iterable<[string, number]>) => void
  mergeRelatedObjects: (entries: Iterable<[string, ObjectInstance[]]>) => void
  mergeHierarchyComponents: (entries: Iterable<[string, string[]]>) => void
  /** A message records a failure; null clears it. */
  setCompositionErrors: (entries: Iterable<[string, string | null]>) => void
  setRelationshipErrors: (entries: Iterable<[string, string | null]>) => void
  toggleShowRelationshipsInTree: () => void
  toggleShowComponentsInTree: () => void
  toggleNode: (nodeId: string) => void
  expandNode: (nodeId: string) => void
  collapseNode: (nodeId: string) => void
  raiseChildLimit: (nodeId: string, by: number) => void
  showAllChildren: (nodeId: string) => void
  /**
   * Open an item (or Home, with null). `tab` deep-links the detail view; when
   * omitted a new element opens on Overview and re-selecting the element you
   * are already on keeps the tab you are reading.
   */
  selectItem: (item: SelectedItem | null, tab?: DetailTab) => void
  /** Switch the detail tab. A tab is a page, so this is a navigation stop. */
  setDetailTab: (tab: DetailTab) => void
  /** Show a full-panel page (insights / diff) over the current selection. */
  openPage: (page: Exclude<MainPage, null>) => void
  /** Leave the current page, back to whatever the selection points at. */
  closePage: () => void
  goBack: () => void
  goForward: () => void
  setLoading: (loading: boolean) => void
  setSearchQuery: (query: string) => void
  setPollIntervalMs: (ms: number) => void
  setCatalogCacheEnabled: (enabled: boolean) => void
  triggerManualRefresh: () => void
  toggleSidebar: () => void
  setRelationshipDepth: (depth: number) => void
  revealRelationshipDepth: () => void
  setRelationshipView: (view: RelationshipView) => void
  setRelationshipTraversal: (traversal: RelationshipTraversal) => void
  setGraphLeafMode: (mode: GraphLeafMode) => void
  setGraphFadeDistant: (on: boolean) => void
  setGraphSortBySize: (on: boolean) => void
  setGraphColorByType: (on: boolean) => void
  setSubtreeDepth: (depth: number) => void
  reset: () => void
}

/**
 * Add a stop and move the cursor onto it. Navigating after going back discards
 * the forward entries, like a browser. Everything the main panel reads
 * (selectedItem / detailTab / activePage) is written from the entry, so the
 * three can never drift out of sync with the stack.
 */
function pushEntry(entry: NavEntry) {
  const { history, historyIndex } = useExplorerStore.getState()
  const entries = history.slice(0, historyIndex + 1)
  entries.push(entry)
  const trimmed = entries.length > MAX_HISTORY ? entries.slice(-MAX_HISTORY) : entries
  useExplorerStore.setState({
    selectedItem: entry.item,
    detailTab: entry.tab,
    activePage: entry.page,
    history: trimmed,
    historyIndex: trimmed.length - 1,
  })
}

/** Restore an existing stop without pushing (Back/Forward). */
function gotoIndex(index: number) {
  const { history, expandedNodes, objectIndex, relationshipTypes } = useExplorerStore.getState()
  const target = history[index]
  if (!target) return
  useExplorerStore.setState({
    selectedItem: target.item,
    detailTab: target.tab,
    activePage: target.page,
    historyIndex: index,
    // A null item is Home or a full-panel page: nothing to reveal in the tree.
    expandedNodes: target.item
      ? expandedPathTo(target.item, expandedNodes, objectIndex, relationshipTypes)
      : expandedNodes,
  })
}

/** The map with these failures recorded (message) or cleared (null), or null when nothing changes. */
function applyErrorUpdates(current: Map<string, string>, entries: Iterable<[string, string | null]>): Map<string, string> | null {
  let updated: Map<string, string> | null = null
  for (const [id, message] of entries) {
    if (message === null ? !current.has(id) : current.get(id) === message) continue
    updated ??= new Map(current)
    if (message === null) updated.delete(id)
    else updated.set(id, message)
  }
  return updated
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  namespaces: [],
  objectTypes: [],
  relationshipTypes: [],
  objects: new Map(),
  allObjects: [],
  allObjectsLoaded: false,
  allObjectsFingerprint: null,
  catalogDetailsFingerprint: null,
  catalogOrigin: null,
  catalogCacheEnabled: readPreference(CATALOG_CACHE_STORAGE_KEY) !== 'false',
  hierarchicalRoots: [],
  childObjects: new Map(),
  compositionCache: new Map(),
  typeIndex: new Map(),
  childrenByParent: new Map(),
  objectIndex: new Map(),
  searchIndex: new Map(),
  objectCountByType: new Map(),
  catalogObjectsByType: new Map(),
  expandedNodes: new Set(),
  childPageLimits: new Map(),
  selectedItem: null,
  detailTab: 'overview',
  activePage: null,
  history: [HOME_ENTRY],
  historyIndex: 0,
  isLoading: false,
  searchQuery: '',
  pollIntervalMs: readPollIntervalMs(),
  manualRefreshTick: 0,
  sidebarCollapsed: false,
  relationshipDepth: DEFAULT_RELATIONSHIP_DEPTH,
  relationshipDepthShown: INITIAL_RELATIONSHIP_DEPTH_PILLS,
  relationshipView: 'tree',
  relationshipTraversal: DEFAULT_RELATIONSHIP_TRAVERSAL,
  graphLeafMode: 'show',
  graphFadeDistant: false,
  graphSortBySize: false,
  graphColorByType: false,
  subtreeDepth: DEFAULT_SUBTREE_DEPTH,
  showRelationshipsInTree: false,
  showComponentsInTree: true,
  relatedObjects: new Map(),
  hierarchyComponents: new Map(),
  relationshipInstances: new Map(),
  compositionErrors: new Map(),
  relationshipErrors: new Map(),
  loadingNodes: new Set(),

  // The 30s background poll re-fetches namespaces and types unconditionally
  // and would store a brand-new array every tick even when nothing changed.
  // Downstream memos key on array identity (getInsightsReport recomputes a
  // ~130ms report at 100k objects on any miss), so when the content is
  // byte-identical we keep the old reference and skip the write entirely,
  // no re-render, no recompute. Both lists are small (namespaces a handful,
  // types at most hundreds), so the stringify costs microseconds-to-low-ms
  // once per poll tick, three orders of magnitude under what it saves.
  setNamespaces: (namespaces) => {
    const current = get().namespaces
    if (
      current.length === namespaces.length &&
      JSON.stringify(current) === JSON.stringify(namespaces)
    ) return
    set({ namespaces })
  },
  setObjectTypes: (types) => {
    const current = get().objectTypes
    if (current.length === types.length && JSON.stringify(current) === JSON.stringify(types)) return
    set({
      objectTypes: types,
      typeIndex: new Map(types.map(t => [t.elementId, t])),
    })
  },

  setRelationshipTypes: (types) => {
    const current = get().relationshipTypes
    if (current.length === types.length && JSON.stringify(current) === JSON.stringify(types)) return
    set({ relationshipTypes: types })
  },

  setObjects: (typeId, objects) => {
    const current = get().objects
    if (sameJson(current.get(typeId), objects)) return
    const updated = new Map(current)
    updated.set(typeId, objects)
    set({ objects: updated })
  },

  setRelationshipInstances: (relationshipTypeId, value) => {
    const updated = new Map(get().relationshipInstances)
    updated.set(relationshipTypeId, value)
    set({ relationshipInstances: updated })
  },

  setNodeLoading: (nodeId, loading) => {
    const current = get().loadingNodes
    if (current.has(nodeId) === loading) return
    const updated = new Set(current)
    if (loading) updated.add(nodeId)
    else updated.delete(nodeId)
    set({ loadingNodes: updated })
  },

  setAllObjects: (objects) => {
    // An unchanged poll result must not invalidate every index and memo keyed on these arrays.
    const current = get()
    if (sameJson(current.allObjects, objects)) {
      if (!current.allObjectsLoaded) set({ allObjectsLoaded: true })
      return
    }
    const indexes = buildObjectIndexes(objects)
    set({ allObjects: objects, allObjectsLoaded: true, allObjectsFingerprint: null, ...indexes })
  },
  setAllObjectsCatalog: (catalog) => {
    const current = get()
    if (current.allObjectsFingerprint !== null && current.allObjectsFingerprint === catalog.fingerprint) {
      if (!current.allObjectsLoaded) set({ allObjectsLoaded: true })
      return
    }
    // Only heavy fields changed (the installer reused every light object): keep every memo keyed on these collections.
    if (sameElements(current.allObjects, catalog.objects)) {
      set({ allObjectsLoaded: true, allObjectsFingerprint: catalog.fingerprint })
      return
    }
    set({
      allObjects: catalog.objects,
      allObjectsLoaded: true,
      allObjectsFingerprint: catalog.fingerprint,
      childrenByParent: catalog.childrenByParent,
      objectIndex: catalog.objectIndex,
      searchIndex: catalog.searchIndex,
      objectCountByType: catalog.objectCountByType,
      catalogObjectsByType: catalog.catalogObjectsByType,
    })
  },
  setHierarchicalRoots: (roots) => {
    if (sameElements(get().hierarchicalRoots, roots)) return
    set({ hierarchicalRoots: roots })
  },

  setChildObjects: (parentId, children) => {
    const current = get().childObjects
    if (sameJson(current.get(parentId), children)) return
    const updated = new Map(current)
    updated.set(parentId, children)
    set({ childObjects: updated })
  },

  mergeCompositionFlags: (entries) => {
    const current = get().compositionCache
    let updated: Map<string, number> | null = null
    for (const [id, flag] of entries) {
      if (current.get(id) === flag) continue
      updated ??= new Map(current)
      updated.set(id, flag)
    }
    if (updated) set({ compositionCache: updated })
  },

  mergeRelatedObjects: (entries) => {
    const current = get().relatedObjects
    let updated: Map<string, ObjectInstance[]> | null = null
    for (const [id, objects] of entries) {
      if (current.has(id) && sameJson(current.get(id), objects)) continue
      updated ??= new Map(current)
      updated.set(id, objects)
    }
    if (updated) set({ relatedObjects: updated })
  },

  mergeHierarchyComponents: (entries) => {
    const current = get().hierarchyComponents
    let updated: Map<string, string[]> | null = null
    for (const [id, components] of entries) {
      if (current.has(id) && sameJson(current.get(id), components)) continue
      updated ??= new Map(current)
      updated.set(id, components)
    }
    if (updated) set({ hierarchyComponents: updated })
  },

  setCompositionErrors: (entries) => {
    const updated = applyErrorUpdates(get().compositionErrors, entries)
    if (updated) set({ compositionErrors: updated })
  },

  setRelationshipErrors: (entries) => {
    const updated = applyErrorUpdates(get().relationshipErrors, entries)
    if (updated) set({ relationshipErrors: updated })
  },

  toggleShowRelationshipsInTree: () => set(state => ({ showRelationshipsInTree: !state.showRelationshipsInTree })),
  toggleShowComponentsInTree: () => set(state => ({ showComponentsInTree: !state.showComponentsInTree })),

  toggleNode: (nodeId) => {
    const { expandedNodes, childPageLimits } = get()
    const updated = new Set(expandedNodes)
    if (updated.has(nodeId)) {
      updated.delete(nodeId)
      // Collapsing resets the paging for that parent: re-expanding starts back
      // at the first page rather than a stale multi-thousand-row reveal.
      if (childPageLimits.has(nodeId)) {
        const limits = new Map(childPageLimits)
        limits.delete(nodeId)
        set({ expandedNodes: updated, childPageLimits: limits })
        return
      }
    } else {
      updated.add(nodeId)
    }
    set({ expandedNodes: updated })
  },

  expandNode: (nodeId) => {
    const { expandedNodes } = get()
    const updated = new Set(expandedNodes)
    updated.add(nodeId)
    set({ expandedNodes: updated })
  },

  collapseNode: (nodeId) => {
    const { expandedNodes } = get()
    const updated = new Set(expandedNodes)
    updated.delete(nodeId)
    set({ expandedNodes: updated })
  },

  raiseChildLimit: (nodeId, by) => {
    const limits = new Map(get().childPageLimits)
    limits.set(nodeId, (limits.get(nodeId) ?? CHILD_PAGE_SIZE) + by)
    set({ childPageLimits: limits })
  },

  showAllChildren: (nodeId) => {
    const limits = new Map(get().childPageLimits)
    limits.set(nodeId, Infinity)
    set({ childPageLimits: limits })
  },

  selectItem: (item, tab) => {
    const { history, historyIndex } = get()
    const current = history[historyIndex] ?? HOME_ENTRY
    const sameItem = item === null ? current.item === null : current.item?.id === item.id
    // Re-selecting the element you're already on keeps the tab you're reading,
    // so clicking its tree row again doesn't kick you back to Overview.
    const nextTab = tab ?? (sameItem ? current.tab : 'overview')
    // Re-selecting the current stop must not add a second entry, but still
    // refreshes selectedItem with the newer data. Leaving a full-panel page is
    // a navigation even when the selection underneath is unchanged.
    if (sameItem && nextTab === current.tab && current.page === null) {
      set({ selectedItem: item })
      return
    }
    pushEntry({ item, tab: nextTab, page: null })
  },

  setDetailTab: (tab) => {
    const { history, historyIndex } = get()
    const current = history[historyIndex] ?? HOME_ENTRY
    if (current.tab === tab && current.page === null) return
    pushEntry({ item: current.item, tab, page: null })
  },

  openPage: (page) => {
    const { history, historyIndex } = get()
    const current = history[historyIndex] ?? HOME_ENTRY
    if (current.page === page) return
    // The selection is carried along, so closing the page (or Back) returns to
    // whatever you were looking at before it opened.
    pushEntry({ item: current.item, tab: current.tab, page })
  },

  closePage: () => {
    const { history, historyIndex } = get()
    const current = history[historyIndex] ?? HOME_ENTRY
    if (current.page === null) return
    pushEntry({ item: current.item, tab: current.tab, page: null })
  },

  // goBack/goForward restore a stop directly rather than calling selectItem,
  // which would push it back onto the stack and trap the cursor at the end.
  goBack: () => {
    const { historyIndex } = get()
    if (historyIndex <= 0) return
    gotoIndex(historyIndex - 1)
  },

  goForward: () => {
    const { history, historyIndex } = get()
    if (historyIndex >= history.length - 1) return
    gotoIndex(historyIndex + 1)
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setPollIntervalMs: (value) => {
    const ms = normalizePollIntervalMs(value)
    writePreference(POLL_INTERVAL_STORAGE_KEY, String(ms))
    set({ pollIntervalMs: ms })
  },
  setCatalogCacheEnabled: (enabled) => {
    writePreference(CATALOG_CACHE_STORAGE_KEY, String(enabled))
    set({ catalogCacheEnabled: enabled })
  },
  triggerManualRefresh: () => set(state => ({ manualRefreshTick: state.manualRefreshTick + 1 })),
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setRelationshipDepth: (depth) => set({
    relationshipDepth: Math.max(MIN_RELATIONSHIP_DEPTH, Math.min(MAX_RELATIONSHIP_DEPTH, depth)),
  }),
  revealRelationshipDepth: () => set(state => ({
    relationshipDepthShown: Math.min(MAX_RELATIONSHIP_DEPTH, state.relationshipDepthShown + 1),
  })),
  setRelationshipView: (view) => set({ relationshipView: view }),
  setRelationshipTraversal: (traversal) => set({ relationshipTraversal: traversal }),
  setGraphLeafMode: (mode) => set({ graphLeafMode: mode }),
  setGraphFadeDistant: (on) => set({ graphFadeDistant: on }),
  setGraphSortBySize: (on) => set({ graphSortBySize: on }),
  setGraphColorByType: (on) => set({ graphColorByType: on }),
  setSubtreeDepth: (depth) => set({
    subtreeDepth: Math.max(MIN_RELATIONSHIP_DEPTH, Math.min(MAX_RELATIONSHIP_DEPTH, depth)),
  }),

  reset: () => set({
    namespaces: [],
    objectTypes: [],
    relationshipTypes: [],
    objects: new Map(),
    allObjects: [],
    allObjectsLoaded: false,
    allObjectsFingerprint: null,
    catalogDetailsFingerprint: null,
    catalogOrigin: null,
    hierarchicalRoots: [],
    childObjects: new Map(),
    compositionCache: new Map(),
    typeIndex: new Map(),
    childrenByParent: new Map(),
    objectIndex: new Map(),
    searchIndex: new Map(),
    objectCountByType: new Map(),
    catalogObjectsByType: new Map(),
    expandedNodes: new Set(),
    childPageLimits: new Map(),
    selectedItem: null,
    detailTab: 'overview',
    activePage: null,
    history: [HOME_ENTRY],
    historyIndex: 0,
    isLoading: false,
    searchQuery: '',
    relatedObjects: new Map(),
    hierarchyComponents: new Map(),
    relationshipInstances: new Map(),
    compositionErrors: new Map(),
    relationshipErrors: new Map(),
    loadingNodes: new Set(),
  })
}))
