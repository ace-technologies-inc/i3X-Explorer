import { useEffect, useMemo, useState } from 'react'
import type { ObjectInstance } from '../../api/types'
import type { DetailTab } from '../../stores/explorer'
import { Chevron } from '../common/Chevron'
import { ContextMenu, type MenuEntry } from '../common/ContextMenu'
import { FrameIcon, GripIcon } from '../common/icons'
import { Spinner } from '../common/Spinner'
import { BUCKET_COLOR } from './relationshipColors'
import {
  filterEgoTree,
  MAX_BLOCK_ROWS,
  PAGE_SIZE,
  planAutoExpand,
  type EgoTree,
  type EgoTreeGroup,
  type EgoTreeNode,
} from './egoTree'
import {
  buildRelationshipGroupMenu,
  buildRelationshipNodeMenu,
  EXPAND_BELOW_CAP,
  type RelationshipMenuActions,
} from './relationshipMenu'
import { ELEMENT_DRAG_TYPE } from './dragType'

/**
 * How tall a capped child block is allowed to get. Rows are a hair under 30px,
 * so this is MAX_BLOCK_ROWS of them plus the fade, past that the block scrolls
 * in place instead of pushing its siblings off the panel.
 */
const BLOCK_MAX_HEIGHT = '15rem'

/** The bottom of a capped block dissolves rather than being cut off mid-row. */
const FADE_MASK = 'linear-gradient(to bottom, black calc(100% - 2rem), transparent)'

/**
 * The relationship list: the same walk the map draws, as a nested list.
 *
 * It used to be a flat list of direct relationships only, fetched separately
 * from the map, so raising the depth grew the map and left the list behind.
 * Now both read one `EgoTree`, so everything drawn out there is in here, nested
 * under the node it hangs off.
 *
 * Depth is only half the problem: a hub's subtree can be thousands of rows, and
 * a nested list that expands freely swallows the panel. Two independent limits
 * keep it a list rather than a dump, each child block is capped in height and
 * fades out at the bottom, and rows are paged 50 at a time, so no one branch can
 * bury its siblings and no walk can mount five figures of rows.
 *
 * Each row offers three different things to do with it, and they are kept
 * visibly distinct because they cost very different amounts: the ◎ button
 * **focuses** the map on that row and its children (viewport only, nothing is
 * re-fetched and nothing is selected), dragging the row onto the map **re-roots**
 * the walk there, and clicking the name **navigates**. The right-click menu
 * carries all three plus the copy and expand actions.
 */
