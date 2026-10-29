import {
  useExplorerStore,
  CHILD_PAGE_SIZE,
  type DetailTab,
  type SelectedItem,
} from '../../stores/explorer'
import type { Namespace, ObjectType, ObjectInstance, RelationshipType } from '../../api/types'
import type { MenuEntry } from '../common/ContextMenu'
import { copyJson, copyText, copyTextFrom } from '../common/clipboard'
import { catalogObjectsJson, catalogSubtreeJson, catalogValueJson } from '../../data/catalogData'
import {
  CopyIcon,
  TargetIcon,
  HierarchyIcon,
  ClockIcon,
  CubeIcon,
  GridIcon,
  ExpandAllIcon,
  CollapseAllIcon,
  EllipsisIcon,
} from '../common/icons'
import {
  expandRow,
  getObjectLabel,
  getHierarchyChildren,
  getGraphRelatedObjects,
  OBJECTS_FOLDER_ID,
  NAMESPACES_FOLDER_ID,
  type TreeRow,
  type NodeRow,
} from './treeData'

// "Expand all" stops after this many branches: at that point the flatten and
// the reader are both better served by drilling instead.
const EXPAND_ALL_BRANCH_CAP = 1000

const ICON = 13

/** Iterative subtree survey: total objects and how many of them are branches. */
function surveySubtree(
  roots: ObjectInstance[],
  childrenOf: (elementId: string) => ObjectInstance[]
): { count: number; branches: number } {
  let count = 0
  let branches = 0
  const visited = new Set<string>()
  const stack = [...roots]
  while (stack.length > 0) {
    const obj = stack.pop()!
    if (visited.has(obj.elementId)) continue
    visited.add(obj.elementId)
    count++
    const kids = childrenOf(obj.elementId)
    if (kids.length > 0) {
      branches++
      for (const kid of kids) stack.push(kid)
    }
  }
  return { count, branches }
}

/** Expand every branch under `obj` (Hierarchy view), capped, in one write. */
function expandAllUnder(obj: ObjectInstance) {
  const state = useExplorerStore.getState()
  const { expandedNodes } = state
  const expanded = new Set(expandedNodes)
  const visited = new Set<string>()
  const stack = [obj]
  let branches = 0
  while (stack.length > 0 && branches < EXPAND_ALL_BRANCH_CAP) {
    const current = stack.pop()!
    if (visited.has(current.elementId)) continue
    visited.add(current.elementId)
    const kids = getHierarchyChildren(current.elementId, state).children
    if (kids.length === 0) continue
    expanded.add(`hier:${current.elementId}`)
    branches++
    for (const kid of kids) stack.push(kid)
  }
  useExplorerStore.setState({ expandedNodes: expanded })
}

/** Collapse `obj` and every descendant branch; resets their paging too. */
function collapseSubtreeUnder(obj: ObjectInstance) {
  const state = { ...useExplorerStore.getState(), showComponentsInTree: true }
  const { expandedNodes, childPageLimits } = state
  const expanded = new Set(expandedNodes)
  const limits = new Map(childPageLimits)
  const visited = new Set<string>()
  const stack = [obj]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current.elementId)) continue
    visited.add(current.elementId)
    expanded.delete(`hier:${current.elementId}`)
    limits.delete(`hier:${current.elementId}`)
    for (const kid of getHierarchyChildren(current.elementId, state).children) stack.push(kid)
  }
  useExplorerStore.setState({ expandedNodes: expanded, childPageLimits: limits })
}

function selectRow(row: NodeRow) {
  const { selectItem } = useExplorerStore.getState()
  selectItem({ type: row.nodeType, id: row.id, data: row.data } as SelectedItem)
}

/**
 * Select the row and deep-link the detail view onto a specific tab. The tab is
 * part of the history stop, so Back lands right back on it.
 */
function openRowTab(row: NodeRow, tab: DetailTab) {
  const { selectItem } = useExplorerStore.getState()
  selectItem({ type: row.nodeType, id: row.id, data: row.data } as SelectedItem, tab)
}

