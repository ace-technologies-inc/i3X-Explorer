import type { ObjectInstance } from '../../api/types'
import type { DetailTab } from '../../stores/explorer'
import type { MenuEntry } from '../common/ContextMenu'
import { copyText, copyTextFrom } from '../common/clipboard'
import { catalogValueJson } from '../../data/catalogData'
import {
  ClockIcon,
  CollapseAllIcon,
  CopyIcon,
  CubeIcon,
  EllipsisIcon,
  ExpandAllIcon,
  FrameIcon,
  HierarchyIcon,
  TargetIcon,
} from '../common/icons'
import type { EgoTreeGroup, EgoTreeNode } from './egoTree'

/**
 * Right-click menus for the relationship list.
 *
 * Same shape as the tree's (`tree/treeMenu.tsx`): entries are plain data built
 * at open time, so counts are current, while the expensive payloads (branch
 * JSON) are only built if the action is actually chosen.
 *
 * The two ways of "looking at" a row are deliberately separate items, because
 * they do very different amounts of work: **Focus** only moves the viewport over
 * the branch already drawn, while **Root the map here** re-walks from that
 * element (the drag-and-drop gesture in menu form). Opening, the third option,
 * leaves the map entirely and navigates.
 */

const ICON = 13

/**
 * Rows one "expand all below" may open. The list is a browser pane, not a
 * report: past this the useful thing is to root the map on the branch instead
 * of mounting the whole of it in a 340px column.
 */
export const EXPAND_BELOW_CAP = 500

export interface RelationshipMenuActions {
  /** Navigate to the object, optionally straight onto one of its tabs. */
  onOpen: (object: ObjectInstance, tab?: DetailTab) => void
  /** Frame this node and its children on the map. No re-walk, no navigation. */
  onFocus: (object: ObjectInstance) => void
  /** Re-root the walk (and therefore both panes) on this element. */
  onRoot: (object: ObjectInstance) => void
  isOpen: (node: EgoTreeNode) => boolean
  onToggle: (node: EgoTreeNode) => void
  /** Open or close every branch under this node, capped. */
  onSetBranchOpen: (node: EgoTreeNode, open: boolean) => void
  /** Open or close every row of a whole relationship group, capped. */
  onSetGroupOpen: (group: EgoTreeGroup, open: boolean) => void
  /** Reveal every row of a paged block (`elementId`, or `group:<type>`). */
  onShowAll: (blockId: string) => void
  /** Rows of that block currently revealed. */
  shownCount: (blockId: string) => number
}

/** The branch as nested JSON: each node's full object plus its drawn children. */
function branchJson(node: EgoTreeNode): Record<string, unknown> {
  return { ...node.object, children: node.children.map(branchJson) }
}

/** Branches (nodes with children) under `node`, itself included. */
function countBranches(node: EgoTreeNode): number {
  let total = node.children.length > 0 ? 1 : 0
  for (const child of node.children) total += countBranches(child)
  return total
}