export function RelationshipList({
  tree,
  isLoading,
  error,
  depth,
  onSelect,
  onFocus,
  onRoot,
  onHover,
  filter,
}: {
  /** The walk, as a nested list. null until the first one lands. */
  tree: EgoTree | null
  isLoading: boolean
  error: string | null
  /** Hops the walk covers, for the count line. */
  depth: number
  /** Navigate to the object, optionally straight onto one of its detail tabs. */
  onSelect: (object: ObjectInstance, tab?: DetailTab) => void
  /** Frame this object and its children on the map. No re-walk, no navigation. */
  onFocus: (object: ObjectInstance) => void
  /** Re-root the walk (both panes) on this object, without navigating to it. */
  onRoot: (object: ObjectInstance) => void
  /** Row hovered or left. The map highlights that element as if hovered there. */
  onHover?: (elementId: string | null) => void
  /** Search text: only rows (or whole relationship types) matching it are shown. */
  filter?: string
}) {
  // What the user has explicitly opened or closed. Everything else follows the
  // auto-expand plan, so a manual collapse is never undone by the budget.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map())
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())
  const [pages, setPages] = useState<Map<string, number>>(new Map())
  // `trigger` is refocused on close, so Escape puts a keyboard user back on the
  // row they opened the menu from rather than at the top of the document.
  const [menu, setMenu] = useState<{
    x: number
    y: number
    entries: MenuEntry[]
    trigger: HTMLElement | null
  } | null>(null)

  // A new walk is a new picture: the old plan, paging and overrides described a
  // shape that no longer exists.
  useEffect(() => {
    setOverrides(new Map())
    setPages(new Map())
    setMenu(null)
  }, [tree])

  const autoOpen = useMemo(() => (tree ? planAutoExpand(tree) : new Set<string>()), [tree])

  const filtered = useMemo(
    () => (tree ? filterEgoTree(tree, filter ?? '') : null),
    [tree, filter]
  )

  const text = filter?.trim() ?? ''

  if (!tree) {
    if (isLoading) {
      return (
        <p className="flex items-center gap-1.5 text-xs text-i3x-text-muted">
          <Spinner size={12} />
          Loading relationships…
        </p>
      )
    }
    if (error) return <p className="text-xs text-i3x-error">{error}</p>
    return <p className="text-xs text-i3x-text-muted">No relationships.</p>
  }

  if (tree.total === 0) {
    return <p className="text-xs text-i3x-text-muted">No relationships.</p>
  }

  const isOpen = (node: EgoTreeNode) => {
    const id = node.object.elementId
    // While filtering, a branch leading to a match opens regardless: a hit behind
    // a chevron is a hit you can't see.
    if (text && filtered?.open.has(id)) return true
    return overrides.get(id) ?? autoOpen.has(id)
  }

  const toggle = (node: EgoTreeNode) =>
    setOverrides(current => {
      const next = new Map(current)
      next.set(node.object.elementId, !isOpen(node))
      return next
    })

  const pageOf = (id: string) => pages.get(id) ?? PAGE_SIZE
  // Reads the page off the updater's own state, so two clicks in one frame
  // reveal 100 rows rather than 50 twice.
  const showMore = (id: string) =>
    setPages(current => new Map(current).set(id, (current.get(id) ?? PAGE_SIZE) + PAGE_SIZE))
  const showAll = (id: string) => setPages(current => new Map(current).set(id, Infinity))

  /**
   * Open or close every branch under these roots, in one write. Capped, and
   * breadth-first so the cap is spent on the shallow levels: the pane is 340px
   * wide, and a hub whose whole subtree is mounted in it helps nobody, whereas
   * its first couple of levels are exactly what "expand all below" was asked
   * for. Anything past the cap stays behind its counts.
   */
  const setSubtreeOpen = (roots: EgoTreeNode[], open: boolean) =>
    setOverrides(current => {
      const next = new Map(current)
      const queue = [...roots]
      let opened = 0
      for (let i = 0; i < queue.length && opened < EXPAND_BELOW_CAP; i++) {
        const node = queue[i]
        if (node.children.length === 0) continue
        next.set(node.object.elementId, open)
        opened++
        // One at a time, not a spread: a hub's child list can be long enough to
        // overflow the argument limit.
        for (const child of node.children) queue.push(child)
      }
      return next
    })

  const menuActions: RelationshipMenuActions = {
    onOpen: onSelect,
    onFocus,
    onRoot,
    isOpen,
    onToggle: toggle,
    onSetBranchOpen: (node, open) => setSubtreeOpen([node], open),
    onSetGroupOpen: (group, open) => {
      // Expanding a group implies showing it: a collapsed header with its rows
      // silently expanded underneath would look like the action did nothing.
      if (open) setClosedGroups(current => {
        const next = new Set(current)
        next.delete(group.type)
        return next
      })
      setSubtreeOpen(group.items, open)
    },
    onShowAll: showAll,
    shownCount: pageOf,
  }

  const openNodeMenu = (node: EgoTreeNode, x: number, y: number, trigger: HTMLElement | null) =>
    setMenu({ x, y, trigger, entries: buildRelationshipNodeMenu(node, menuActions) })
  const openGroupMenu = (group: EgoTreeGroup, x: number, y: number, trigger: HTMLElement | null) =>
    setMenu({ x, y, trigger, entries: buildRelationshipGroupMenu(group, menuActions) })

  const closeMenu = () => {
    // A no-op on the row div (not focusable); the point is the keyboard path,
    // where the trigger is the row's own button.
    menu?.trigger?.focus?.()
    setMenu(null)
  }

  const groups = filtered?.groups ?? tree.groups

  return (
    <div className="flex flex-col h-full min-h-0">
      <p className="mb-2 shrink-0 flex items-center gap-1.5 text-[11px] text-i3x-text-muted">
        {text ? (
          <>
            {(filtered?.matches ?? 0).toLocaleString()} of {tree.total.toLocaleString()}{' '}
            {tree.total === 1 ? 'relationship matches' : 'relationships match'}
          </>
        ) : (
          <>
            {tree.direct.toLocaleString()} direct
            {depth > 1 && tree.total > tree.direct && (
              <> · {tree.total.toLocaleString()} within {depth} hops</>
            )}{' '}
            · right-click a row for more
          </>
        )}
        {/* A deeper walk extends what's already here rather than replacing it, so
            the list stays readable while the next hop is in flight. */}
        {isLoading && <Spinner size={11} />}
      </p>

      {/* Fills the pane and scrolls in place, so a hub with thousands of children
          doesn't stretch the card. pr/-mr keeps the scrollbar off the rows.
          Scrolling closes an open menu: the row it belongs to moves out from
          under it. */}
      <div
        onScroll={() => setMenu(null)}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 -mr-1"
      >
        {groups.length === 0 ? (
          <p className="text-xs text-i3x-text-muted px-2 py-1">
            No relationships match “{text}”.
          </p>
        ) : (
          groups.map(group => (
            <Group
              key={group.type}
              group={group}
              isOpen={!closedGroups.has(group.type)}
              onToggle={() =>
                setClosedGroups(current => {
                  const next = new Set(current)
                  if (next.has(group.type)) next.delete(group.type)
                  else next.add(group.type)
                  return next
                })
              }
              // Namespaced so a relationship type can't collide with an elementId.
              page={pageOf(`group:${group.type}`)}
              onShowMore={() => showMore(`group:${group.type}`)}
              nodeIsOpen={isOpen}
              onToggleNode={toggle}
              pageOf={pageOf}
              onShowMoreNode={showMore}
              onSelect={onSelect}
              onFocus={onFocus}
              onHover={onHover}
              onNodeMenu={openNodeMenu}
              onGroupMenu={openGroupMenu}
            />
          ))
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={closeMenu} />
      )}
    </div>
  )
}