function objectEntries(row: NodeRow, revealInHierarchy: (elementId: string) => void): MenuEntry[] {
  const obj = row.data as ObjectInstance
  const state = useExplorerStore.getState()
  const { childrenByParent, objectIndex, expandedNodes } = state
  const isHier = row.id.startsWith('hier:')
  const { count, branches } = surveySubtree([obj], id =>
    isHier ? getHierarchyChildren(id, state).children : childrenByParent.get(id) ?? [])
  const descendants = count - 1

  const entries: MenuEntry[] = [
    { kind: 'header', label: row.label },
    { kind: 'action', label: 'Open', icon: <CubeIcon size={ICON} />, onSelect: () => selectRow(row) },
    { kind: 'action', label: 'Open Relationships', icon: <TargetIcon size={ICON} />, onSelect: () => openRowTab(row, 'relationships') },
    { kind: 'action', label: 'Open Subtree', icon: <HierarchyIcon size={ICON} />, onSelect: () => openRowTab(row, 'subtree') },
    { kind: 'action', label: 'Open History', icon: <ClockIcon size={ICON} />, onSelect: () => openRowTab(row, 'history') },
    { kind: 'separator' },
  ]

  // Structure actions. Expand-all/collapse-subtree only make sense in the
  // Hierarchy view, whose expansion is pure local data; composition ('obj:')
  // nodes fetch children per expand, so bulk-expanding them would fire a
  // request storm.
  if (isHier && descendants > 0) {
    entries.push({
      kind: 'action',
      label: branches > EXPAND_ALL_BRANCH_CAP ? `Expand all (first ${EXPAND_ALL_BRANCH_CAP.toLocaleString()})` : 'Expand all',
      detail: `${branches.toLocaleString()} branches`,
      icon: <ExpandAllIcon size={ICON} />,
      onSelect: () => expandAllUnder(obj),
    })
    if (expandedNodes.has(row.id)) {
      entries.push({
        kind: 'action',
        label: 'Collapse subtree',
        icon: <CollapseAllIcon size={ICON} />,
        onSelect: () => collapseSubtreeUnder(obj),
      })
    }
  }
  // Cross-view reveal: the same object exists in both trees; jump between them.
  if (!isHier && objectIndex.has(obj.elementId)) {
    entries.push({
      kind: 'action',
      label: 'Reveal in Hierarchy',
      icon: <HierarchyIcon size={ICON} />,
      onSelect: () => revealInHierarchy(obj.elementId),
    })
  }
  if (isHier) {
    entries.push({
      kind: 'action',
      label: 'Reveal in Objects',
      icon: <GridIcon size={ICON} />,
      onSelect: () => {
        const { expandedNodes, selectItem } = useExplorerStore.getState()
        const expanded = new Set(expandedNodes)
        expanded.add(OBJECTS_FOLDER_ID)
        useExplorerStore.setState({ expandedNodes: expanded })
        selectItem({ type: 'object', id: `obj:${obj.elementId}`, data: obj })
      },
    })
  }

  entries.push(
    { kind: 'separator' },
    { kind: 'action', label: 'Copy name', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(getObjectLabel(obj)) },
    { kind: 'action', label: 'Copy element ID', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(obj.elementId) },
    { kind: 'action', label: 'Copy object JSON', icon: <CopyIcon size={ICON} />, onSelect: () => copyTextFrom(catalogValueJson(obj)) },
  )
  if (descendants > 0) {
    entries.push({
      kind: 'action',
      label: 'Copy subtree JSON',
      detail: `${count.toLocaleString()} objects`,
      icon: <CopyIcon size={ICON} />,
      onSelect: () => copyTextFrom(catalogSubtreeJson([obj])),
    })
  }
  return entries
}

