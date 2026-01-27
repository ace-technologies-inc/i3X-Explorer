import { create } from 'zustand'
import type { Namespace, ObjectType, ObjectInstance } from '../api/types'

export type TreeNodeType = 'namespace' | 'objectType' | 'object' | 'folder'

export interface TreeNode {
  id: string
  type: TreeNodeType
  label: string
  data?: Namespace | ObjectType | ObjectInstance
  children?: TreeNode[]
  isLoading?: boolean
  isExpanded?: boolean
}

export interface SelectedItem {
  type: TreeNodeType
  id: string
  data: Namespace | ObjectType | ObjectInstance
}

interface ExplorerState {
  namespaces: Namespace[]
  objectTypes: ObjectType[]
  objects: Map<string, ObjectInstance[]> // keyed by typeId
  allObjects: ObjectInstance[] // flat list of all objects
  childObjects: Map<string, ObjectInstance[]> // keyed by parent elementId
  expandedNodes: Set<string>
  selectedItem: SelectedItem | null
  isLoading: boolean
  searchQuery: string

  setNamespaces: (namespaces: Namespace[]) => void
  setObjectTypes: (types: ObjectType[]) => void
  setObjects: (typeId: string, objects: ObjectInstance[]) => void
  setAllObjects: (objects: ObjectInstance[]) => void
  setChildObjects: (parentId: string, children: ObjectInstance[]) => void
  toggleNode: (nodeId: string) => void
  expandNode: (nodeId: string) => void
  collapseNode: (nodeId: string) => void
  selectItem: (item: SelectedItem | null) => void
  setLoading: (loading: boolean) => void
  setSearchQuery: (query: string) => void
  reset: () => void
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  namespaces: [],
  objectTypes: [],
  objects: new Map(),
  allObjects: [],
  childObjects: new Map(),
  expandedNodes: new Set(),
  selectedItem: null,
  isLoading: false,
  searchQuery: '',

  setNamespaces: (namespaces) => set({ namespaces }),
  setObjectTypes: (types) => set({ objectTypes: types }),

  setObjects: (typeId, objects) => {
    const current = get().objects
    const updated = new Map(current)
    updated.set(typeId, objects)
    set({ objects: updated })
  },

  setAllObjects: (objects) => set({ allObjects: objects }),

  setChildObjects: (parentId, children) => {
    const current = get().childObjects
    const updated = new Map(current)
    updated.set(parentId, children)
    set({ childObjects: updated })
  },

  toggleNode: (nodeId) => {
    const { expandedNodes } = get()
    const updated = new Set(expandedNodes)
    if (updated.has(nodeId)) {
      updated.delete(nodeId)
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

  selectItem: (item) => set({ selectedItem: item }),
  setLoading: (loading) => set({ isLoading: loading }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  reset: () => set({
    namespaces: [],
    objectTypes: [],
    objects: new Map(),
    allObjects: [],
    childObjects: new Map(),
    expandedNodes: new Set(),
    selectedItem: null,
    isLoading: false,
    searchQuery: ''
  })
}))
