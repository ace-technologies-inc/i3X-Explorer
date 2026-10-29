import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectInstance } from '../../api/types'
import { BUCKET_COLOR, BUCKET_DASH, nodeFill, type RelationshipBucket } from './relationshipColors'
import { COMPOSITION_DASH } from './relationshipColors'
import { descendantIds, type EgoGraph } from './egoGraph'
import { layoutRadial, MAX_LABEL_CHARS, type PositionedNode } from './radialLayout'
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

const MIN_SCALE = 0.35
const MAX_SCALE = 40

/**
 * Semantic zoom: node positions live in diagram units, but dots, labels and
 * strokes are drawn at constant SCREEN size, their unit size is divided by
 * the zoom and calibrated against the measured pane (its minor dimension), so
 * "11px" text really renders at 11 CSS px on any pane. FALLBACK_PANE covers
 * the frame before the ResizeObserver's first measurement.
 */
const FALLBACK_PANE = 760

/** Screen px of headroom around the outer ring at fit, for its outward labels. */
const FIT_PAD_PX = 72

/**
 * A node's label appears when its angular slot × ring radius clears this many
 * reference px at the current zoom. Hubs own wide slots and label first; the
 * rest resolve as you zoom in.
 */
const LABEL_MIN_PX = 30
const LABEL_PX = 11

/** Room a framed branch leaves around itself, as a fraction of the pane. */
const FOCUS_MARGIN = 0.86

/**
 * Screen px around the pane within which labeled nodes stay elements, so a label
 * running in from just off screen still draws. Also the snap a pan has to cross
 * before the culled set is recomputed.
 */
const CULL_MARGIN_PX = 180