function typeEntries(row: NodeRow): MenuEntry[] {
  const type = row.data as ObjectType
  const { allObjects } = useExplorerStore.getState()
  const instances = allObjects.filter(o => o.typeId === type.elementId)
  return [
    { kind: 'header', label: row.label },
    { kind: 'action', label: 'Open', icon: <CubeIcon size={ICON} />, onSelect: () => selectRow(row) },
    { kind: 'separator' },
    { kind: 'action', label: 'Copy name', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(type.displayName) },
    { kind: 'action', label: 'Copy element ID', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(type.elementId) },
    { kind: 'action', label: 'Copy type JSON', icon: <CopyIcon size={ICON} />, onSelect: () => copyJson(type) },
    {
      kind: 'action',
      label: 'Copy instances JSON',
      detail: instances.length.toLocaleString(),
      icon: <CopyIcon size={ICON} />,
      disabled: instances.length === 0,
      onSelect: () => copyTextFrom(catalogObjectsJson(instances)),
    },
  ]
}

function relationshipTypeEntries(row: NodeRow): MenuEntry[] {
  const relationshipType = row.data as RelationshipType
  return [
    { kind: 'header', label: row.label },
    { kind: 'action', label: 'Copy name', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(relationshipType.displayName) },
    { kind: 'action', label: 'Copy element ID', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(relationshipType.elementId) },
    { kind: 'action', label: 'Copy inverse', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(relationshipType.reverseOf) },
    { kind: 'action', label: 'Copy relationship type JSON', icon: <CopyIcon size={ICON} />, onSelect: () => copyJson(relationshipType) },
  ]
}

/**
 * Menu for a relationship-type grouping row (nodeType 'relationshipGroup'):
 * not a real element, just Expand/Collapse and copying the group itself.
 */
function relationshipGroupEntries(row: NodeRow): MenuEntry[] {
  const { relatedObjects, hierarchyComponents, expandedNodes } = useExplorerStore.getState()
  const parentId = row.relationshipParentId ?? ''
  const objs = getGraphRelatedObjects(parentId, relatedObjects.get(parentId) ?? [], new Set(hierarchyComponents.get(parentId)))
    .filter(o => (o.sourceRelationship || 'Related') === row.relationshipType)
  return [
    { kind: 'header', label: row.label },
    expandedNodes.has(row.id)
      ? { kind: 'action', label: 'Collapse', icon: <CollapseAllIcon size={ICON} />, onSelect: () => useExplorerStore.getState().collapseNode(row.id) }
      : { kind: 'action', label: 'Expand', icon: <ExpandAllIcon size={ICON} />, onSelect: () => expandRow(row) },
    { kind: 'separator' },
    { kind: 'action', label: 'Copy relationship type', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(row.relationshipType ?? row.label) },
    {
      kind: 'action',
      label: 'Copy related elements JSON',
      detail: objs.length.toLocaleString(),
      icon: <CopyIcon size={ICON} />,
      disabled: objs.length === 0,
      onSelect: () => copyJson(objs),
    },
  ]
}

function namespaceEntries(row: NodeRow): MenuEntry[] {
  const namespace = row.data as Namespace
  const { objectTypes } = useExplorerStore.getState()
  const types = objectTypes.filter(t => t.namespaceUri === namespace.uri)
  return [
    { kind: 'header', label: row.label },
    { kind: 'action', label: 'Open', icon: <CubeIcon size={ICON} />, onSelect: () => selectRow(row) },
    { kind: 'separator' },
    { kind: 'action', label: 'Copy name', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(namespace.displayName) },
    { kind: 'action', label: 'Copy URI', icon: <CopyIcon size={ICON} />, onSelect: () => copyText(namespace.uri) },
    { kind: 'action', label: 'Copy namespace JSON', icon: <CopyIcon size={ICON} />, onSelect: () => copyJson(namespace) },
    {
      kind: 'action',
      label: 'Copy types JSON',
      detail: types.length.toLocaleString(),
      icon: <CopyIcon size={ICON} />,
      disabled: types.length === 0,
      onSelect: () => copyJson(types),
    },
  ]
}

