import { useCallback, useEffect } from 'react'
import { useExplorerStore, type SelectedItem } from '../../stores/explorer'
import { useConnectionStore } from '../../stores/connection'
import { getClient } from '../../api/client'
import type { Namespace, ObjectType, ObjectInstance } from '../../api/types'

const POLL_INTERVAL_MS = 30_000
const BACKGROUND_POLL_ENABLED = true

// Icons
const FolderIcon = () => <span className="text-i3x-warning">📁</span>
const NamespaceIcon = () => <span className="text-i3x-primary">🌐</span>
const TypeIcon = () => <span className="text-i3x-success">📃</span>
const ObjectIcon = () => <span className="text-i3x-secondary">📦</span>
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
  children?: React.ReactNode
}

function TreeNode({ id, label, type, data, depth, hasChildren, children }: TreeNodeProps) {
  const { expandedNodes, selectedItem, toggleNode, selectItem, setObjects, setAllObjects, setChildObjects } = useExplorerStore()

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
            setAllObjects(objects)
          } catch (err) {
            console.error('Failed to load all objects:', err)
          }
        }
      }

      // Re-fetch all objects when expanding a hierarchy node (picks up newly discovered objects)
      if (id.startsWith('hier:') && !isExpanded) {
        const client = getClient()
        if (client) {
          try {
            const objects = await client.getObjects()
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
              setChildObjects(obj.elementId, compositionalChildren)
            } catch (err) {
              console.error('Failed to load child objects:', err)
            }
          }
        }
      }
    }
  }, [data, type, id, hasChildren, isExpanded, selectItem, toggleNode, setObjects, setAllObjects, setChildObjects])

  const getIcon = () => {
    switch (type) {
      case 'namespace':
        return <NamespaceIcon />
      case 'objectType':
        return <TypeIcon />
      case 'object':
        return <ObjectIcon />
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
      </div>
      {isExpanded && children}
    </div>
  )
}

// Max depth for tree rendering to prevent infinite loops
const MAX_TREE_DEPTH = 20

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
    (state) => state.childObjects.get(obj.elementId) || []
  )
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

  return (
    <TreeNode
      id={`obj:${obj.elementId}`}
      label={getObjectLabel(obj)}
      type="object"
      data={obj}
      depth={depth}
      hasChildren={obj.isComposition}
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
  ancestors = new Set<string>()
}: {
  obj: ObjectInstance
  depth: number
  filterText: string
  allObjects: ObjectInstance[]
  ancestors?: Set<string>
}) {
  // Find children by filtering allObjects where parentId matches this object
  const children = allObjects.filter(child => child.parentId === obj.elementId)
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

  const hasChildren = children.length > 0

  return (
    <TreeNode
      id={`hier:${obj.elementId}`}
      label={getObjectLabel(obj)}
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
          ancestors={childAncestors}
        />
      ))}
    </TreeNode>
  )
}

export function TreeView() {
  const { namespaces, objectTypes, objects, allObjects, searchQuery } = useExplorerStore()
  const isConnected = useConnectionStore(state => state.isConnected)

  // Background poll: re-fetch all currently-expanded tree data every 30s
  useEffect(() => {
    if (!isConnected || !BACKGROUND_POLL_ENABLED) return

    const refreshTree = async () => {
      const client = getClient()
      if (!client) return

      const { expandedNodes, setNamespaces, setObjectTypes, setObjects, setAllObjects, setChildObjects } = useExplorerStore.getState()

      // Refresh top-level namespace/type data
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

      // Refresh each expanded branch
      let allObjectsRefreshed = false
      const refreshedChildIds = new Set<string>()

      for (const nodeId of expandedNodes) {
        if (nodeId.startsWith('type:')) {
          const typeElementId = nodeId.slice(5)
          try {
            const objects = await client.getObjects(typeElementId)
            setObjects(typeElementId, objects)
          } catch (err) {
            console.error('Background refresh: type failed', typeElementId, err)
          }
        }

        if ((nodeId === OBJECTS_FOLDER_ID || nodeId === HIERARCHICAL_FOLDER_ID) && !allObjectsRefreshed) {
          allObjectsRefreshed = true
          try {
            const objects = await client.getObjects()
            setAllObjects(objects)
          } catch (err) {
            console.error('Background refresh: all objects failed', err)
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
              setChildObjects(elementId, compositionalChildren)
            } catch (err) {
              console.error('Background refresh: children failed', elementId, err)
            }
          }
        }
      }
    }

    const intervalId = setInterval(refreshTree, POLL_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [isConnected])

  // Filter based on search
  const filterText = searchQuery.toLowerCase()

  const filteredNamespaces = namespaces.filter(
    (ns) =>
      ns.displayName.toLowerCase().includes(filterText) ||
      ns.uri.toLowerCase().includes(filterText)
  )

  // Group object types by namespace
  const typesByNamespace = new Map<string, ObjectType[]>()
  objectTypes.forEach((type) => {
    if (
      !filterText ||
      type.displayName.toLowerCase().includes(filterText) ||
      type.elementId.toLowerCase().includes(filterText)
    ) {
      const types = typesByNamespace.get(type.namespaceUri) || []
      types.push(type)
      typesByNamespace.set(type.namespaceUri, types)
    }
  })

  // Filter all objects for the Objects folder
  const filteredAllObjects = allObjects.filter(
    (obj) =>
      !filterText ||
      obj.displayName.toLowerCase().includes(filterText) ||
      obj.elementId.toLowerCase().includes(filterText)
  )

  // Find root objects for the Hierarchical folder (parentId === "/")
  const hierarchicalRoots = allObjects.filter(obj => obj.parentId === '/')
  const filteredHierarchicalRoots = hierarchicalRoots.filter(
    (obj) =>
      !filterText ||
      obj.displayName.toLowerCase().includes(filterText) ||
      obj.elementId.toLowerCase().includes(filterText)
  )

  const hasNamespaces = namespaces.length > 0

  return (
    <div className="text-i3x-text">
      {/* Namespaces folder */}
      <TreeNode
        id={NAMESPACES_FOLDER_ID}
        label="Namespaces"
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
              type="namespace"
              data={namespace}
              depth={1}
              hasChildren={hasTypes}
            >
              {nsTypes.map((type) => {
                const typeObjects = objects.get(type.elementId) || []
                const filteredObjects = typeObjects.filter(
                  (obj) =>
                    !filterText ||
                    obj.displayName.toLowerCase().includes(filterText) ||
                    obj.elementId.toLowerCase().includes(filterText)
                )

                return (
                  <TreeNode
                    key={type.elementId}
                    id={`type:${type.elementId}`}
                    label={type.displayName}
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