export function buildRelationshipNodeMenu(
  node: EgoTreeNode,
  actions: RelationshipMenuActions
): MenuEntry[] {
  const { object } = node
  const expandable = node.children.length > 0
  const open = expandable && actions.isOpen(node)
  const hidden = node.children.length - Math.min(node.children.length, actions.shownCount(object.elementId))
  const branches = countBranches(node)

  const entries: MenuEntry[] = [
    { kind: 'header', label: object.displayName },
    {
      kind: 'action',
      label: 'Open',
      icon: <CubeIcon size={ICON} />,
      onSelect: () => actions.onOpen(object),
    },
    {
      kind: 'action',
      label: 'Open Relationships',
      icon: <TargetIcon size={ICON} />,
      onSelect: () => actions.onOpen(object, 'relationships'),
    },
    {
      kind: 'action',
      label: 'Open Subtree',
      icon: <HierarchyIcon size={ICON} />,
      onSelect: () => actions.onOpen(object, 'subtree'),
    },
    {
      kind: 'action',
      label: 'Open History',
      icon: <ClockIcon size={ICON} />,
      onSelect: () => actions.onOpen(object, 'history'),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Focus on map',
      detail: expandable ? `${(node.descendants + 1).toLocaleString()} objects` : undefined,
      icon: <FrameIcon size={ICON} />,
      onSelect: () => actions.onFocus(object),
    },
    {
      kind: 'action',
      label: 'Root the map here',
      icon: <TargetIcon size={ICON} />,
      onSelect: () => actions.onRoot(object),
    },
  ]

  if (expandable) {
    entries.push(
      { kind: 'separator' },
      {
        kind: 'action',
        label: open ? 'Collapse' : 'Expand',
        detail: `${node.children.length.toLocaleString()} direct`,
        icon: open ? <CollapseAllIcon size={ICON} /> : <ExpandAllIcon size={ICON} />,
        onSelect: () => actions.onToggle(node),
      }
    )
    if (branches > 1) {
      entries.push(
        {
          kind: 'action',
          label:
            branches > EXPAND_BELOW_CAP
              ? `Expand all below (first ${EXPAND_BELOW_CAP.toLocaleString()})`
              : 'Expand all below',
          detail: `${branches.toLocaleString()} branches`,
          icon: <ExpandAllIcon size={ICON} />,
          onSelect: () => actions.onSetBranchOpen(node, true),
        },
        {
          kind: 'action',
          label: 'Collapse all below',
          icon: <CollapseAllIcon size={ICON} />,
          onSelect: () => actions.onSetBranchOpen(node, false),
        }
      )
    }
    // Only while the block is actually on screen: revealing rows inside a
    // collapsed row would look like the action did nothing.
    if (open && hidden > 0) {
      entries.push({
        kind: 'action',
        label: 'Show all children',
        detail: `${hidden.toLocaleString()} hidden`,
        icon: <EllipsisIcon size={ICON} />,
        onSelect: () => actions.onShowAll(object.elementId),
      })
    }
  }

  entries.push(
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Copy name',
      icon: <CopyIcon size={ICON} />,
      onSelect: () => copyText(object.displayName),
    },
    {
      kind: 'action',
      label: 'Copy element ID',
      icon: <CopyIcon size={ICON} />,
      onSelect: () => copyText(object.elementId),
    },
    {
      kind: 'action',
      label: 'Copy type ID',
      icon: <CopyIcon size={ICON} />,
      disabled: !object.typeId,
      onSelect: () => copyText(object.typeId ?? ''),
    },
    {
      kind: 'action',
      label: 'Copy object JSON',
      icon: <CopyIcon size={ICON} />,
      onSelect: () => copyTextFrom(catalogValueJson(object)),
    }
  )

  if (expandable) {
    entries.push({
      kind: 'action',
      // "In the walk", not "in the model": this is the branch as drawn, which is
      // bounded by the depth the map is set to.
      label: 'Copy branch JSON',
      detail: `${(node.descendants + 1).toLocaleString()} in walk`,
      icon: <CopyIcon size={ICON} />,
      onSelect: () => copyTextFrom(catalogValueJson(branchJson(node))),
    })
  }

  return entries
}

export function buildRelationshipGroupMenu(
  group: EgoTreeGroup,
  actions: RelationshipMenuActions
): MenuEntry[] {
  const blockId = `group:${group.type}`
  const hidden = group.items.length - Math.min(group.items.length, actions.shownCount(blockId))
  const expandable = group.items.some(item => item.children.length > 0)

  const entries: MenuEntry[] = [
    { kind: 'header', label: `${group.type} · ${group.items.length.toLocaleString()}` },
  ]

  if (expandable) {
    entries.push(
      {
        kind: 'action',
        label: 'Expand every row',
        icon: <ExpandAllIcon size={ICON} />,
        onSelect: () => actions.onSetGroupOpen(group, true),
      },
      {
        kind: 'action',
        label: 'Collapse every row',
        icon: <CollapseAllIcon size={ICON} />,
        onSelect: () => actions.onSetGroupOpen(group, false),
      }
    )
  }

  if (hidden > 0) {
    entries.push({
      kind: 'action',
      label: 'Show all rows',
      detail: `${hidden.toLocaleString()} hidden`,
      icon: <EllipsisIcon size={ICON} />,
      onSelect: () => actions.onShowAll(blockId),
    })
  }

  entries.push(
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Copy element IDs',
      detail: group.items.length.toLocaleString(),
      icon: <CopyIcon size={ICON} />,
      onSelect: () => copyText(group.items.map(item => item.object.elementId).join('\n')),
    },
    {
      kind: 'action',
      label: 'Copy objects JSON',
      detail: group.items.length.toLocaleString(),
      icon: <CopyIcon size={ICON} />,
      onSelect: () => copyTextFrom(catalogValueJson(group.items.map(item => item.object))),
    },
    {
      kind: 'action',
      label: 'Copy branches JSON',
      icon: <CopyIcon size={ICON} />,
      onSelect: () => copyTextFrom(catalogValueJson(group.items.map(branchJson))),
    }
  )

  return entries
}
