import { useCallback, useEffect, useMemo } from 'react'
import { useExplorerStore, type SelectedItem } from '../../stores/explorer'
import { useConnectionStore } from '../../stores/connection'
import { getClient, type I3XClient } from '../../api/client'
import type { Namespace, ObjectType, ObjectInstance } from '../../api/types'

// After loading a layer of objects, decide chevron state for each compositional
// parent by asking the server what /objects/related actually returns — i.e. the
// same data the render filter sees at expansion time. Single batch round trip.
// Awaiting this before committing layer state ensures chevrons render correctly
// on first paint instead of flipping after a follow-up fetch.
async function resolveCompositionFlags(client: I3XClient, loaded: ObjectInstance[]): Promise<void> {
  if (loaded.length === 0) return
  const { compositionCache, mergeCompositionFlags } = useExplorerStore.getState()
  const toResolve: string[] = []
  for (const obj of loaded) {
    if (obj.isComposition && !compositionCache.has(obj.elementId)) {
      toResolve.push(obj.elementId)
    }
  }
  if (toResolve.length === 0) return
  const additions = new Map<string, number>()
  try {
    const related = await client.getRelatedObjectsBatch(toResolve, 'HasComponent')
    for (const parentId of toResolve) {
      const children = related.get(parentId) ?? []
      const qualifyingCount = children.filter(c =>
        c.isComposition && c.elementId !== parentId && c.parentId === parentId
      ).length
      additions.set(parentId, qualifyingCount)
    }
  } catch (err) {
    console.error('Failed to resolve composition flags via /objects/related:', err)
  }
  if (additions.size > 0) mergeCompositionFlags(additions)
}

const BACKGROUND_POLL_ENABLED = true

// Icons
const FolderIcon = () => (
  <span style={{ filter: 'sepia(1) saturate(1.6) hue-rotate(-15deg) brightness(0.89)' }}>🗄️</span>
)
// 📁 emoji renders grey on some macOS configurations; sepia/saturate filter
// forces a manilla tint while keeping the emoji aesthetic of the rest of the
// tree.
const FolderTypeIcon = () => (
  <span style={{ filter: 'sepia(1) saturate(2) hue-rotate(-5deg) brightness(1.05)' }}>📁</span>
)

// Three lowest-common-denominator buckets for object instances that aren't
// FolderType. Driven by OPC UA's nodeClass when available (carried through on
// metadata.system.nodeClass), with a typeId/sourceTypeId keyword fallback.
const ObjectClassIcon = () => <span>📦</span>
const VariableClassIcon = () => <span>📊</span>
const OtherClassIcon = () => <span>⚙️</span>

function bucketInstance(obj: ObjectInstance | undefined): 'object' | 'variable' | 'other' {
  if (!obj) return 'other'
  const sys = (obj.metadata?.system ?? {}) as Record<string, unknown>
  const nodeClass = String(sys.nodeClass ?? '').toLowerCase()
  if (nodeClass.startsWith('object')) return 'object'
  if (nodeClass.startsWith('variable')) return 'variable'
  if (nodeClass) return 'other'
  // Fallback when nodeClass isn't reported: heuristic on typeId / sourceTypeId.
  const t = `${obj.typeId} ${String(obj.metadata?.sourceTypeId ?? '')}`.toLowerCase()
  if (/(variable|tag|datapoint|dataitem|measurement|sensor)/.test(t)) return 'variable'
  if (/(object|device|equipment|asset|machine|component)/.test(t)) return 'object'
  return 'other'
}
const NamespaceIcon = () => <span className="text-i3x-primary">🌐</span>
const TypeIcon = () => <span className="text-i3x-success">📃</span>
const ChevronRight = () => <span className="text-i3x-text-muted">›</span>
const ChevronDown = () => <span className="text-i3x-text-muted">⌄</span>

// Special folder IDs
const NAMESPACES_FOLDER_ID = 'folder:namespaces'
const OBJECTS_FOLDER_ID = 'folder:objects'
const HIERARCHICAL_FOLDER_ID = 'folder:hierarchical'

