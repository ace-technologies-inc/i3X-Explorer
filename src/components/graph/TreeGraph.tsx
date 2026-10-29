import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectInstance } from '../../api/types'
import { BUCKET_COLOR, dashArray, nodeFill } from './relationshipColors'
import { COMPOSITION_DASH } from './relationshipColors'
import { descendantIds, type EgoGraph } from './egoGraph'
import { COLUMN_WIDTH, layoutTree, MAX_LABEL_CHARS, type PositionedEdge, type PositionedNode } from './treeLayout'
import { ELEMENT_DRAG_TYPE } from './dragType'
import { FrameIcon } from '../common/icons'
import { I3xLoader } from '../common/I3xLoader'
import { FocusBadge } from './FocusBadge'
import { GraphSettingsMenu } from './GraphSettingsMenu'
import { GraphTypeLegend } from './GraphTypeLegend'
import {
  applyGraphSettings,
  buildLegendEntries,
  buildTypeColorMap,
  depthOpacity,
  typeColor,
  useGraphSettings,
} from './graphSettings'
import { useExplorerStore } from '../../stores/explorer'
import type { LocateRequest } from './locator'
import { traceSpan } from '../../diagnostics/perfTrace'

const MIN_SCALE = 0.2
// The usual zoom ceiling. A tree tall enough that this can't make labels readable
// gets a higher one, up to MAX_PX_PER_UNIT screen pixels per diagram unit.
const MAX_SCALE = 40
const MAX_PX_PER_UNIT = 2

/** Room a framed branch leaves around itself, as a fraction of the pane. */
const FOCUS_MARGIN = 0.86
/** Diagram units a node's label takes to its right; framing has to include it. */
const LABEL_SPAN = 190

// Label + node sizes live in diagram units and scale with the map. The tree gives
// every node its own row, so they never collide however the map is scaled.
const FONT = 14
const LABEL_GAP = 8

// The initial view fits the whole tree (its bounding box) so every node is visible
// top to bottom, centred, at any depth. Content smaller than the minimum is shown
// at a comfortable size rather than blown up to fill the pane; zoom/pan to read a
// large tree from there.
const LEFT_PAD = 34
const RIGHT_PAD = 250
const V_PAD = 32
const MIN_VIEW_W = 1000
const MIN_VIEW_H = 520

// Below this on-screen label size names are unreadable, so the map draws the tree as a
// handful of aggregate paths instead of one interactive element per object.
const MIN_READABLE_LABEL_PX = 4
// Drawn beyond the visible area, so a pan reveals nodes already in place.
const CULL_MARGIN = 270

interface EdgeGroup {
  key: string
  bucket: PositionedEdge['bucket']
  tree: boolean
  opacity: number
  d: string
}

interface DotGroup {
  fill: string
  d: string
}

export interface TreeGraphProps {
  /** The element at the root of the tree: the selected object, or whatever was dropped in. */
  root: ObjectInstance
  /**
   * The walk, owned one level up (`useEgoGraph`) and shared with the relationship
   * list, so the list and the drawing can never show different structures.
   */
  graph: EgoGraph | null
  isLoading: boolean
  error: string | null
  /** Hops the walk was asked for. Describes the drawing; it no longer drives it. */
  depth: number
  /** Whether that walk was descendants-only, for the accessible label's wording. */
  descendantsOnly?: boolean
  /**
   * Re-root the walk here without navigating away: a node click, or a drop onto
   * the canvas. Omit to disable both (the Subtree tab has no drag source and
   * doesn't re-root; there a click opens the element instead).
   */
  onRootElement?: (elementId: string) => void
  /** Opening a node in the detail view (the click fallback when re-rooting is off). */
  onSelectElement: (elementId: string) => void
  /**
   * An element hovered outside the tree, such as a row in the relationships list.
   * The tree highlights it as if it were hovered here. A real hover on the tree
   * takes priority.
   */
  externalHoverId?: string | null
  /**
   * A view request: centre on a node (`scope: 'node'`, a search pick) or frame
   * it with everything under it and hold that branch lit (`scope: 'subtree'`,
   * the list's focus button). Never re-roots or re-walks, it only moves the
   * viewport. Ignored if the node isn't drawn; answered late if it arrives while
   * the walk is still loading.
   */
  locate?: LocateRequest | null
}

