import { useState, useEffect, useMemo } from 'react'
import type { ObjectInstance } from '../../api/types'
import { getClient } from '../../api/client'

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
const CENTER_X = 300
const CENTER_Y = 200
const RADIUS = 150

// Colors (matching tailwind.config.js)
const COLORS = {
  primary: '#3b82f6',
  secondary: '#64748b',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  bg: '#1e1e1e',
  surface: '#252526',
  border: '#3c3c3c',
  text: '#cccccc',
  textMuted: '#808080'
}

export function RelationshipGraph({ object }: RelationshipGraphProps) {
  const [relatedObjects, setRelatedObjects] = useState<RelatedObject[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        // Determine relationship type based on parentId
        relationshipType: r.parentId === object.elementId ? 'HasComponent' :
                         object.parentId === r.elementId ? 'HasParent' : 'Related'
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
        width="600"
        height="400"
        style={{ minWidth: '600px', backgroundColor: COLORS.surface, borderRadius: '6px' }}
      >
        {/* Connection lines */}
        {positions.map((pos, index) => {
          const related = relatedObjects[index]
          const isParent = related.relationshipType === 'HasParent'
          const isChild = related.relationshipType === 'HasChildren' || related.relationshipType === 'HasComponent'
          const strokeColor = isParent ? COLORS.warning : isChild ? COLORS.success : COLORS.border

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
          const isParent = related.relationshipType === 'HasParent'
          const isChild = related.relationshipType === 'HasChildren' || related.relationshipType === 'HasComponent'

          // Color code by relationship type
          const strokeColor = isParent ? COLORS.warning : isChild ? COLORS.success : COLORS.border

          return (
            <g
              key={`${related.elementId}-${related.relationshipType}`}
              transform={`translate(${pos.x - BOX_WIDTH / 2}, ${pos.y - BOX_HEIGHT / 2})`}
              style={{ cursor: 'pointer' }}
            >
              <rect
                width={BOX_WIDTH}
                height={BOX_HEIGHT}
                rx="6"
                fill={COLORS.surface}
                stroke={strokeColor}
                strokeWidth="2"
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
        <g transform="translate(10, 360)">
          <line x1="0" y1="10" x2="25" y2="10" stroke={COLORS.warning} strokeWidth="2" />
          <text x="30" y="14" fill={COLORS.textMuted} fontSize="10">Parent</text>

          <line x1="80" y1="10" x2="105" y2="10" stroke={COLORS.success} strokeWidth="2" />
          <text x="110" y="14" fill={COLORS.textMuted} fontSize="10">Child</text>

          <line x1="155" y1="10" x2="180" y2="10" stroke={COLORS.border} strokeWidth="2" strokeDasharray="5,5" />
          <text x="185" y="14" fill={COLORS.textMuted} fontSize="10">Other</text>
        </g>
      </svg>
    </div>
  )
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 2) + '...'
}
