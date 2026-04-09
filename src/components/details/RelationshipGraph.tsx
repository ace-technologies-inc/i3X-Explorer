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
const CENTER_X = 325
const CENTER_Y = 200
const RADIUS = 150

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
  const { allObjects, selectItem, expandNode, setAllObjects, setHierarchicalRoots } = useExplorerStore()

  const handleNodeClick = async (related: RelatedObject) => {
    const client = getClient()
    if (!client) return

    // Fetch full object if not already in the store
    const cached = allObjects.find(o => o.elementId === related.elementId)
    const obj: ObjectInstance = cached ?? await client.getObject(related.elementId)

    // Select the item — use the hier: prefix so the hierarchy tree node highlights
    selectItem({ type: 'object', id: `hier:${obj.elementId}`, data: obj })

    // Ensure allObjects and hierarchicalRoots are loaded before expanding the tree
    let knownObjects = allObjects
    if (knownObjects.length === 0) {
      const [fetched, roots] = await Promise.all([
        client.getObjects(),
        client.getObjects(undefined, false, true)
      ])
      setAllObjects(fetched)
      setHierarchicalRoots(roots)
      knownObjects = fetched
    }

    // Walk parentId chain to build root-first ancestor list
    const ancestorIds: string[] = []
    let currentId: string | null | undefined = obj.parentId
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      ancestorIds.unshift(currentId)
      currentId = knownObjects.find(o => o.elementId === currentId)?.parentId
    }

    // Expand the Hierarchy folder and every ancestor so the target node is visible
    expandNode('folder:hierarchical')
    ancestorIds.forEach(id => expandNode(`hier:${id}`))
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

  // Calculate positions for related objects in a circle around the center
  const positions = useMemo(() => {
    return relatedObjects.map((_, index) => {
      const angle = (2 * Math.PI * index) / relatedObjects.length - Math.PI / 2
      return {
        x: CENTER_X + RADIUS * Math.cos(angle),
        y: CENTER_Y + RADIUS * Math.sin(angle)
      }
    })
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
    <div className="w-full overflow-auto">
      <svg
        width="650"
        height="465"
        style={{ minWidth: '650px', backgroundColor: COLORS.surface, borderRadius: '6px' }}
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
              x1={CENTER_X}
              y1={CENTER_Y}
              x2={pos.x}
              y2={pos.y}
              stroke={strokeColor}
              strokeWidth="2"
              strokeDasharray={isParent || isChild ? "none" : "5,5"}
            />
          )
        })}

        {/* Center object (selected) */}
        <g transform={`translate(${CENTER_X - BOX_WIDTH / 2}, ${CENTER_Y - BOX_HEIGHT / 2})`}>
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

        {/* Legend */}
        <g transform="translate(10, 405)">
          <line x1="0" y1="10" x2="25" y2="10" stroke={COLORS.warning} strokeWidth="2" />
          <text x="30" y="14" fill={COLORS.textMuted} fontSize="10">Parent/ComponentOf</text>

          <line x1="140" y1="10" x2="165" y2="10" stroke={COLORS.success} strokeWidth="2" />
          <text x="170" y="14" fill={COLORS.textMuted} fontSize="10">Child</text>

          <line x1="210" y1="10" x2="235" y2="10" stroke={COLORS.primary} strokeWidth="2" />
          <text x="240" y="14" fill={COLORS.textMuted} fontSize="10">Inherits</text>

          <line x1="295" y1="10" x2="320" y2="10" stroke={COLORS.border} strokeWidth="2" strokeDasharray="5,5" />
          <text x="325" y="14" fill={COLORS.textMuted} fontSize="10">Other</text>
        </g>
        <g transform="translate(10, 428)">
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
