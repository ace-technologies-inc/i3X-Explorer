import { memo, useState } from 'react'
import { useExplorerStore, CHILD_PAGE_SIZE } from '../../stores/explorer'
import type { Namespace, ObjectType, ObjectInstance } from '../../api/types'
import { Chevron } from '../common/Chevron'
import { Spinner } from '../common/Spinner'
import {
  LayersIcon,
  GridIcon,
  HierarchyIcon,
  GlobeIcon,
  FileTextIcon,
  FolderIcon,
  CubeIcon,
  ActivityIcon,
  LinkIcon,
  EllipsisIcon,
  CopyIcon,
  CheckIcon,
} from '../common/icons'
import {
  activateRow,
  isScalarSchemaType,
  OBJECTS_FOLDER_ID,
  HIERARCHICAL_FOLDER_ID,
} from './treeData'
import type { NodeRow, MoreRow } from './treeData'

const ICON_SIZE = 15

/**
 * The icon for one tree row. All SVG (see common/icons.tsx): shape carries the
 * entity kind, color reinforces it. The three root folders get distinct shapes
 * so the top level reads at a glance; object instances bucket into folder /
 * variable / object off the same signals the old emoji buckets used
 * (FolderType, then schema.type scalar = leaf variable, else branch object).
 */
export function TreeRowIcon({ row }: { row: NodeRow }) {
  const typeIndex = useExplorerStore(s => s.typeIndex)
  const loading = useExplorerStore(s => s.loadingNodes.has(row.id))
  if (loading) return <Spinner size={ICON_SIZE} className="text-i3x-primary" />
  switch (row.nodeType) {
    case 'folder':
      if (row.id === OBJECTS_FOLDER_ID) return <GridIcon size={ICON_SIZE} className="text-i3x-text-muted" />
      if (row.id === HIERARCHICAL_FOLDER_ID) return <HierarchyIcon size={ICON_SIZE} className="text-i3x-text-muted" />
      return <LayersIcon size={ICON_SIZE} className="text-i3x-text-muted" />
    case 'namespace':
      return <GlobeIcon size={ICON_SIZE} className="text-i3x-primary" />
    case 'objectType': {
      // ObjectType definitions whose source resolves to OPC UA FolderType
      // render as a folder.
      const t = row.data as ObjectType | undefined
      const src = (t?.sourceTypeId ?? '').toLowerCase()
      const id = (t?.elementId ?? '').toLowerCase()
      if (src.includes('foldertype') || id.includes('foldertype')) {
        return <FolderIcon size={ICON_SIZE} className="text-i3x-warning" />
      }
      return <FileTextIcon size={ICON_SIZE} className="text-i3x-success" />
    }
    case 'object': {
      const obj = row.data as ObjectInstance | undefined
      const typeId = (obj?.typeId ?? '').toLowerCase()
      const type = obj ? typeIndex.get(obj.typeId) : undefined
      const componentColor = row.isComponent ? 'tree-component' : undefined
      // The catalog lists objects without metadata, so an instance's source type falls back to its type's.
      const metaSrc = String(obj?.sourceTypeId ?? obj?.metadata?.sourceTypeId ?? type?.sourceTypeId ?? '').toLowerCase()
      if (typeId.includes('foldertype') || metaSrc.includes('foldertype')) {
        return <FolderIcon size={ICON_SIZE} className={componentColor ?? 'text-i3x-warning'} />
      }
      if (isScalarSchemaType(type?.schema?.type)) {
        return <ActivityIcon size={ICON_SIZE} className={componentColor ?? 'text-i3x-violet'} />
      }
      return <CubeIcon size={ICON_SIZE} className={componentColor ?? 'text-i3x-secondary'} />
    }

    case 'relationshipType':
      return <LinkIcon size={ICON_SIZE} className="text-i3x-relationship" />

    case 'relationshipGroup':
      return <LinkIcon size={ICON_SIZE} className="text-i3x-relationship" />
  }
}

/**
 * Faint vertical guides marking each depth level, VS Code style. Absolutely
 * positioned over the row's left padding so they run edge-to-edge through the
 * row (including its vertical padding) and connect visually across rows. The
 * `active` column, the subtree of the current selection, is accented.
 */