interface TreeNodeProps {
  id: string
  label: string
  type: 'namespace' | 'objectType' | 'object' | 'folder'
  data?: Namespace | ObjectType | ObjectInstance
  depth: number
  hasChildren?: boolean
  // Optional minimalist count badge rendered to the right of the label —
  // small, muted, no brackets. Only rendered when defined.
  count?: number
  children?: React.ReactNode
}

function TreeNode({ id, label, type, data, depth, hasChildren, count, children }: TreeNodeProps) {
  const { expandedNodes, selectedItem, toggleNode, selectItem, setObjects, setAllObjects, setHierarchicalRoots, setChildObjects } = useExplorerStore()

  const isExpanded = expandedNodes.has(id)
  const isSelected = selectedItem?.id === id

  const handleClick = useCallback(async () => {
    // Select the item
    if (data && type !== 'folder') {
      selectItem({ type, id, data } as SelectedItem)
    }

    // Toggle expansion
    if (hasChildren) {
      toggleNode(id)

      // Re-fetch objects for this type whenever expanding (always fresh)
      if (type === 'objectType' && !isExpanded) {
        const client = getClient()
        if (client) {
          try {
            const objectType = data as ObjectType
            const objects = await client.getObjects(objectType.elementId)
            await resolveCompositionFlags(client, objects)
            setObjects(objectType.elementId, objects)
          } catch (err) {
            console.error('Failed to load objects:', err)
          }
        }
      }

      // Re-fetch all objects whenever expanding Objects or Hierarchy folder (always fresh)
      if ((id === OBJECTS_FOLDER_ID || id === HIERARCHICAL_FOLDER_ID) && !isExpanded) {
        const client = getClient()
        if (client) {
          try {
            const objects = await client.getObjects()
            await resolveCompositionFlags(client, objects)
            setAllObjects(objects)
          } catch (err) {
            console.error('Failed to load all objects:', err)
          }
        }
      }

      // For the Hierarchy folder, also fetch root objects via root=true so the server
      // determines what counts as a root (avoids relying on parentId === '/' locally)
      if (id === HIERARCHICAL_FOLDER_ID && !isExpanded) {
        const client = getClient()
        if (client) {
          try {
            const roots = await client.getObjects(undefined, false, true)
            await resolveCompositionFlags(client, roots)
            setHierarchicalRoots(roots)
          } catch (err) {
            console.error('Failed to load root objects:', err)
          }
        }
      }

      // Re-fetch all objects when expanding a hierarchy node (picks up newly discovered objects)
      if (id.startsWith('hier:') && !isExpanded) {
        const client = getClient()
        if (client) {
          try {
            const objects = await client.getObjects()
            await resolveCompositionFlags(client, objects)
            setAllObjects(objects)
          } catch (err) {
            console.error('Failed to refresh objects for hierarchy node:', err)
          }
        }
      }

      // Re-fetch child objects whenever expanding a compositional object (always fresh)
      if (type === 'object' && !isExpanded && !id.startsWith('hier:')) {
        const obj = data as ObjectInstance
        if (obj.isComposition) {
          const client = getClient()
          if (client) {
            try {
              const related = await client.getRelatedObjects(obj.elementId, 'HasComponent')
              const compositionalChildren = related.filter(child =>
                child.isComposition &&
                child.elementId !== obj.elementId &&
                child.parentId === obj.elementId
              )
              await resolveCompositionFlags(client, compositionalChildren)
              setChildObjects(obj.elementId, compositionalChildren)
            } catch (err) {
              console.error('Failed to load child objects:', err)
            }
          }
        }
      }
    }
  }, [data, type, id, hasChildren, isExpanded, selectItem, toggleNode, setObjects, setAllObjects, setHierarchicalRoots, setChildObjects])

  const getIcon = () => {
    switch (type) {
      case 'namespace':
        return <NamespaceIcon />
      case 'objectType': {
        // ObjectType definitions whose source resolves to OPC UA FolderType
        // render as a folder.
        const t = data as ObjectType | undefined
        const src = (t?.sourceTypeId ?? '').toLowerCase()
        const id = (t?.elementId ?? '').toLowerCase()
        if (src.includes('foldertype') || id.includes('foldertype')) return <FolderTypeIcon />
        return <TypeIcon />
      }
      case 'object': {
        const obj = data as ObjectInstance | undefined
        // FolderType instances always render as a folder.
        const typeId = (obj?.typeId ?? '').toLowerCase()
        const metaSrc = String(obj?.metadata?.sourceTypeId ?? '').toLowerCase()
        if (typeId.includes('foldertype') || metaSrc.includes('foldertype')) {
          return <FolderTypeIcon />
        }
        // Otherwise bucket into one of three lowest-common-denominator classes.
        switch (bucketInstance(obj)) {
          case 'object': return <ObjectClassIcon />
          case 'variable': return <VariableClassIcon />
          default: return <OtherClassIcon />
        }
      }
      case 'folder':
        return <FolderIcon />
    }
  }

  return (
    <div>
      <div
        className={`tree-node ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        {hasChildren && (
          <span className="w-4 flex-shrink-0">
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </span>
        )}
        {!hasChildren && <span className="w-4" />}
        <span className="flex-shrink-0">{getIcon()}</span>
        <span className="truncate text-sm">{label}</span>
        {/* All counts render on the right edge of the row. Leader line is
            solid when the row is expanded (the count is "active"), dashed
            otherwise. */}
        {count !== undefined && (
          <>
            <div
              className={`flex-1 self-center mx-2 h-0 border-t ${
                isExpanded
                  ? 'border-solid border-i3x-text-muted/40'
                  : 'border-dashed border-i3x-text-muted/25'
              }`}
            />
            <span className="pr-2 text-sm text-i3x-text-muted/60 tabular-nums flex-shrink-0">
              {count}
            </span>
          </>
        )}
      </div>
      {isExpanded && children}
    </div>
  )
}

// Max depth for tree rendering to prevent infinite loops
const MAX_TREE_DEPTH = 20

// Chevron predicate: consult the compositionCache, which holds the actual
// child count resolved via batched /objects/related. If we haven't resolved
// this object yet, fall back to its isComposition flag (chevron may show
// momentarily until the resolver lands).
function hasCompositionChildren(obj: ObjectInstance, cache: Map<string, number>): boolean {
  if (!obj.isComposition) return false
  const cached = cache.get(obj.elementId)
  return cached === undefined ? true : cached > 0
}

// Get display label for an object, handling special cases like root "/"
function getObjectLabel(obj: ObjectInstance): string {
  if (obj.displayName && obj.displayName.trim()) {
    return obj.displayName
  }
  // Fallback to elementId for objects with empty displayName (e.g., root "/")
  return obj.elementId
}

// Recursive component for rendering objects with their children
function ObjectNode({
  obj,
  depth,
  filterText,
  ancestors = new Set<string>()
}: {
  obj: ObjectInstance
  depth: number
  filterText: string
  ancestors?: Set<string>
}) {
  // Subscribe only to this object's children, not the entire map
  const children = useExplorerStore(
    (state) => state.childObjects.get(obj.elementId) ?? []
  )
  const compositionCache = useExplorerStore((state) => state.compositionCache)
  const filteredChildren = children.filter(
    (child) =>
      !filterText ||
      child.displayName.toLowerCase().includes(filterText) ||
      child.elementId.toLowerCase().includes(filterText)
  )

  // Prevent infinite recursion - depth limit or cycle detection
  if (depth > MAX_TREE_DEPTH || ancestors.has(obj.elementId)) {
    return (
      <div style={{ paddingLeft: `${depth * 16 + 8}px` }} className="text-i3x-text-muted text-sm">
        {ancestors.has(obj.elementId) ? '(cycle detected)' : '(max depth reached)'}
      </div>
    )
  }

  // Add current object to ancestors for children
  const childAncestors = new Set(ancestors)
  childAncestors.add(obj.elementId)

  // Count: prefer the loaded children array (post-expansion); fall back to the
  // resolver-populated cache for unexpanded compositional objects.
  const cachedCount = compositionCache.get(obj.elementId)
  const childCount = children.length > 0 ? children.length : cachedCount
  return (
    <TreeNode
      id={`obj:${obj.elementId}`}
      label={getObjectLabel(obj)}
      count={childCount && childCount > 0 ? childCount : undefined}
      type="object"
      data={obj}
      depth={depth}
      hasChildren={hasCompositionChildren(obj, compositionCache)}
    >
      {filteredChildren.map((child) => (
        <ObjectNode
          key={child.elementId}
          obj={child}
          depth={depth + 1}
          filterText={filterText}
          ancestors={childAncestors}
        />
      ))}
    </TreeNode>
  )
}

// Recursive component for hierarchical (parent/child) view
// This uses parentId relationships from allObjects rather than API calls
function HierarchicalObjectNode({
  obj,
  depth,
  filterText,
  allObjects,
  visibleIds,
  ancestors = new Set<string>()
}: {
  obj: ObjectInstance
  depth: number
  filterText: string
  allObjects: ObjectInstance[]
  // When filterText is active, set of object IDs that should remain visible
  // (matches + their ancestors). Computed once at the TreeView level.
  visibleIds?: Set<string>
  ancestors?: Set<string>
}) {
  // Find children by filtering allObjects where parentId matches this object
  const children = allObjects.filter(child => child.parentId === obj.elementId)
  const filteredChildren = filterText
    ? children.filter(child => visibleIds?.has(child.elementId))
    : children

  // Prevent infinite recursion - depth limit or cycle detection
  if (depth > MAX_TREE_DEPTH || ancestors.has(obj.elementId)) {
    return (
      <div style={{ paddingLeft: `${depth * 16 + 8}px` }} className="text-i3x-text-muted text-sm">
        {ancestors.has(obj.elementId) ? '(cycle detected)' : '(max depth reached)'}
      </div>
    )
  }

  // Add current object to ancestors for children
  const childAncestors = new Set(ancestors)
  childAncestors.add(obj.elementId)

  const hasChildren = children.length > 0

  return (
    <TreeNode
      id={`hier:${obj.elementId}`}
      label={getObjectLabel(obj)}
      count={children.length > 0 ? children.length : undefined}
      type="object"
      data={obj}
      depth={depth}
      hasChildren={hasChildren}
    >
      {filteredChildren.map((child) => (
        <HierarchicalObjectNode
          key={child.elementId}
          obj={child}
          depth={depth + 1}
          filterText={filterText}
          allObjects={allObjects}
          visibleIds={visibleIds}
          ancestors={childAncestors}
        />
      ))}
    </TreeNode>
  )
}

export function TreeView() {
  const { namespaces, objectTypes, objects, allObjects, hierarchicalRoots, searchQuery, setSearchQuery, pollIntervalMs, manualRefreshTick } = useExplorerStore()
  const isConnected = useConnectionStore(state => state.isConnected)

  const refreshTree = useCallback(async () => {
    const client = getClient()
    if (!client) return

    const { expandedNodes, setNamespaces, setObjectTypes, setObjects, setAllObjects, setHierarchicalRoots, setChildObjects } = useExplorerStore.getState()

    try {
      const [namespaces, objectTypes] = await Promise.all([
        client.getNamespaces(),
        client.getObjectTypes()
      ])
      setNamespaces(namespaces)
      setObjectTypes(objectTypes)
    } catch (err) {
      console.error('Background refresh: namespaces/types failed', err)
    }

    let allObjectsRefreshed = false
    const refreshedChildIds = new Set<string>()

    for (const nodeId of expandedNodes) {
      if (nodeId.startsWith('type:')) {
        const typeElementId = nodeId.slice(5)
        try {
          const objects = await client.getObjects(typeElementId)
          await resolveCompositionFlags(client, objects)
          setObjects(typeElementId, objects)
        } catch (err) {
          console.error('Background refresh: type failed', typeElementId, err)
        }
      }

      if ((nodeId === OBJECTS_FOLDER_ID || nodeId === HIERARCHICAL_FOLDER_ID) && !allObjectsRefreshed) {
        allObjectsRefreshed = true
        try {
          const objects = await client.getObjects()
          await resolveCompositionFlags(client, objects)
          setAllObjects(objects)
        } catch (err) {
          console.error('Background refresh: all objects failed', err)
        }
      }

      if (nodeId === HIERARCHICAL_FOLDER_ID) {
        try {
          const roots = await client.getObjects(undefined, false, true)
          await resolveCompositionFlags(client, roots)
          setHierarchicalRoots(roots)
        } catch (err) {
          console.error('Background refresh: root objects failed', err)
        }
      }

      if (nodeId.startsWith('obj:') || nodeId.startsWith('hier:')) {
        const elementId = nodeId.startsWith('obj:') ? nodeId.slice(4) : nodeId.slice(5)
        if (!refreshedChildIds.has(elementId)) {
          refreshedChildIds.add(elementId)
          try {
            const related = await client.getRelatedObjects(elementId, 'HasComponent')
            const compositionalChildren = related.filter(child =>
              child.isComposition &&
              child.elementId !== elementId &&
              child.parentId === elementId
            )
            await resolveCompositionFlags(client, compositionalChildren)
            setChildObjects(elementId, compositionalChildren)
          } catch (err) {
            console.error('Background refresh: children failed', elementId, err)
          }
        }
      }
    }
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

  // Filter based on search. To make deep matches surface their ancestors,
  // we precompute three sets:
  //   matchingTypeIds: type IDs that have ≥1 matching object (so the type and
  //     its parent namespace stay visible even if their own names don't match)
  //   hierarchyVisibleIds: object IDs to keep in the Hierarchy view —
  //     every match plus every ancestor up the parentId chain
  //   matchedNamespaceUris: namespace URIs reached transitively via matching
  //     types/objects (so a namespace whose name doesn't match still renders
  //     when something inside it does)
  const filterText = searchQuery.toLowerCase()
  const objMatches = (obj: ObjectInstance) =>
    obj.displayName.toLowerCase().includes(filterText) ||
    obj.elementId.toLowerCase().includes(filterText)

  const matchingTypeIds = new Set<string>()
  const hierarchyVisibleIds = new Set<string>()
  const matchedNamespaceUris = new Set<string>()
  if (filterText) {
    const objById = new Map(allObjects.map(o => [o.elementId, o]))
    for (const obj of allObjects) {
      if (!objMatches(obj)) continue
      matchingTypeIds.add(obj.typeId)
      // Walk parents up to the root, marking every ancestor visible
      let cur: ObjectInstance | undefined = obj
      while (cur && !hierarchyVisibleIds.has(cur.elementId)) {
        hierarchyVisibleIds.add(cur.elementId)
        cur = cur.parentId ? objById.get(cur.parentId) : undefined
      }
    }
    // Any type that matches by name OR by descendant pulls its namespace in
    for (const type of objectTypes) {
      const typeMatches =
        type.displayName.toLowerCase().includes(filterText) ||
        type.elementId.toLowerCase().includes(filterText) ||
        matchingTypeIds.has(type.elementId)
      if (typeMatches) matchedNamespaceUris.add(type.namespaceUri)
    }
  }

  const filteredNamespaces = namespaces.filter(ns => {
    if (!filterText) return true
    if (
      ns.displayName.toLowerCase().includes(filterText) ||
      ns.uri.toLowerCase().includes(filterText)
    ) return true
    return matchedNamespaceUris.has(ns.uri)
  })

  // Group object types by namespace; keep types whose name matches OR whose
  // descendant objects match.
  const typesByNamespace = new Map<string, ObjectType[]>()
  objectTypes.forEach((type) => {
    const keep =
      !filterText ||
      type.displayName.toLowerCase().includes(filterText) ||
      type.elementId.toLowerCase().includes(filterText) ||
      matchingTypeIds.has(type.elementId)
    if (keep) {
      const types = typesByNamespace.get(type.namespaceUri) || []
      types.push(type)
      typesByNamespace.set(type.namespaceUri, types)
    }
  })

  // Filter all objects for the Objects folder (flat list — only direct matches)
  const filteredAllObjects = allObjects.filter(obj => !filterText || objMatches(obj))

  const filteredHierarchicalRoots = hierarchicalRoots.filter(
    obj => !filterText || hierarchyVisibleIds.has(obj.elementId)
  )

  const hasNamespaces = namespaces.length > 0

  // Instance count per type, derived from already-loaded allObjects (no extra
  // network). Memoized so the group-by only runs when allObjects changes, not
  // on every keystroke in the filter input. Hierarchy node counts are derived
  // locally from each node's `children` array, so no parent map needed here.
  const objectCountByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of allObjects) m.set(o.typeId, (m.get(o.typeId) ?? 0) + 1)
    return m
  }, [allObjects])

  return (
    <div className="text-i3x-text">
      {/* Filter input */}
      <div className="sticky top-0 z-10 bg-i3x-surface pb-2 mb-1">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Filter tree…"
          className="w-full px-2 py-1 text-sm bg-i3x-bg border border-i3x-border rounded text-i3x-text placeholder:text-i3x-text-muted focus:outline-none focus:border-i3x-primary"
        />
      </div>

      {/* Namespaces folder */}
      <TreeNode
        id={NAMESPACES_FOLDER_ID}
        label="Namespaces"
        count={namespaces.length > 0 ? namespaces.length : undefined}
        type="folder"
        depth={0}
        hasChildren={hasNamespaces}
      >
        {filteredNamespaces.map((namespace) => {
          const nsTypes = typesByNamespace.get(namespace.uri) || []
          const hasTypes = nsTypes.length > 0

          return (
            <TreeNode
              key={namespace.uri}
              id={`ns:${namespace.uri}`}
              label={namespace.displayName}
              count={nsTypes.length > 0 ? nsTypes.length : undefined}
              type="namespace"
              data={namespace}
              depth={1}
              hasChildren={hasTypes}
            >
              {nsTypes.map((type) => {
                const typeObjects = objects.get(type.elementId) ?? []
                const filteredObjects = typeObjects.filter(
                  (obj) =>
                    !filterText ||
                    obj.displayName.toLowerCase().includes(filterText) ||
                    obj.elementId.toLowerCase().includes(filterText)
                )
                const instanceCount = objectCountByType.get(type.elementId)

                return (
                  <TreeNode
                    key={type.elementId}
                    id={`type:${type.elementId}`}
                    label={type.displayName}
                    count={instanceCount && instanceCount > 0 ? instanceCount : undefined}
                    type="objectType"
                    data={type}
                    depth={2}
                    hasChildren={true}
                  >
                    {filteredObjects.map((obj) => (
                      <ObjectNode
                        key={obj.elementId}
                        obj={obj}
                        depth={3}
                        filterText={filterText}
                      />
                    ))}
                  </TreeNode>
                )
              })}
            </TreeNode>
          )
        })}
      </TreeNode>

      {/* Objects folder (flat list) */}
      <TreeNode
        id={OBJECTS_FOLDER_ID}
        label="Objects"
        count={allObjects.length > 0 ? allObjects.length : undefined}
        type="folder"
        depth={0}
        hasChildren={true}
      >
        {filteredAllObjects.map((obj) => (
          <ObjectNode
            key={`all-${obj.elementId}`}
            obj={obj}
            depth={1}
            filterText={filterText}
          />
        ))}
        {allObjects.length > 0 && filteredAllObjects.length === 0 && (
          <div className="text-i3x-text-muted text-sm py-2 pl-8">
            No matching objects
          </div>
        )}
      </TreeNode>

      {/* Hierarchical folder (parent/child structure) */}
      <TreeNode
        id={HIERARCHICAL_FOLDER_ID}
        label="Hierarchy"
        count={hierarchicalRoots.length > 0 ? hierarchicalRoots.length : undefined}
        type="folder"
        depth={0}
        hasChildren={true}
      >
        {filteredHierarchicalRoots.map((obj) => (
          <HierarchicalObjectNode
            key={`hier-${obj.elementId}`}
            obj={obj}
            depth={1}
            filterText={filterText}
            allObjects={allObjects}
            visibleIds={hierarchyVisibleIds}
          />
        ))}
        {allObjects.length > 0 && filteredHierarchicalRoots.length === 0 && (
          <div className="text-i3x-text-muted text-sm py-2 pl-8">
            {filterText ? 'No matching objects' : 'No root objects found'}
          </div>
        )}
      </TreeNode>

      {!hasNamespaces && (
        <div className="text-center text-i3x-text-muted text-sm py-4">
          {searchQuery ? 'No results found' : 'Connect to a server to browse'}
        </div>
      )}
    </div>
  )
}