/** Shared by every level below the root, which is where the nesting happens. */
interface RowHandlers {
  nodeIsOpen: (node: EgoTreeNode) => boolean
  onToggleNode: (node: EgoTreeNode) => void
  pageOf: (id: string) => number
  onShowMoreNode: (id: string) => void
  onSelect: (object: ObjectInstance, tab?: DetailTab) => void
  onFocus: (object: ObjectInstance) => void
  onHover?: (elementId: string | null) => void
  /** Right-click (or Shift+F10 / Menu) on a row, at viewport coordinates. */
  onNodeMenu: (node: EgoTreeNode, x: number, y: number, trigger: HTMLElement | null) => void
  onGroupMenu: (group: EgoTreeGroup, x: number, y: number, trigger: HTMLElement | null) => void
}

/** Where a keyboard-opened menu goes: just under the row that asked for it. */
function menuAnchor(element: HTMLElement): [number, number] {
  const rect = element.getBoundingClientRect()
  return [rect.left + 16, rect.bottom]
}

/** Shift+F10 and the Menu key open the context menu, matching the tree. */
function isMenuKey(event: React.KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}

function Group({
  group,
  isOpen,
  onToggle,
  page,
  onShowMore,
  ...handlers
}: RowHandlers & {
  group: EgoTreeGroup
  isOpen: boolean
  onToggle: () => void
  page: number
  onShowMore: () => void
}) {
  const accent = BUCKET_COLOR[group.bucket]

  return (
    <section className="mb-1.5 last:mb-0">
      <button
        type="button"
        onClick={onToggle}
        onContextMenu={event => {
          event.preventDefault()
          handlers.onGroupMenu(group, event.clientX, event.clientY, event.currentTarget)
        }}
        onKeyDown={event => {
          if (!isMenuKey(event)) return
          event.preventDefault()
          const [x, y] = menuAnchor(event.currentTarget)
          handlers.onGroupMenu(group, x, y, event.currentTarget)
        }}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <Chevron open={isOpen} />
        {/* The bucket color, so a row's kind reads the same here as on the map's edges. */}
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: accent }}
        />
        <span className="text-[12.5px] font-medium text-i3x-text truncate">{group.type}</span>
        <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-i3x-text-muted border border-i3x-border rounded-full px-1.5 py-px">
          {group.items.length.toLocaleString()}
        </span>
      </button>

      {isOpen && (
        <ChildBlock
          items={group.items}
          page={page}
          onShowMore={onShowMore}
          accent={accent}
          className="ml-[9px] pl-2.5"
          {...handlers}
        />
      )}
    </section>
  )
}

