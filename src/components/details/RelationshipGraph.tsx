import { useState, useEffect, useMemo } from 'react'
import type { ObjectInstance } from '../../api/types'
import { getClient } from '../../api/client'
import { useExplorerStore } from '../../stores/explorer'

interface RelationshipGraphProps {
  object: ObjectInstance
}

interface RelatedObject {
  elementId: string
  displayName: string
  typeId: string
  isComposition: boolean
  parentId?: string | null
  relationshipType: string
}

// Layout constants
const BOX_WIDTH = 140
const BOX_HEIGHT = 50
const RADIUS = 150
// Horizontal radius is stretched so star-shaped graphs (many spokes) get extra
// horizontal wiggle room without growing taller. Tune this to taste.
const RADIUS_X = RADIUS * 1.15
// Breathing room around the content, and the gap between the node cluster and
// the legend band beneath it.
const CANVAS_PAD = 16
const LEGEND_GAP = 16
// The legend is a fixed-size band centered along the bottom; the canvas can't be
// narrower than this no matter how few nodes there are.
const LEGEND_WIDTH = 360
const LEGEND_HEIGHT = 40
const LEGEND_ROW_GAP = 23

// Colors — reference CSS variables so they respond to the active theme
const COLORS = {
  primary:   'rgb(var(--i3x-primary))',
  secondary: 'rgb(var(--i3x-secondary))',
  success:   'rgb(var(--i3x-success))',
  warning:   'rgb(var(--i3x-warning))',
  error:     'rgb(var(--i3x-error))',
  bg:        'rgb(var(--i3x-bg))',
  surface:   'rgb(var(--i3x-surface))',
  border:    'rgb(var(--i3x-border))',
  text:      'rgb(var(--i3x-text))',
  textMuted: 'rgb(var(--i3x-text-muted))',
}