function folderEntries(row: NodeRow): MenuEntry[] {
  const state = useExplorerStore.getState()
  const { namespaces, allObjects, hierarchicalRoots, expandedNodes } = state
  const entries: MenuEntry[] = [
    { kind: 'header', label: row.label },
    row.isExpanded
      ? { kind: 'action', label: 'Collapse', icon: <CollapseAllIcon size={ICON} />, onSelect: () => useExplorerStore.getState().collapseNode(row.id) }
      : { kind: 'action', label: 'Expand', icon: <ExpandAllIcon size={ICON} />, onSelect: () => expandRow(row) },
    {
      kind: 'action',
      label: 'Collapse all',
      icon: <CollapseAllIcon size={ICON} />,
      disabled: expandedNodes.size === 0,
      onSelect: () => useExplorerStore.setState({ expandedNodes: new Set(), childPageLimits: new Map() }),
    },
    { kind: 'separator' },
  ]

  if (row.id === NAMESPACES_FOLDER_ID) {
    entries.push({
      kind: 'action',
      label: 'Copy namespaces JSON',
      detail: namespaces.length.toLocaleString(),
      icon: <CopyIcon size={ICON} />,
      disabled: namespaces.length === 0,
      onSelect: () => copyJson(namespaces),
    })
  } else if (row.id === OBJECTS_FOLDER_ID) {
    entries.push({
      kind: 'action',
      label: 'Copy all objects JSON',
      detail: allObjects.length.toLocaleString(),
      icon: <CopyIcon size={ICON} />,
      disabled: allObjects.length === 0,
      onSelect: () => copyTextFrom(catalogObjectsJson(allObjects)),
    })
  } else {
    const { count } = surveySubtree(hierarchicalRoots, id => getHierarchyChildren(id, state).children)
    entries.push({
      kind: 'action',
      label: 'Copy hierarchy JSON',
      detail: `${count.toLocaleString()} objects`,
      icon: <CopyIcon size={ICON} />,
      disabled: hierarchicalRoots.length === 0,
      onSelect: () => copyTextFrom(catalogSubtreeJson(useExplorerStore.getState().hierarchicalRoots)),
    })
  }
  return entries
}

/**
 * Build the context menu for one tree row. Entries are computed at open time
 * (counts, expansion state) but heavy work, building subtree JSON, happens
 * only when an action is actually clicked. Returns null for rows with no menu.
 *
 * `promptForChildCount` is supplied by TreeView: the "how many?" flow needs a
 * dialog (Electron's renderer has no window.prompt), and dialogs are rendered
 * by the view, not built here.
 */
export function buildTreeMenu(
  row: TreeRow,
  revealInHierarchy: (elementId: string) => void,
  promptForChildCount: (parentId: string, hidden: number) => void
): MenuEntry[] | null {
  if (row.kind === 'marker') return null
  if (row.kind === 'more') {
    const step = Math.min(row.hidden, CHILD_PAGE_SIZE)
    return [
      {
        kind: 'header',
        label: `${row.hidden.toLocaleString()} more ${row.hidden === 1 ? 'child' : 'children'} hidden`,
      },
      {
        kind: 'action',
        label: `Show ${step.toLocaleString()} more`,
        icon: <EllipsisIcon size={ICON} />,
        onSelect: () => useExplorerStore.getState().raiseChildLimit(row.parentId, CHILD_PAGE_SIZE),
      },
      {
        kind: 'action',
        label: 'Show a specific number…',
        icon: <EllipsisIcon size={ICON} />,
        onSelect: () => promptForChildCount(row.parentId, row.hidden),
      },
      {
        kind: 'action',
        label: 'Show all children',
        detail: `${row.hidden.toLocaleString()} hidden`,
        icon: <ExpandAllIcon size={ICON} />,
        onSelect: () => useExplorerStore.getState().showAllChildren(row.parentId),
      },
    ]
  }
  switch (row.nodeType) {
    case 'object': return objectEntries(row, revealInHierarchy)
    case 'objectType': return typeEntries(row)
    case 'relationshipType': return relationshipTypeEntries(row)
    case 'namespace': return namespaceEntries(row)
    case 'folder': return folderEntries(row)
    case 'relationshipGroup': return relationshipGroupEntries(row)
  }
}