/**
 * One level of children: capped, faded and paged.
 *
 * The cap is what keeps this a list. Without it a single container with 2,000
 * children pushes everything after it off the panel, and the nesting that was
 * supposed to show structure hides it instead. Short blocks are left alone,
 * a permanently half-faded third row would read as a rendering bug.
 */
function ChildBlock({
  items,
  page,
  onShowMore,
  accent,
  className,
  ...handlers
}: RowHandlers & {
  items: EgoTreeNode[]
  page: number
  onShowMore: () => void
  accent: string
  className: string
}) {
  const [atBottom, setAtBottom] = useState(false)

  // Revealing another page puts content below the fold again, so the fade has to
  // come back even though no scroll event fired.
  useEffect(() => setAtBottom(false), [page])

  const shown = items.slice(0, page)
  const remaining = items.length - shown.length
  const capped = shown.length > MAX_BLOCK_ROWS

  // Scrolled to the end, there is nothing below to hint at, and a fade there
  // would just make the last row hard to read.
  const faded = capped && !atBottom

  const list = (
    // The accent rail ties every row back to the relationship it belongs to, so
    // the color doesn't have to be repeated on each one.
    <ul
      className={`border-l ${className}`}
      style={{ borderColor: `color-mix(in srgb, ${accent} 45%, transparent)` }}
    >
      {shown.map(node => (
        <NodeRow key={node.object.elementId} node={node} accent={accent} {...handlers} />
      ))}
    </ul>
  )

  return (
    <>
      {capped ? (
        <div
          onScroll={event => {
            const el = event.currentTarget
            setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 2)
          }}
          // overflow-x too: a non-visible overflow-y computes overflow-x to auto,
          // which would put a horizontal scrollbar under rows that already truncate.
          className="overflow-y-auto overflow-x-hidden overscroll-contain"
          style={{
            maxHeight: BLOCK_MAX_HEIGHT,
            maskImage: faded ? FADE_MASK : undefined,
            WebkitMaskImage: faded ? FADE_MASK : undefined,
          }}
        >
          {list}
        </div>
      ) : (
        list
      )}

      {/* Outside the capped box, so it never sits under the fade. */}
      {remaining > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className={`${className} block my-1 text-[11px] text-i3x-primary hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary`}
        >
          Show {Math.min(PAGE_SIZE, remaining)} more · {remaining.toLocaleString()} remaining
        </button>
      )}
    </>
  )
}