export function RelationshipGraph({ object }: RelationshipGraphProps) {
  const [relatedObjects, setRelatedObjects] = useState<RelatedObject[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ label: string; x: number; y: number } | null>(null)
  const { allObjects, selectItem, setAllObjects, setHierarchicalRoots } = useExplorerStore()

  const handleNodeClick = async (related: RelatedObject) => {
    const client = getClient()
    if (!client) return

    try {
      // Resolve the full object (use cache if available)
      const cached = allObjects.find(o => o.elementId === related.elementId)
      const obj: ObjectInstance = cached ?? await client.getObject(related.elementId)

      // Guard: ensure allObjects is populated
      let knownObjects = useExplorerStore.getState().allObjects
      if (knownObjects.length === 0) {
        knownObjects = await client.getObjects()
        setAllObjects(knownObjects)
      }

      // Guard: ensure hierarchicalRoots is populated (independent of allObjects check)
      let roots = useExplorerStore.getState().hierarchicalRoots
      if (roots.length === 0) {
        roots = await client.getObjects(undefined, false, true)
        setHierarchicalRoots(roots)
      }

      // Build full expanded set in one pass
      const { expandedNodes } = useExplorerStore.getState()
      const newExpanded = new Set(expandedNodes)
      newExpanded.add('folder:hierarchical')

      const visited = new Set<string>()
      let current = obj
      while (current.parentId && current.parentId !== '/' && !visited.has(current.elementId)) {
        visited.add(current.elementId)
        const parent = knownObjects.find(o => o.elementId === current.parentId)
        if (!parent) break
        newExpanded.add(`hier:${parent.elementId}`)
        current = parent
      }

      // Single write then select — state must be set before the selection fires
      useExplorerStore.setState({ expandedNodes: newExpanded })
      selectItem({ type: 'object', id: `hier:${obj.elementId}`, data: obj })
    } catch (err) {
      console.error('Failed to navigate to node:', err)
    }
  }

  useEffect(() => {
    loadRelationships()
  }, [object.elementId])

  const loadRelationships = async () => {
    const client = getClient()
    if (!client) return

    setIsLoading(true)
    setError(null)

    try {
      // Get all related objects with a single API call (no relationship type filter)
      const related = await client.getRelatedObjects(object.elementId)

      // Map to our RelatedObject format
      const graphRelationships: RelatedObject[] = related.map(r => ({
        elementId: r.elementId,
        displayName: r.displayName,
        typeId: r.typeId,
        isComposition: r.isComposition,
        parentId: r.parentId,
        // Use sourceRelationship from v1 API if available; fall back to heuristic for v0
        relationshipType: r.sourceRelationship ?? (
          r.parentId === object.elementId ? 'HasComponent' :
          object.parentId === r.elementId ? 'HasParent' : 'Related'
        )
      }))

      setRelatedObjects(graphRelationships)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load relationships')
    } finally {
      setIsLoading(false)
    }
  }

  // Derive the whole canvas from how far the node circle actually reaches, then
  // place the cluster dead-center (horizontally and vertically) with the legend
  // band centered along the bottom. Few or vertically-stacked nodes don't reach
  // the full radius, so the canvas shrinks to fit — and the nodes never drift to
  // one side, because the center is always the canvas center.
  const { width, height, centerX, centerY, positions, legendX, legendY } = useMemo(() => {
    let halfX = BOX_WIDTH / 2
    let halfY = BOX_HEIGHT / 2
    const offsets = relatedObjects.map((_, index) => {
      const angle = (2 * Math.PI * index) / relatedObjects.length - Math.PI / 2
      const ox = RADIUS_X * Math.cos(angle)
      const oy = RADIUS * Math.sin(angle)
      halfX = Math.max(halfX, Math.abs(ox) + BOX_WIDTH / 2)
      halfY = Math.max(halfY, Math.abs(oy) + BOX_HEIGHT / 2)
      return { ox, oy }
    })
    const width = Math.max(halfX * 2, LEGEND_WIDTH) + CANVAS_PAD * 2
    const height = CANVAS_PAD + halfY * 2 + LEGEND_GAP + LEGEND_HEIGHT + CANVAS_PAD
    const centerX = width / 2
    const centerY = CANVAS_PAD + halfY
    return {
      width,
      height,
      centerX,
      centerY,
      positions: offsets.map(({ ox, oy }) => ({ x: centerX + ox, y: centerY + oy })),
      legendX: (width - LEGEND_WIDTH) / 2,
      legendY: height - CANVAS_PAD - LEGEND_HEIGHT,
    }
  }, [relatedObjects])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-i3x-text-muted">
        Loading relationships...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-i3x-error">
        {error}
      </div>
    )
  }

  if (relatedObjects.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-i3x-text-muted">
        No graph relationships
      </div>
    )
  }

  return (
    <div
      className="relative"
      onMouseMove={(e) => {
        if (tooltip) {
          const rect = e.currentTarget.getBoundingClientRect()
          setTooltip(t => t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
        }
      }}
      onMouseLeave={() => setTooltip(null)}
    >
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 12,
            top: tooltip.y - 36,
            pointerEvents: 'none',
            zIndex: 10,
          }}
          className="px-2 py-1 text-xs rounded shadow-lg bg-i3x-surface border border-i3x-border text-i3x-text whitespace-nowrap"
        >
          {tooltip.label}
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ maxWidth: '100%', height: 'auto', backgroundColor: COLORS.surface, borderRadius: '6px' }}
      >
        {/* Connection lines */}
        {positions.map((pos, index) => {
          const related = relatedObjects[index]
          const isParent = related.relationshipType === 'HasParent' || related.relationshipType === 'ComponentOf'
          const isChild = related.relationshipType === 'HasChildren' || related.relationshipType === 'HasComponent' || related.relationshipType === 'InheritedBy'
          const isInherited = related.relationshipType === 'InheritsFrom'
          const strokeColor = isParent ? COLORS.warning : isChild ? COLORS.success : isInherited ? COLORS.primary : COLORS.border

          return (
            <line
              key={`line-${index}`}
              x1={centerX}
              y1={centerY}
              x2={pos.x}
              y2={pos.y}
              stroke={strokeColor}
              strokeWidth="2"
              strokeDasharray={isParent || isChild ? "none" : "5,5"}
            />
          )
        })}

        {/* Center object (selected) */}
        <g
          transform={`translate(${centerX - BOX_WIDTH / 2}, ${centerY - BOX_HEIGHT / 2})`}
          onMouseEnter={(e) => {
            const rect = e.currentTarget.closest('.relative')!.getBoundingClientRect()
            setTooltip({ label: object.displayName, x: e.clientX - rect.left, y: e.clientY - rect.top })
          }}
          onMouseLeave={() => setTooltip(null)}
        >
          <rect
            width={BOX_WIDTH}
            height={BOX_HEIGHT}
            rx="6"
            fill={COLORS.primary}
            stroke={COLORS.primary}
            strokeWidth="2"
            strokeDasharray={object.isComposition ? '6,3' : 'none'}
          />
          <text
            x={BOX_WIDTH / 2}
            y={BOX_HEIGHT / 2 - 6}
            textAnchor="middle"
            fill="white"
            fontSize="11"
            fontWeight="600"
          >
            {truncateText(object.displayName, 18)}
          </text>
          <text
            x={BOX_WIDTH / 2}
            y={BOX_HEIGHT / 2 + 10}
            textAnchor="middle"
            fill="rgba(255,255,255,0.7)"
            fontSize="9"
          >
            (selected)
          </text>
        </g>

        {/* Related objects */}
        {relatedObjects.map((related, index) => {
          const pos = positions[index]
          const isParent = related.relationshipType === 'HasParent' || related.relationshipType === 'ComponentOf'
          const isChild = related.relationshipType === 'HasChildren' || related.relationshipType === 'HasComponent' || related.relationshipType === 'InheritedBy'
          const isInherited = related.relationshipType === 'InheritsFrom'

          // Color code by relationship type
          const strokeColor = isParent ? COLORS.warning : isChild ? COLORS.success : isInherited ? COLORS.primary : COLORS.border

          return (
            <g
              key={`${related.elementId}-${related.relationshipType}`}
              transform={`translate(${pos.x - BOX_WIDTH / 2}, ${pos.y - BOX_HEIGHT / 2})`}
              style={{ cursor: 'pointer' }}
              onClick={() => handleNodeClick(related)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.closest('.relative')!.getBoundingClientRect()
                setTooltip({ label: related.displayName, x: e.clientX - rect.left, y: e.clientY - rect.top })
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <rect
                width={BOX_WIDTH}
                height={BOX_HEIGHT}
                rx="6"
                fill={related.isComposition ? COLORS.bg : COLORS.surface}
                stroke={strokeColor}
                strokeWidth="2"
                strokeDasharray={related.isComposition ? '6,3' : 'none'}
              />
              <text
                x={BOX_WIDTH / 2}
                y={BOX_HEIGHT / 2 - 6}
                textAnchor="middle"
                fill={COLORS.text}
                fontSize="11"
                fontWeight="500"
              >
                {truncateText(related.displayName, 18)}
              </text>
              <text
                x={BOX_WIDTH / 2}
                y={BOX_HEIGHT / 2 + 10}
                textAnchor="middle"
                fill={COLORS.textMuted}
                fontSize="9"
              >
                {related.relationshipType}
              </text>
            </g>
          )
        })}

        {/* Legend — centered along the bottom */}
        <g transform={`translate(${legendX}, ${legendY})`}>
          <line x1="0" y1="10" x2="25" y2="10" stroke={COLORS.warning} strokeWidth="2" />
          <text x="30" y="14" fill={COLORS.textMuted} fontSize="10">Parent/ComponentOf</text>

          <line x1="140" y1="10" x2="165" y2="10" stroke={COLORS.success} strokeWidth="2" />
          <text x="170" y="14" fill={COLORS.textMuted} fontSize="10">Child</text>

          <line x1="210" y1="10" x2="235" y2="10" stroke={COLORS.primary} strokeWidth="2" />
          <text x="240" y="14" fill={COLORS.textMuted} fontSize="10">Inherits</text>

          <line x1="295" y1="10" x2="320" y2="10" stroke={COLORS.border} strokeWidth="2" strokeDasharray="5,5" />
          <text x="325" y="14" fill={COLORS.textMuted} fontSize="10">Other</text>
        </g>
        <g transform={`translate(${legendX}, ${legendY + LEGEND_ROW_GAP})`}>
          <rect x="0" y="2" width="25" height="12" rx="2" fill={COLORS.bg} stroke={COLORS.border} strokeWidth="1.5" strokeDasharray="4,2" />
          <text x="30" y="14" fill={COLORS.textMuted} fontSize="10">Composition</text>
          <rect x="110" y="2" width="25" height="12" rx="2" fill={COLORS.surface} stroke={COLORS.border} strokeWidth="1.5" />
          <text x="140" y="14" fill={COLORS.textMuted} fontSize="10">Leaf/Value</text>
        </g>
      </svg>
    </div>
  )
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 2) + '...'
}