export interface RadialGraphProps {
  /** The element at the center: the selected object, or whatever was dropped in. */
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
  /** Re-root the walk here without navigating away: a node click, or a canvas drop. */
  onRootElement: (elementId: string) => void
  /** Kept for prop parity with the tree view; the rings view re-roots on click. */
  onSelectElement: (elementId: string) => void
  /**
   * An element hovered outside the map, such as a row in the relationships list.
   * The map highlights it as if it were hovered here. A real hover on the map
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
 * The depth-N relationship map for one element, drawn as a radial map.
 *
 * Rings are hops: the root at the center, its direct relationships on ring 1,
 * theirs on ring 2, and so on. Rings are fixed and compact, and everything is
 * drawn at constant screen size, so the fitted view is always a readable
 * overview no matter the fan-out: a 1,000-child ring reads as a dense band
 * with its hubs labeled, and zooming is the microscope that separates and
 * labels the rest (label culling is by angular slot, see radialLayout).
 * Edge color is the relationship bucket, read from the inner node outward,
 * matching the legend below the card. This is the "rings" view; the "tree"
 * view (`TreeGraph`) is the other option in the toggle.
 */
export function RadialGraph({
  root,
  graph,
  isLoading,
  error,
  depth,
  onRootElement,
  externalHoverId,
  locate,
}: RadialGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [isDropTarget, setIsDropTarget] = useState(false)
  // The branch a subtree focus is holding lit. View state, not walk state: the
  // graph is untouched, the rest of it is simply dimmed around this one.
  const [focusId, setFocusId] = useState<string | null>(null)
  // Types picked in the legend to focus; everything else dims. View-only.
  const [focusTypes, setFocusTypes] = useState<Set<string>>(() => new Set())

  // Actual pane size (CSS px, minor dimension). All semantic-zoom sizing and
  // the fit pad are calibrated against it.
  const paneRef = useRef<HTMLDivElement>(null)
  const [pane, setPane] = useState({ width: FALLBACK_PANE, height: FALLBACK_PANE })
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setPane({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const paneMin = Math.min(pane.width, pane.height)

  const settings = useGraphSettings()

  // The walk with the map's display settings applied (leaves folded, siblings
  // reordered). Map-only: the list beside it reads the untransformed walk. Keyed
  // on the primitive settings so the object's fresh identity each render doesn't
  // re-run the transform.
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
    () => (displayGraph ? traceSpan('rings layout', () => layoutRadial(displayGraph)) : null),
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

  // zoomAbout reads the adaptive ceiling through a ref so its identity stays
  // stable (the wheel listener depends on it). The ref is assigned below, once
  // the layout-derived ceiling is computed.
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
    // `error` is a dep so a failed re-walk (which unmounts the svg but keeps
    // the old layout) still runs the cleanup and drops the listener.
    if (!svg || !layout || error) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const [ux, uy] = toUserSpace(event.clientX, event.clientY)
      zoomAbout(ux, uy, event.deltaY < 0 ? 1.12 : 0.89)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [layout, error, toUserSpace, zoomAbout])

  const panOrigin = useRef<[number, number] | null>(null)

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('[data-node]')) return
    panOrigin.current = toUserSpace(event.clientX, event.clientY)
    setIsPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!panOrigin.current) {
      // Unlabeled nodes are dots in a shared path with no handlers; hover finds them here.
      if (!(event.target as Element).closest('[data-node]')) {
        setHoverId(pickNode(event.clientX, event.clientY))
      }
      return
    }
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
    event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)

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
    if (elementId) onRootElement(elementId)
  }

  // Clicking a node digs down: re-root the walk here, exactly like dropping the
  // node onto the canvas, so exploring stays on this page.
  const handleNodeClick = useCallback(
    (elementId: string) => onRootElement(elementId),
    [onRootElement]
  )

  // A row hovered in the list highlights here just like a map hover, but an actual
  // hover on the map wins. BOTH sources are validated against the drawn set: the
  // map's own hoverId goes stale when a re-root or depth change replaces the
  // layout while the cursor sits on an old node (mouseleave never fires for
  // unmounts), and an undrawn id would dim the entire map with nothing lit.
  const mapHoverId = hoverId && nodeById.has(hoverId) ? hoverId : null
  const activeHoverId =
    mapHoverId ?? (externalHoverId && nodeById.has(externalHoverId) ? externalHoverId : null)

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

  // Fit extent: the outer ring plus FIT_PAD_PX of *screen* headroom for its
  // outward labels. Solved in units (extent = outer + padPx·2·extent/pane) so
  // the pad holds its screen size at any depth; the denominator floor keeps a
  // tiny pane from inflating the extent without bound.
  const outerRadius = layout?.outerRadius ?? 200
  const extent = outerRadius / Math.max(0.5, 1 - (2 * FIT_PAD_PX) / paneMin)

  // Everything screen-sized is some multiple of this: px × unitOverScale =
  // diagram units that render at px CSS pixels at the current zoom.
  const unitOverScale = (extent * 2) / paneMin / transform.scale

  // The zoom ceiling adapts to the densest slot: MAX_SCALE is the floor, but a
  // crowded ring needs more before its sliver slots can label and separate,
  // a hard cap there would leave those nodes unreachable at any zoom.
  const maxScale = useMemo(() => {
    if (!layout) return MAX_SCALE
    let tightestArc = Infinity
    for (const node of layout.nodes) {
      if (node.depth === 0) continue
      const arc = Math.hypot(node.x, node.y) * node.slot
      if (arc > 0 && arc < tightestArc) tightestArc = arc
    }
    if (!Number.isFinite(tightestArc)) return MAX_SCALE
    const needed = ((LABEL_MIN_PX * (extent * 2)) / paneMin / tightestArc) * 1.3
    return Math.max(MAX_SCALE, needed)
  }, [layout, extent, paneMin])
  maxScaleRef.current = maxScale

  // Which labels fit at this zoom. Quantized so the set doesn't churn (and the
  // memo doesn't recompute) on every wheel tick; pan never recomputes it.
  const scaleKey = Math.round(transform.scale * 8) / 8
  const labeledIds = useMemo(() => {
    const set = new Set<string>()
    if (!layout) return set
    const minArcUnits = (LABEL_MIN_PX * (extent * 2)) / paneMin / scaleKey
    for (const node of layout.nodes) {
      if (node.depth === 0 || Math.hypot(node.x, node.y) * node.slot >= minArcUnits) {
        set.add(node.object.elementId)
      }
    }
    return set
  }, [layout, extent, paneMin, scaleKey])

  // Dense edge fans get lighter ink so the rings stay readable underneath.
  const edgeCount = layout?.edges.length ?? 0
  const baseEdgeOpacity = edgeCount > 600 ? 0.4 : edgeCount > 250 ? 0.6 : 0.85

  // Legend type-focus: a node whose type isn't picked is dimmed (root kept).
  const typeFocusActive = settings.colorByType && focusTypes.size > 0
  const toggleFocusType = (typeId: string) =>
    setFocusTypes(prev => {
      const next = new Set(prev)
      if (next.has(typeId)) next.delete(typeId)
      else next.add(typeId)
      return next
    })

  // Hovering is the live gesture, so it takes over the dimming while it lasts;
  // the focus comes back the moment the cursor leaves. A legend type-focus dims
  // on top of either.
  const isDim = useCallback(
    (id: string) => {
      const base =
        activeHoverId !== null
          ? id !== activeHoverId && !hoveredNeighbors?.has(id)
          : focusSet !== null && !focusSet.has(id)
      if (base) return true
      if (!typeFocusActive) return false
      const node = nodeById.get(id)
      return !!node && node.depth !== 0 && !focusTypes.has(node.object.typeId)
    },
    [activeHoverId, hoveredNeighbors, focusSet, typeFocusActive, focusTypes, nodeById]
  )

  const edgeGroups = useMemo(() => {
    if (!layout) return []
    const groups = new Map<string, { key: string; bucket: RelationshipBucket; opacity: number; parts: string[] }>()
    for (const edge of layout.edges) {
      const distance = settings.fadeDistant
        ? Math.min(
            depthOpacity(nodeById.get(edge.source)?.depth ?? 0),
            depthOpacity(nodeById.get(edge.target)?.depth ?? 0)
          )
        : 1
      const opacity = isDim(edge.source) && isDim(edge.target) ? 0.1 : baseEdgeOpacity * distance
      const key = `${edge.bucket}|${opacity}`
      let group = groups.get(key)
      if (!group) {
        group = { key, bucket: edge.bucket, opacity, parts: [] }
        groups.set(key, group)
      }
      group.parts.push(`M${edge.x1},${edge.y1}L${edge.x2},${edge.y2}`)
    }
    return [...groups.values()].map(({ parts, ...group }) => ({ ...group, d: parts.join('') }))
  }, [layout, isDim, baseEdgeOpacity, settings.fadeDistant, nodeById])

  // The pane in diagram units, widened by the cull margin and snapped to it.
  const cell = CULL_MARGIN_PX * unitOverScale
  const halfW = (pane.width * extent) / paneMin
  const halfH = (pane.height * extent) / paneMin
  const toDiagram = (user: number, offset: number) => (user - offset) / transform.scale
  const cullMinX = (Math.floor(toDiagram(-halfW, transform.x) / cell) - 1) * cell
  const cullMaxX = (Math.ceil(toDiagram(halfW, transform.x) / cell) + 1) * cell
  const cullMinY = (Math.floor(toDiagram(-halfH, transform.y) / cell) - 1) * cell
  const cullMaxY = (Math.ceil(toDiagram(halfH, transform.y) / cell) + 1) * cell

  // Elements only for what can be read or touched: the root, the hovered node, and
  // labeled or lit nodes on screen. Everything else is a dot in a shared path, so
  // the DOM is bounded by the pane rather than by the walk.
  const drawnNodes = useMemo(() => {
    if (!layout) return []
    return layout.nodes.filter(node => {
      const id = node.object.elementId
      if (node.depth === 0 || id === activeHoverId) return true
      const lit = activeHoverId === null && focusSet !== null && focusSet.has(id)
      if (!lit && !labeledIds.has(id)) return false
      return node.x >= cullMinX && node.x <= cullMaxX && node.y >= cullMinY && node.y <= cullMaxY
    })
  }, [layout, activeHoverId, focusSet, labeledIds, cullMinX, cullMaxX, cullMinY, cullMaxY])

  // Dots are zero-length round-capped strokes held at screen size, so zooming
  // never rebuilds them; a ring in the stroke color under a fill-colored core.
  const dotGroups = useMemo(() => {
    if (!layout) return []
    const drawn = new Set(drawnNodes.map(node => node.object.elementId))
    const groups = new Map<
      string,
      { key: string; fill: string; stroke: string; radius: number; opacity: number; parts: string[] }
    >()
    for (const node of layout.nodes) {
      const id = node.object.elementId
      if (drawn.has(id)) continue
      const tint = settings.colorByType ? typeColor(node.object.typeId, typeColorMap) : null
      const fill = tint ?? nodeFill(node.object.isComposition === true)
      const stroke = tint ?? 'rgb(var(--i3x-text-muted))'
      const radius = Math.round(dotRadiusPx(node) * 2) / 2
      const opacity = isDim(id) ? 0.2 : settings.fadeDistant ? depthOpacity(node.depth) : 1
      const key = `${fill}|${stroke}|${radius}|${opacity}`
      let group = groups.get(key)
      if (!group) {
        group = { key, fill, stroke, radius, opacity, parts: [] }
        groups.set(key, group)
      }
      group.parts.push(`M${node.x},${node.y}h0`)
    }
    return [...groups.values()].map(({ parts, ...group }) => ({ ...group, d: parts.join('') }))
  }, [layout, drawnNodes, isDim, settings.colorByType, settings.fadeDistant, typeColorMap])

  // The node whose hover target covers this point, nearest first, or null.
  const pickNode = (clientX: number, clientY: number): string | null => {
    if (!layout) return null
    const [ux, uy] = toUserSpace(clientX, clientY)
    const x = (ux - transform.x) / transform.scale
    const y = (uy - transform.y) / transform.scale
    let best: string | null = null
    let bestDistance = Infinity
    for (const node of layout.nodes) {
      const distance = Math.hypot(node.x - x, node.y - y)
      if (distance < bestDistance && distance <= hitRadius(node, unitOverScale)) {
        best = node.object.elementId
        bestDistance = distance
      }
    }
    return best
  }
  // Locator: a search pick centres the view on that node and zooms far enough in
  // that its own label resolves (the 1.6× headroom over the label gate survives
  // because the clamp is the adaptive ceiling, which always covers the tightest
  // slot). The token ref starts at the mount-time token so a remount (the
  // Tree/Rings toggle) doesn't re-answer an old request; a pick that isn't drawn
  // is answered late while the walk is still loading, but once the walk settles
  // without it, it's marked handled so a later deeper walk can't replay a
  // long-forgotten jump.
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
      const ring = Math.hypot(node.x, node.y)
      const needed =
        ring > 0 && node.slot > 0
          ? (LABEL_MIN_PX * 1.6 * (extent * 2)) / paneMin / (ring * node.slot)
          : 2.5
      const scale = Math.max(2.5, Math.min(maxScale, needed))
      setTransform({ scale, x: -node.x * scale, y: -node.y * scale })
      return
    }

    // Frame the branch. On rings a subtree is an arc rather than a block, so
    // this is its bounding box; the floor keeps a single leaf (a box of zero
    // extent) from being zoomed to the ceiling.
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
    const span = extent * 2
    const boxW = Math.max(maxX - minX, span / 8)
    const boxH = Math.max(maxY - minY, span / 8)
    const scale = Math.max(
      MIN_SCALE,
      Math.min(maxScale, Math.min(span / boxW, span / boxH) * FOCUS_MARGIN)
    )
    setFocusId(node.object.elementId)
    setTransform({
      scale,
      x: -((minX + maxX) / 2) * scale,
      y: -((minY + maxY) / 2) * scale,
    })
  }, [locate, nodeById, layout, extent, paneMin, maxScale, isLoading])

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
            <p className="text-sm text-i3x-text-muted">No relationships.</p>
            <p className="text-xs text-i3x-text-muted/70 mt-1">
              This element has no links to any other object.
            </p>
          </Centered>
        ) : (
          layout && (
            <svg
              ref={svgRef}
              viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
              // Fit the whole graph in view, centered, so everything is always
              // visible. A wide pane gets side margins rather than cropping nodes.
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
              onPointerLeave={() => setHoverId(null)}
              role="img"
              aria-label={`Relationship map for ${root.displayName}, ${layout.nodes.length} objects within ${depth} hops`}
            >
              <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
                {layout.rings.map(ring => (
                  <g key={ring.depth}>
                    <circle
                      cx={0}
                      cy={0}
                      r={ring.radius}
                      fill="none"
                      stroke="rgb(var(--i3x-border))"
                      strokeWidth={unitOverScale}
                      strokeDasharray={`${2 * unitOverScale},${6 * unitOverScale}`}
                      opacity={0.6}
                    />
                    {/* Anchored due north, where the sector allocation leaves a seam.
                        The count says what a dense band actually holds. */}
                    <text
                      x={0}
                      y={-ring.radius - 6 * unitOverScale}
                      textAnchor="middle"
                      className="fill-i3x-text-muted"
                      fontSize={9.5 * unitOverScale}
                      opacity={0.75}
                    >
                      {ring.depth} {ring.depth === 1 ? 'hop' : 'hops'} ·{' '}
                      {ring.count.toLocaleString()}
                    </text>
                  </g>
                ))}

                {edgeGroups.map(group => {
                  const dash = BUCKET_DASH[group.bucket]
                  return (
                    <path
                      key={group.key}
                      d={group.d}
                      fill="none"
                      stroke={BUCKET_COLOR[group.bucket]}
                      strokeDasharray={dash ? dash.map(d => d * unitOverScale).join(',') : undefined}
                      strokeWidth={1.3 * unitOverScale}
                      opacity={group.opacity}
                    />
                  )
                })}

                {dotGroups.map(group => (
                  <g key={group.key} opacity={group.opacity} pointerEvents="none">
                    <path
                      d={group.d}
                      stroke={group.stroke}
                      strokeWidth={group.radius * 2 + 1.5}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={group.d}
                      stroke={group.fill}
                      strokeWidth={group.radius * 2 - 1.5}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ))}

                {drawnNodes.map(node => {
                  const id = node.object.elementId
                  // While a focus is held, its own node reads as the emphasized one, and the
                  // lit branch keeps its labels regardless of how tight its slots are.
                  const focused = activeHoverId === null && focusSet !== null && focusSet.has(id)
                  return (
                    <GraphNode
                      key={id}
                      node={node}
                      unitOverScale={unitOverScale}
                      dimmed={isDim(id)}
                      typeColor={
                        settings.colorByType && node.depth !== 0
                          ? typeColor(node.object.typeId, typeColorMap)
                          : null
                      }
                      baseOpacity={settings.fadeDistant ? depthOpacity(node.depth) : 1}
                      emphasized={activeHoverId === id || (focused && id === focusId)}
                      showLabel={labeledIds.has(id) || activeHoverId === id || focused}
                      onHover={setHoverId}
                      onSelect={handleNodeClick}
                    />
                  )
                })}
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

        {/* Overlays are gated on !error too: a failed re-walk keeps the old
            layout but unmounts the svg, and buttons floating over the error
            message would mutate pan/zoom for a map that isn't there. */}
        {!error && layout && layout.nodes.length > 1 && (
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
              viewSuffix="rings"
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

        {!error && hovered && (
          <div className="absolute left-3 top-3 max-w-[260px] bg-i3x-surface border border-i3x-border rounded-lg px-3 py-2 text-xs pointer-events-none">
            <b className="text-[13px] text-i3x-text block truncate">{hovered.object.displayName}</b>
            <div className="font-mono text-[11px] text-i3x-text-muted truncate">
              {hovered.object.typeId}
            </div>
            <div className="mt-1 text-i3x-text-muted">
              {hovered.depth === 0
                ? 'center'
                : `${hovered.depth} ${hovered.depth === 1 ? 'hop' : 'hops'} out`}{' '}
              · {hovered.degree} {hovered.degree === 1 ? 'link' : 'links'} · click to open
            </div>
          </div>
        )}

        {isDropTarget && (
          <div className="absolute inset-0 grid place-items-center bg-i3x-primary/5 pointer-events-none">
            <span className="bg-i3x-surface border border-i3x-primary rounded-lg px-3 py-2 text-xs text-i3x-text">
              Drop to center the map here
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
 * filled in the primary color. All sizes are screen-constant (unitOverScale),
 * so a dot is the same 8px whether the map is fitted or at 40×. Memoized:
 * panning changes no prop, so the pan path never re-renders node subtrees.
 */
const GraphNode = memo(function GraphNode({
  node,
  unitOverScale,
  dimmed,
  typeColor,
  baseOpacity,
  emphasized,
  showLabel,
  onHover,
  onSelect,
}: {
  node: PositionedNode
  /** Diagram units per reference-pane px at the current zoom. */
  unitOverScale: number
  dimmed: boolean
  /** Resolved type color to tint the node with, or null for the neutral fill. */
  typeColor: string | null
  /** Fade factor from the depth ramp (1 when fading is off). */
  baseOpacity: number
  /** The active-hover node (map hover or a hovered list row). Gets a focus ring. */
  emphasized: boolean
  showLabel: boolean
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}) {
  const px = (n: number) => n * unitOverScale
  const isRoot = node.depth === 0
  const isComposition = node.object.isComposition === true
  const dotRadius = px(dotRadiusPx(node))
  // Push the label out along the node's own bearing, and flip its anchor across
  // the vertical axis so it always reads away from the center.
  const outward = isRoot ? 0 : dotRadius + px(6)
  const labelX = node.x + Math.cos(node.angle) * outward
  const labelY = isRoot ? node.y - dotRadius - px(7) : node.y + Math.sin(node.angle) * outward
  const anchor = isRoot ? 'middle' : Math.cos(node.angle) >= 0 ? 'start' : 'end'

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
          r={dotRadius + px(5)}
          fill="none"
          stroke="rgb(var(--i3x-primary))"
          strokeWidth={px(2)}
        />
      )}
      <circle
        cx={node.x}
        cy={node.y}
        r={dotRadius}
        fill={isRoot ? 'rgb(var(--i3x-primary))' : (typeColor ?? nodeFill(isComposition))}
        stroke={isRoot ? 'rgb(var(--i3x-primary))' : (typeColor ?? 'rgb(var(--i3x-text-muted))')}
        strokeWidth={px(1.5)}
        strokeDasharray={
          isComposition && !isRoot ? COMPOSITION_DASH.map(d => px(d)).join(',') : undefined
        }
      />
      {/* A fat transparent disc: a 5px circle is a miserable hover target. On a
          crowded ring the disc shrinks to the node's own angular slot, so discs
          tile instead of stacking, the hover lands on the node nearest the
          cursor rather than whichever painted last, and a pan can start just
          off the band instead of everything on it counting as a node press. */}
      <circle cx={node.x} cy={node.y} r={hitRadius(node, unitOverScale)} fill="transparent" />
      {showLabel && (
        <text
          x={labelX}
          y={labelY}
          textAnchor={anchor}
          dominantBaseline="middle"
          fontSize={px(LABEL_PX)}
          className={
            isRoot
              ? 'fill-i3x-text font-medium'
              : emphasized
                ? 'fill-i3x-primary font-medium'
                : 'fill-i3x-text'
          }
          style={{
            paintOrder: 'stroke',
            stroke: 'rgb(var(--i3x-bg))',
            strokeWidth: px(3),
            strokeLinejoin: 'round',
          }}
        >
          {truncateLabel(node.object.displayName)}
          {node.collapsedLeaves ? (
            <tspan className="fill-i3x-text-muted" fontSize={px(LABEL_PX - 2)}>
              {'  +'}
              {node.collapsedLeaves}
            </tspan>
          ) : null}
        </text>
      )}
    </g>
  )
})

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

/** A node's dot radius in screen px: the root is large, hubs grow with their links. */
function dotRadiusPx(node: PositionedNode): number {
  return node.depth === 0 ? 10 : 4 + Math.min(Math.sqrt(node.degree) * 1.2, 4)
}

/**
 * A node's hover target, in diagram units: generous around a small dot, but on a
 * crowded ring no wider than the node's own angular slot, so targets tile
 * instead of stacking and the hover lands on the node nearest the cursor.
 */
function hitRadius(node: PositionedNode, unitOverScale: number): number {
  const dot = dotRadiusPx(node) * unitOverScale
  const generous = Math.max(dot + 7 * unitOverScale, 13 * unitOverScale)
  if (node.depth === 0) return generous
  return Math.min(generous, Math.max(dot + 2 * unitOverScale, (Math.hypot(node.x, node.y) * node.slot) / 2))
}