function NodeRow({
  node,
  accent,
  nodeIsOpen,
  onToggleNode,
  pageOf,
  onShowMoreNode,
  onSelect,
  onFocus,
  onHover,
  onNodeMenu,
  onGroupMenu,
}: RowHandlers & { node: EgoTreeNode; accent: string }) {
  const { object } = node
  // Past the root the walk descends through child edges only, so everything
  // nested is a child: one rail color the whole way down, no group headers.
  const childAccent = node.children.length > 0 ? BUCKET_COLOR[node.children[0].bucket] : accent
  const expandable = node.children.length > 0
  const open = expandable && nodeIsOpen(node)

  return (
    <li>
      <div
        draggable
        onDragStart={event => {
          event.dataTransfer.setData(ELEMENT_DRAG_TYPE, object.elementId)
          // text/plain keeps the drag legible to anything else that might accept it.
          event.dataTransfer.setData('text/plain', object.elementId)
          event.dataTransfer.effectAllowed = 'copy'
        }}
        onMouseEnter={() => onHover?.(object.elementId)}
        onMouseLeave={() => onHover?.(null)}
        onContextMenu={event => {
          event.preventDefault()
          onNodeMenu(node, event.clientX, event.clientY, null)
        }}
        className="group flex items-center gap-1 rounded-lg hover:bg-i3x-bg"
      >
        <span
          aria-hidden="true"
          className="pl-1.5 flex items-center text-i3x-text-muted/50 cursor-grab active:cursor-grabbing"
          title="Drag onto the map to root it there"
        >
          <GripIcon size={12} />
        </span>

        {/* Disclosure is its own control: clicking the name navigates, which
            replaces this whole view, so the two can't share a click. A row at
            the depth limit has no chevron, the map draws it as a leaf too. */}
        {expandable ? (
          <button
            type="button"
            onClick={() => onToggleNode(node)}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${object.displayName}`}
            className="w-4 h-6 grid place-items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            <Chevron open={open} />
          </button>
        ) : (
          <span aria-hidden="true" className="w-4 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onSelect(object)}
          onKeyDown={event => {
            if (!isMenuKey(event)) return
            event.preventDefault()
            const [x, y] = menuAnchor(event.currentTarget)
            onNodeMenu(node, x, y, event.currentTarget)
          }}
          title={object.elementId}
          className="flex-1 min-w-0 flex items-baseline gap-2 py-1.5 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          <span className="text-[13px] text-i3x-text truncate">{object.displayName}</span>
          <span className="font-mono text-[11px] text-i3x-text-muted truncate ml-auto">
            {object.typeId}
          </span>
        </button>

        {expandable && (
          <span
            title={`${node.descendants.toLocaleString()} within the walk · ${node.children.length.toLocaleString()} direct`}
            className="shrink-0 text-[10.5px] tabular-nums text-i3x-text-muted border border-i3x-border rounded-full px-1.5 py-px"
          >
            {node.descendants.toLocaleString()}
          </span>
        )}

        {/* Focus, not navigation and not a re-root: the map zooms to this node
            and its children and lights that branch. The picture it is looking
            at doesn't change, so nothing is re-fetched and nothing is selected. */}
        <button
          type="button"
          onClick={() => onFocus(object)}
          aria-label={`Zoom the map to ${object.displayName} and its children`}
          title="Zoom the map to this and its children"
          className="mr-1 w-6 h-6 grid place-items-center rounded-md text-i3x-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-i3x-surface hover:text-i3x-primary transition-opacity motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          <FrameIcon size={14} />
        </button>
      </div>

      {open && (
        <ChildBlock
          items={node.children}
          page={pageOf(object.elementId)}
          onShowMore={() => onShowMoreNode(object.elementId)}
          accent={childAccent}
          // Tighter than the top level: the pane is 340px and the indent has to
          // last ten levels without eating the labels.
          className="ml-[7px] pl-2"
          nodeIsOpen={nodeIsOpen}
          onToggleNode={onToggleNode}
          pageOf={pageOf}
          onShowMoreNode={onShowMoreNode}
          onSelect={onSelect}
          onFocus={onFocus}
          onHover={onHover}
          onNodeMenu={onNodeMenu}
          onGroupMenu={onGroupMenu}
        />
      )}
    </li>
  )
}