export function IndentGuides({ depth, active }: { depth: number; active?: number | null }) {
  if (depth <= 0) return null
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 w-px ${
            i === active ? 'bg-i3x-primary/50' : 'bg-i3x-border/80'
          }`}
          style={{ left: `${i * 16 + 15}px` }}
        />
      ))}
    </>
  )
}

/**
 * One visible row of the flattened tree. Rendering is flat (depth = left
 * padding); expansion state lives in the store and the row list is rebuilt by
 * buildTreeRows, so this component never renders children. Click behavior is
 * the shared activateRow, identical to keyboard Enter.
 */
export const TreeNode = memo(function TreeNode({
  row,
  focused,
  activeGuide,
  domId,
}: {
  row: NodeRow
  focused?: boolean
  activeGuide?: number | null
  /** DOM id for aria-activedescendant from the tree container. */
  domId?: string
}) {
  const { nodeType, data, depth, hasChildren, isExpanded, count, label } = row
  // Narrow selector: a row re-renders for its own selection change only.
  const isSelected = useExplorerStore(s => s.selectedItem?.id === row.id)
  const [copied, setCopied] = useState(false)

  // What the hover action copies: element ID everywhere, URI for namespaces.
  const copyValue =
    nodeType === 'namespace' ? (data as Namespace | undefined)?.uri
    : nodeType === 'folder' ? undefined
    : (data as ObjectType | ObjectInstance | undefined)?.elementId

  const handleCopy = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!copyValue || !navigator.clipboard) return
    navigator.clipboard.writeText(copyValue).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }

  return (
    <div
      id={domId}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isExpanded : undefined}
      className={`tree-node group relative ${isSelected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => activateRow(row)}
    >
      <IndentGuides depth={depth} active={activeGuide} />
      {hasChildren ? (
        <span className="w-4 flex-shrink-0 flex items-center justify-center">
          <Chevron open={isExpanded} />
        </span>
      ) : (
        <span className="w-4 flex-shrink-0" />
      )}
      <span className="flex-shrink-0 flex items-center">
        <TreeRowIcon row={row} />
      </span>
      {/* Truncate, never scroll: the count pill stays pinned at the panel edge
          at any panel width; the tooltip carries the full name and widening
          the sidebar reveals more of it. Relationship-type grouping rows get
          the same accent color as their icon, so the "this isn't a real
          object" signal reads at a glance. */}
      <span
        className={`tree-label flex-1 min-w-0 truncate text-sm ${
          nodeType === 'relationshipGroup' ? 'text-i3x-relationship font-medium'
          : row.isComponent ? 'tree-component' : ''
        }`}
        title={nodeType === 'relationshipGroup' ? `Relationship: ${label}` : row.isComponent ? `Component: ${label}` : label}
      >
        {label}
      </span>

      {/* Right edge: hover copy action, then the count pill. */}
      <span className="flex items-center flex-shrink-0 pl-2">
        {copyValue && (
          <button
            type="button"
            onClick={handleCopy}
            title={nodeType === 'namespace' ? 'Copy namespace URI' : 'Copy element ID'}
            aria-label={nodeType === 'namespace' ? 'Copy namespace URI' : 'Copy element ID'}
            // `invisible`, not `hidden`: the slot must keep its layout space
            // when not hovered, or the count pill next to it would shift
            // sideways every time the pointer enters and leaves the row.
            className="invisible group-hover:visible focus:visible grid w-5 h-5 place-items-center rounded mr-1 text-i3x-text-muted hover:text-i3x-primary hover:bg-i3x-text/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            {copied
              ? <CheckIcon size={12} className="text-i3x-success" />
              : <CopyIcon size={12} />}
          </button>
        )}
        {count !== undefined && (
          <span
            className={`rounded-full px-1.5 text-[11px] leading-[1.15rem] tabular-nums ${
              row.filtered
                ? 'bg-i3x-primary/15 text-i3x-primary'
                : nodeType === 'relationshipGroup'
                ? 'bg-i3x-relationship/15 text-i3x-relationship'
                : row.isComponent
                ? 'tree-component-count'
                : 'bg-i3x-text/[0.07] text-i3x-text-muted'
            }`}
            title={row.filtered ? `${count.toLocaleString()} matching` : undefined}
          >
            {count.toLocaleString()}
          </span>
        )}
      </span>
    </div>
  )
})

/**
 * The "Show N more" row under a paged parent. One quiet line: reveal the next
 * page, see how much is hidden, or (when more than a page remains) opt into
 * everything at once.
 */
export const TreeMoreNode = memo(function TreeMoreNode({
  row,
  height,
  focused,
  activeGuide,
}: {
  row: MoreRow
  height: number
  focused?: boolean
  activeGuide?: number | null
}) {
  const nextStep = Math.min(row.hidden, CHILD_PAGE_SIZE)
  return (
    <div
      style={{ paddingLeft: `${row.depth * 16 + 8}px`, height }}
      className={`relative flex items-center gap-2 pr-2 rounded-md ${focused ? 'tree-more-focused' : ''}`}
    >
      <IndentGuides depth={row.depth} active={activeGuide} />
      <span className="w-4 flex-shrink-0" />
      {/* The tree body clips horizontally (labels truncate), so the two
          buttons must never shrink out of reach, only the "N hidden" count
          gives way on a narrow sidebar. */}
      <button
        type="button"
        onClick={() => useExplorerStore.getState().raiseChildLimit(row.parentId, CHILD_PAGE_SIZE)}
        className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-i3x-text-muted hover:text-i3x-primary rounded-md px-1.5 py-0.5 hover:bg-i3x-primary/10 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <EllipsisIcon size={12} />
        Show {nextStep.toLocaleString()} more
      </button>
      <span className="min-w-0 truncate text-[11px] text-i3x-text-muted/60 tabular-nums">
        {row.hidden.toLocaleString()} hidden
      </span>
      {row.hidden > CHILD_PAGE_SIZE && (
        <button
          type="button"
          onClick={() => useExplorerStore.getState().showAllChildren(row.parentId)}
          className="flex-shrink-0 whitespace-nowrap text-[11px] text-i3x-text-muted/80 hover:text-i3x-primary underline decoration-dotted underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          show all
        </button>
      )}
    </div>
  )
})