/**
 * The depth-N relationship map for one element, drawn as a left-to-right tree.
 *
 * The root sits in the middle; parents are columns to the left, children to the
 * right; every node gets its own row. One node per row means a label always has
 * space, so names never overlap the way they do on a radial map. Edge color is the
 * relationship bucket, matching the legend below the card; cross-links (a node
 * reached more than one way) are the dashed curves. This is the "tree" view; the
 * "rings" view (`RadialGraph`) is the other option in the toggle.
 */
export function TreeGraph({
  root,
  graph,
  isLoading,
  error,
  depth,
  descendantsOnly = false,
  onRootElement,
  onSelectElement,
  externalHoverId,
  locate,
}: TreeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [isDropTarget, setIsDropTarget] = useState(false)
  // The branch a subtree focus is holding lit. View state, not walk state: the
  // graph is untouched, the rest of it is simply dimmed around this one.
  const [focusId, setFocusId] = useState<string | null>(null)
  // Types picked in the legend to focus; everything else dims. View-only, like
  // the branch focus above.
  const [focusTypes, setFocusTypes] = useState<Set<string>>(() => new Set())

  const settings = useGraphSettings()

  // The walk with the map's display settings applied (leaves folded, siblings
  // reordered). The list beside it still reads the untransformed walk, so this
  // is deliberately map-only. Keyed on the primitive settings so the object's
  // fresh identity each render doesn't re-run the transform.
  const displayGraph = useMemo(
    () =>
      graph
        ? applyGraphSettings(graph, {
            leafMode: settings.leafMode,
            sortBySize: settings.sortBySize,
          })
        : null,
    [graph, settings.leafMode, settings.sortBySize]
  )

  const layout = useMemo(
    () => (displayGraph ? traceSpan('tree layout', () => layoutTree(displayGraph)) : null),
    [displayGraph]
  )

  // One type→color map shared by the node fills and the legend, so they agree.
  const typeColorMap = useMemo(
    () => (settings.colorByType && layout ? buildTypeColorMap(layout.nodes) : null),
    [settings.colorByType, layout]
  )

  const typeIndex = useExplorerStore(s => s.typeIndex)
  const legendEntries = useMemo(
    () =>
      settings.colorByType && layout
        ? buildLegendEntries(layout.nodes, typeColorMap, typeIndex)
        : [],
    [settings.colorByType, layout, typeColorMap, typeIndex]
  )

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of layout?.edges ?? []) {
      if (!map.has(edge.source)) map.set(edge.source, new Set())
      if (!map.has(edge.target)) map.set(edge.target, new Set())
      map.get(edge.source)!.add(edge.target)
      map.get(edge.target)!.add(edge.source)
    }
    return map
  }, [layout])

  const nodeById = useMemo(
    () => new Map((layout?.nodes ?? []).map(node => [node.object.elementId, node])),
    [layout]
  )

  // A new root is a new picture; keep the old pan/zoom and it would open
  // off-screen, and a focus held over from the old one would light a branch
  // that may not even be drawn any more.
  useEffect(() => {
    setTransform({ scale: 1, x: 0, y: 0 })
    setFocusId(null)
    setFocusTypes(new Set())
  }, [root.elementId])

  const toUserSpace = useCallback((clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return [0, 0]
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const user = point.matrixTransform(ctm.inverse())
    return [user.x, user.y]
  }, [])

  const maxScaleRef = useRef(MAX_SCALE)
  const zoomAbout = useCallback((cx: number, cy: number, factor: number) => {
    setTransform(current => {
      const scale = Math.max(MIN_SCALE, Math.min(maxScaleRef.current, current.scale * factor))
      return {
        scale,
        x: cx - (cx - current.x) * (scale / current.scale),
        y: cy - (cy - current.y) * (scale / current.scale),
      }
    })
  }, [])

  // React attaches onWheel passively at the root, so preventDefault there is a
  // no-op. Bind it directly to keep the page from scrolling while zooming.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !layout) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const [ux, uy] = toUserSpace(event.clientX, event.clientY)
      zoomAbout(ux, uy, event.deltaY < 0 ? 1.12 : 0.89)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [layout, toUserSpace, zoomAbout])

  const panOrigin = useRef<[number, number] | null>(null)

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('[data-node]')) return
    panOrigin.current = toUserSpace(event.clientX, event.clientY)
    setIsPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!panOrigin.current) return
    const [ux, uy] = toUserSpace(event.clientX, event.clientY)
    const [lx, ly] = panOrigin.current
    panOrigin.current = [ux, uy]
    setTransform(current => ({ ...current, x: current.x + (ux - lx), y: current.y + (uy - ly) }))
  }

  const endPan = (event: React.PointerEvent<SVGSVGElement>) => {
    panOrigin.current = null
    setIsPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const carriesElement = (event: React.DragEvent) =>
    onRootElement != null && event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)

  const handleDragOver = (event: React.DragEvent) => {
    if (!carriesElement(event)) return
    // Without preventDefault the browser refuses the drop outright.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDropTarget(true)
  }

  const handleDrop = (event: React.DragEvent) => {
    if (!carriesElement(event)) return
    event.preventDefault()
    setIsDropTarget(false)
    const elementId = event.dataTransfer.getData(ELEMENT_DRAG_TYPE)
    if (elementId) onRootElement?.(elementId)
  }

  // Clicking a node digs down: re-root the walk here, exactly like dropping the
  // node onto the canvas, so exploring stays on this page. Falls back to opening
  // the element where there's no re-root target (the Subtree tab has no drag
  // source and doesn't re-root).
  const handleNodeClick = useCallback(
    (elementId: string) => {
      if (onRootElement) onRootElement(elementId)
      else onSelectElement(elementId)
    },
    [onRootElement, onSelectElement]
  )

  // A row hovered in the list highlights here just like a map hover, but an actual
  // hover on the map wins. An external id that isn't drawn is ignored, so it can't
  // dim the whole map with nothing lit.
  const activeHoverId =
    hoverId ?? (externalHoverId && nodeById.has(externalHoverId) ? externalHoverId : null)

  const hovered = activeHoverId ? nodeById.get(activeHoverId) : null
  const hoveredNeighbors = activeHoverId ? neighbors.get(activeHoverId) : undefined

  // The lit branch. Re-derived from the current layout, so a deeper walk grows
  // the focus with the drawing, and a focus whose node is no longer drawn is
  // dropped rather than dimming everything with nothing lit.
  const focusSet = useMemo(() => {
    if (!layout || !focusId || !nodeById.has(focusId)) return null
    return descendantIds(layout.nodes, focusId)
  }, [layout, focusId, nodeById])
  const focusNode = focusSet ? nodeById.get(focusId!) : null

  // Legend type-focus: a node whose type isn't picked is dimmed. Root (drawn in
  // the primary color) is always kept. Independent of, and additive to, the
  // hover/branch dimming below.
  const typeFocusActive = settings.colorByType && focusTypes.size > 0

  // Hovering is the live gesture, so it takes over the dimming while it lasts;
  // the focus comes back the moment the cursor leaves. A legend type-focus dims
  // on top of either.
  const dimmed = useCallback(
    (id: string) => {
      const hoverDimmed = activeHoverId !== null
        ? id !== activeHoverId && !hoveredNeighbors?.has(id)
        : focusSet !== null && !focusSet.has(id)
      if (hoverDimmed || !typeFocusActive) return hoverDimmed
      const node = nodeById.get(id)
      return !!node && node.depth !== 0 && !focusTypes.has(node.object.typeId)
    },
    [activeHoverId, hoveredNeighbors, focusSet, typeFocusActive, nodeById, focusTypes]
  )

  // The pane's pixel size, to tell how large the drawing is on screen.
  const paneRef = useRef<HTMLDivElement>(null)
  const [pane, setPane] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = paneRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) =>
      setPane({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const toggleFocusType = (typeId: string) =>
    setFocusTypes(prev => {
      const next = new Set(prev)
      if (next.has(typeId)) next.delete(typeId)
      else next.add(typeId)
      return next
    })

  // The initial view: the content box, clamped so a small tree isn't blown up and a
  // huge one isn't shrunk to nothing (you scroll instead). Centred on the content.
  const view = useMemo(() => {
    const left = (layout?.minX ?? 0) - LEFT_PAD
    const right = (layout?.maxX ?? 0) + RIGHT_PAD
    const top = (layout?.minY ?? 0) - V_PAD
    const bottom = (layout?.maxY ?? 0) + V_PAD
    const w = Math.max(right - left, MIN_VIEW_W)
    const h = Math.max(bottom - top, MIN_VIEW_H)
    return { w, h, x: (left + right) / 2 - w / 2, y: (top + bottom) / 2 - h / 2 }
  }, [layout])
  const { w: viewW, h: viewH, x: viewX, y: viewY } = view

  // What the pane shows, in layout units: the viewBox scales uniformly ('meet') and
  // is centred, then the pan/zoom transform applies. Null until the pane is measured.
  const fit = Math.min(pane.width / viewW, pane.height / viewH)
  const maxScale = fit > 0 ? Math.max(MAX_SCALE, MAX_PX_PER_UNIT / fit) : MAX_SCALE
  maxScaleRef.current = maxScale
  const visible = useMemo(() => {
    if (!(fit > 0)) return null
    const userW = pane.width / fit
    const userH = pane.height / fit
    const userLeft = viewX + (viewW - userW) / 2
    const userTop = viewY + (viewH - userH) / 2
    const { scale, x, y } = transform
    return {
      pxPerUnit: fit * scale,
      minX: (userLeft - x) / scale - CULL_MARGIN,
      maxX: (userLeft + userW - x) / scale + CULL_MARGIN,
      minY: (userTop - y) / scale - CULL_MARGIN,
      maxY: (userTop + userH - y) / scale + CULL_MARGIN,
    }
  }, [fit, pane, viewW, viewH, viewX, viewY, transform])
  const overview = visible === null || FONT * visible.pxPerUnit < MIN_READABLE_LABEL_PX

  // Readable zoom: only the nodes on (or just off) screen are elements.
  const drawnNodes = useMemo(() => {
    if (!layout || overview || !visible) return []
    return layout.nodes.filter(node =>
      node.x >= visible.minX && node.x <= visible.maxX && node.y >= visible.minY && node.y <= visible.maxY
    )
  }, [layout, overview, visible])

  // Overview zoom: every node but the root as a dot in one path per fill color.
  const dotGroups = useMemo<DotGroup[]>(() => {
    if (!layout || !overview) return []
    const groups = new Map<string, string[]>()
    for (const node of layout.nodes) {
      if (node.depth === 0) continue
      const fill = settings.colorByType
        ? typeColor(node.object.typeId, typeColorMap)
        : nodeFill(node.object.isComposition === true)
      const dot = `M${node.x},${node.y}h0`
      const parts = groups.get(fill)
      if (parts) parts.push(dot)
      else groups.set(fill, [dot])
    }
    return [...groups].map(([fill, parts]) => ({ fill, d: parts.join('') }))
  }, [layout, overview, settings.colorByType, typeColorMap])
  const rootNode = layout?.nodes.find(node => node.depth === 0) ?? null

  // Edges carry no handlers, so they draw as one path per shared style instead
  // of one element each: thousands of edges cost a few DOM nodes. At a readable
  // zoom only the edges crossing the visible area are drawn.
  const edgeBounds = overview ? null : visible
  const edgeGroups = useMemo<EdgeGroup[]>(() => {
    const groups = new Map<string, EdgeGroup & { parts: string[] }>()
    for (const edge of layout?.edges ?? []) {
      if (
        edgeBounds &&
        (Math.max(edge.x1, edge.x2) < edgeBounds.minX || Math.min(edge.x1, edge.x2) > edgeBounds.maxX ||
          Math.max(edge.y1, edge.y2) < edgeBounds.minY || Math.min(edge.y1, edge.y2) > edgeBounds.maxY)
      ) continue
      const faded = dimmed(edge.source) && dimmed(edge.target)
      const distance = settings.fadeDistant
        ? Math.min(
            depthOpacity(nodeById.get(edge.source)?.depth ?? 0),
            depthOpacity(nodeById.get(edge.target)?.depth ?? 0)
          )
        : 1
      const opacity = faded ? 0.1 : (edge.tree ? 0.8 : 0.5) * distance
      const key = `${edge.bucket}|${edge.tree}|${opacity}`
      let group = groups.get(key)
      if (!group) {
        group = { key, bucket: edge.bucket, tree: edge.tree, opacity, d: '', parts: [] }
        groups.set(key, group)
      }
      const midX = (edge.x1 + edge.x2) / 2
      group.parts.push(`M${edge.x1},${edge.y1}C${midX},${edge.y1} ${midX},${edge.y2} ${edge.x2},${edge.y2}`)
    }
    return [...groups.values()].map(({ parts, ...group }) => ({ ...group, d: parts.join('') }))
  }, [layout, dimmed, settings.fadeDistant, nodeById, edgeBounds])

  // Locator. A 'node' request (a search pick) centres the view on that node and
  // zooms in enough to read its neighborhood; a 'subtree' request frames the
  // whole branch, whatever its size, and lights it. Neither touches the walk.
  // The token ref means a request is answered exactly once, but late, if it
  // lands while the walk is still loading, since nodeById refreshing re-runs the
  // effect with the request still unhandled. The ref starts at the mount-time
  // token so a remount (the Tree/Rings toggle) doesn't re-answer an old request;
  // a pick that isn't drawn is answered late while the walk is still loading,
  // but once the walk settles without it, it's marked handled so a later deeper
  // walk can't replay a long-forgotten jump.
  const handledLocateToken = useRef(locate?.token ?? 0)
  useEffect(() => {
    if (!locate || locate.token === handledLocateToken.current) return
    const node = nodeById.get(locate.elementId)
    if (!node || !layout) {
      if (!isLoading) handledLocateToken.current = locate.token
      return
    }
    handledLocateToken.current = locate.token

    if (locate.scope !== 'subtree') {
      setFocusId(null)
      const scale = Math.min(maxScale, Math.max(1.6, view.w / 900))
      setTransform({
        scale,
        // Bias half a label to the right of the node so the name is centred too.
        x: view.x + view.w / 2 - (node.x + 60) * scale,
        y: view.y + view.h / 2 - node.y * scale,
      })
      return
    }

    // Frame the branch: its own bounding box (plus the room its labels need)
    // scaled to fill the pane. A single leaf has no extent of its own, so the
    // box is floored at one column, otherwise the fit would divide by ~0 and
    // slam into the zoom ceiling.
    const ids = descendantIds(layout.nodes, node.object.elementId)
    let minX = node.x
    let maxX = node.x
    let minY = node.y
    let maxY = node.y
    for (const drawn of layout.nodes) {
      if (!ids.has(drawn.object.elementId)) continue
      if (drawn.x < minX) minX = drawn.x
      if (drawn.x > maxX) maxX = drawn.x
      if (drawn.y < minY) minY = drawn.y
      if (drawn.y > maxY) maxY = drawn.y
    }
    maxX += LABEL_SPAN
    const boxW = Math.max(maxX - minX, COLUMN_WIDTH)
    const boxH = Math.max(maxY - minY, 120)
    const scale = Math.max(
      MIN_SCALE,
      Math.min(maxScale, (Math.min(view.w / boxW, view.h / boxH) * FOCUS_MARGIN))
    )
    setFocusId(node.object.elementId)
    setTransform({
      scale,
      x: view.x + view.w / 2 - ((minX + maxX) / 2) * scale,
      y: view.y + view.h / 2 - ((minY + maxY) / 2) * scale,
    })
  }, [locate, nodeById, layout, view, isLoading, maxScale])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        ref={paneRef}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDropTarget(false)}
        onDrop={handleDrop}
        className={`relative flex-1 min-h-0 rounded-xl border overflow-hidden bg-i3x-bg transition-colors motion-reduce:transition-none ${
          isDropTarget ? 'border-i3x-primary ring-2 ring-i3x-primary/40' : 'border-i3x-border'
        }`}
      >
        {error ? (
          <Centered>
            <p className="text-xs text-i3x-error">{error}</p>
          </Centered>
        ) : !layout && isLoading ? (
          <Centered>
            <I3xLoader size={64} className="mx-auto" />
            <p className="mt-3 text-xs text-i3x-text-muted">Walking relationships…</p>
          </Centered>
        ) : layout && layout.nodes.length <= 1 ? (
          <Centered>
            <p className="text-sm text-i3x-text-muted">
              {descendantsOnly ? 'No children.' : 'No relationships.'}
            </p>
            <p className="text-xs text-i3x-text-muted/70 mt-1">
              {descendantsOnly
                ? 'This element has nothing beneath it.'
                : 'This element has no links to any other object.'}
            </p>
          </Centered>
        ) : (
          layout && (
            <svg
              ref={svgRef}
              viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
              preserveAspectRatio="xMidYMid meet"
              // While a walk runs the old drawing is grayed right out, colour
              // and all, so it reads as the stale thing it is and the loader
              // isn't competing with a live-looking map underneath it.
              className={`w-full h-full select-none transition-opacity motion-reduce:transition-none ${
                isPanning ? 'cursor-grabbing' : 'cursor-grab'
              } ${isLoading ? 'grayscale opacity-10' : ''}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              role="img"
              aria-label={`${descendantsOnly ? 'Subtree of' : 'Relationship tree for'} ${root.displayName}, ${layout.nodes.length} objects within ${depth} hops`}
            >
              <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
                {/* Column guides: one per generation. Negative is upstream
                    (parents, to the left); positive is downstream (children). */}
                {layout.columns.map(column => {
                  const x = column * COLUMN_WIDTH
                  return (
                    <g key={column}>
                      {column !== 0 && (
                        <line
                          x1={x}
                          y1={layout.minY - V_PAD / 2}
                          x2={x}
                          y2={layout.maxY + V_PAD / 2}
                          stroke="rgb(var(--i3x-border))"
                          strokeWidth={1}
                          strokeDasharray="2,7"
                          opacity={0.4}
                        />
                      )}
                      <text
                        x={x}
                        y={layout.minY - V_PAD}
                        textAnchor="middle"
                        className="fill-i3x-text-muted"
                        fontSize={12}
                        opacity={0.7}
                      >
                        {column === 0 ? 'root' : column < 0 ? `${-column} up` : `${column} down`}
                      </text>
                    </g>
                  )
                })}

                {/* Edges: horizontal S-curves, one path per style. Tree edges read
                    solid-ish in the bucket color; cross-links are dashed and fainter. */}
                {edgeGroups.map(group => (
                  <path
                    key={group.key}
                    d={group.d}
                    fill="none"
                    stroke={BUCKET_COLOR[group.bucket]}
                    strokeDasharray={group.tree ? dashArray(group.bucket) : '3,4'}
                    strokeWidth={overview ? 1 : 1.5}
                    // Zoomed far out a scaled stroke shrinks below a pixel; hold it at a hairline.
                    vectorEffect={overview ? 'non-scaling-stroke' : undefined}
                    opacity={group.opacity}
                  />
                ))}

                {/* Zero-length round-capped strokes: a dot per object at a fixed screen size. */}
                {dotGroups.map(group => (
                  <path
                    key={group.fill}
                    d={group.d}
                    stroke={group.fill}
                    strokeWidth={4}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ))}

                {(overview ? (rootNode ? [rootNode] : []) : drawnNodes).map(node => (
                  <GraphNode
                    key={node.object.elementId}
                    node={node}
                    dimmed={dimmed(node.object.elementId)}
                    typeColor={
                      settings.colorByType && node.depth !== 0
                        ? typeColor(node.object.typeId, typeColorMap)
                        : null
                    }
                    baseOpacity={settings.fadeDistant ? depthOpacity(node.depth) : 1}
                    emphasized={
                      activeHoverId === node.object.elementId ||
                      (activeHoverId === null && focusId === node.object.elementId)
                    }
                    onHover={setHoverId}
                    onSelect={handleNodeClick}
                  />
                ))}
              </g>
            </svg>
          )
        )}

        {/* The walk is in flight: say so, over the grayed-out old drawing (the
            svg's own class does the graying, see above). Only showing this on
            the first walk meant a depth change (or any re-walk) sat there
            looking finished while a round trip per hop was still running. */}
        {!error && isLoading && layout && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center">
              <I3xLoader size={64} className="mx-auto" />
              <p className="mt-3 text-xs text-i3x-text-muted">Walking relationships…</p>
            </div>
          </div>
        )}

        {layout && layout.nodes.length > 1 && (
          <div className="absolute top-3 right-3 flex flex-col gap-1.5">
            <GraphButton label="Zoom in" onClick={() => zoomAbout(0, 0, 1.3)}>
              +
            </GraphButton>
            <GraphButton label="Zoom out" onClick={() => zoomAbout(0, 0, 0.77)}>
              −
            </GraphButton>
            <GraphButton
              label="Reset view"
              onClick={() => {
                setTransform({ scale: 1, x: 0, y: 0 })
                setFocusId(null)
              }}
            >
              <FrameIcon size={13} />
            </GraphButton>
            <GraphSettingsMenu
              getSvg={() => svgRef.current}
              rootName={root.displayName}
              viewSuffix="tree"
              legend={legendEntries}
            />
          </div>
        )}

        {!error && focusNode && focusSet && (
          <FocusBadge
            name={focusNode.object.displayName}
            count={focusSet.size}
            onClear={() => setFocusId(null)}
          />
        )}

        {hovered && (
          <div className="absolute left-3 top-3 max-w-[260px] bg-i3x-surface border border-i3x-border rounded-lg px-3 py-2 text-xs pointer-events-none">
            <b className="text-[13px] text-i3x-text block truncate">{hovered.object.displayName}</b>
            <div className="font-mono text-[11px] text-i3x-text-muted truncate">
              {hovered.object.typeId}
            </div>
            <div className="mt-1 text-i3x-text-muted">
              {hovered.depth === 0
                ? 'root'
                : `${hovered.depth} ${hovered.depth === 1 ? 'hop' : 'hops'} out`}{' '}
              · {hovered.degree} {hovered.degree === 1 ? 'link' : 'links'} · click to open
            </div>
          </div>
        )}

        {!hovered && !error && overview && layout && layout.nodes.length > 1 && (
          <div className="absolute left-3 bottom-3 bg-i3x-surface/90 border border-i3x-border rounded-lg px-3 py-1.5 text-[11px] text-i3x-text-muted pointer-events-none">
            {layout.nodes.length.toLocaleString()} objects · zoom in to read names and open them
          </div>
        )}

        {isDropTarget && (
          <div className="absolute inset-0 grid place-items-center bg-i3x-primary/5 pointer-events-none">
            <span className="bg-i3x-surface border border-i3x-primary rounded-lg px-3 py-2 text-xs text-i3x-text">
              Drop to root the tree here
            </span>
          </div>
        )}

        {settings.colorByType && layout && (
          <GraphTypeLegend
            entries={legendEntries}
            activeTypes={focusTypes}
            onToggle={toggleFocusType}
            onClear={() => setFocusTypes(new Set())}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Nodes are neutral so the edge colors carry the relationship, matching the
 * legend. Composition objects are hollow with a dashed border; the root is
 * filled in the primary color. The name sits to the right, inside the column.
 */
function GraphNodeView({
  node,
  dimmed,
  typeColor,
  baseOpacity,
  emphasized,
  onHover,
  onSelect,
}: {
  node: PositionedNode
  dimmed: boolean
  /** Resolved type color to tint the node with, or null for the neutral fill. */
  typeColor: string | null
  /** Fade factor from the depth ramp (1 when fading is off). */
  baseOpacity: number
  /** The active-hover node (map hover or a hovered list row). Gets a focus ring. */
  emphasized: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}) {
  const isRoot = node.depth === 0
  const isComposition = node.object.isComposition === true
  const fill = isRoot ? 'rgb(var(--i3x-primary))' : (typeColor ?? nodeFill(isComposition))
  const stroke = isRoot ? 'rgb(var(--i3x-primary))' : (typeColor ?? 'rgb(var(--i3x-text-muted))')

  return (
    <g
      data-node
      className="cursor-pointer"
      opacity={dimmed ? 0.2 : baseOpacity}
      onMouseEnter={() => onHover(node.object.elementId)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(node.object.elementId)}
    >
      {/* Focus ring, behind the node so the node sits on top. Makes the active
          element easy to find when the list, not the cursor, is driving the hover. */}
      {emphasized && (
        <circle
          cx={node.x}
          cy={node.y}
          r={node.radius + 4}
          fill="none"
          stroke="rgb(var(--i3x-primary))"
          strokeWidth={2}
        />
      )}
      <circle
        cx={node.x}
        cy={node.y}
        r={node.radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={isComposition && !isRoot ? COMPOSITION_DASH.join(',') : undefined}
      />
      {/* A fat transparent disc: a tiny circle is a miserable hover target. */}
      <circle cx={node.x} cy={node.y} r={Math.max(node.radius + 7, 12)} fill="transparent" />
      <text
        x={node.x + node.radius + LABEL_GAP}
        y={node.y}
        textAnchor="start"
        dominantBaseline="middle"
        fontSize={FONT}
        className={
          isRoot
            ? 'fill-i3x-text font-semibold'
            : emphasized
              ? 'fill-i3x-primary font-medium'
              : 'fill-i3x-text'
        }
        style={{
          paintOrder: 'stroke',
          stroke: 'rgb(var(--i3x-bg))',
          strokeWidth: 4,
          strokeLinejoin: 'round',
        }}
      >
        {truncateLabel(node.object.displayName)}
        {node.collapsedLeaves ? (
          <tspan className="fill-i3x-text-muted" fontSize={FONT - 2}>
            {'  +'}
            {node.collapsedLeaves}
          </tspan>
        ) : null}
      </text>
    </g>
  )
}

// Props are primitives and stable callbacks, so a pan or hover only re-renders nodes whose look changed.
const GraphNode = memo(GraphNodeView)

function GraphButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="w-8 h-8 grid place-items-center border border-i3x-border bg-i3x-surface rounded-lg text-i3x-text-muted hover:bg-i3x-bg hover:text-i3x-text transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  // One inner block, so multiple children (logo + caption, or a two-line
  // empty state) stack tightly instead of becoming separate grid rows that
  // split the panel's full height between them.
  return (
    <div className="h-full grid place-items-center text-center px-6">
      <div>{children}</div>
    </div>
  )
}

/** A very long name is clipped here; the hover card carries the full one. */
function truncateLabel(name: string, max = MAX_LABEL_CHARS): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}
