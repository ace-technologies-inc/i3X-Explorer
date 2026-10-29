import { useState, useCallback, useEffect } from 'react'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { TreeView } from '../tree/TreeView'

/**
 * Placeholder rows shown while the catalog loads: [indent level, width %].
 * Fixed values (not random) so the skeleton doesn't reshuffle on re-render.
 */
const SKELETON_ROWS: Array<[number, number]> = [
  [0, 62], [1, 48], [2, 66], [2, 42], [1, 56], [2, 50],
  [3, 38], [0, 58], [1, 44], [1, 60], [2, 40], [0, 52],
  [1, 54], [2, 46], [2, 62], [1, 42], [0, 60], [1, 50],
]

/**
 * Pulsing stand-in for the tree while the object catalog is being fetched.
 * Stays up until the catalog actually lands, isLoading covers the whole
 * object-list prefetch (see services/connection.ts), so the tree never
 * flashes empty between skeleton and data.
 */
function TreeSkeleton() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden px-2 py-1" role="status" aria-label="Loading model">
      <div className="space-y-2 animate-pulse motion-reduce:animate-none" aria-hidden="true">
        {SKELETON_ROWS.map(([indent, width], i) => (
          <div
            key={i}
            className="flex items-center gap-2"
            style={{ paddingLeft: `${8 + indent * 16}px` }}
          >
            <div className="h-3.5 w-3.5 rounded bg-i3x-text/10 shrink-0" />
            <div className="h-3 rounded bg-i3x-text/10" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function Sidebar() {
  // Narrow selectors: a bare store hook re-renders on every write, and this
  // component re-renders the unmemoized TreeView with it.
  const isConnected = useConnectionStore(s => s.isConnected)
  const isLoading = useExplorerStore(s => s.isLoading)
  const sidebarCollapsed = useExplorerStore(s => s.sidebarCollapsed)
  const [width, setWidth] = useState(288) // 72 * 4 = 288px (w-72)
  const [isResizing, setIsResizing] = useState(false)

  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    // Clamp between min (224px) and max (480px)
    setWidth(Math.max(224, Math.min(480, e.clientX)))
  }, [isResizing])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (isResizing) {
      // Prevent text selection while resizing
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ew-resize'

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  // Collapsed: render nothing (the toolbar toggle brings it back). The width
  // state stays in this still-mounted component, so expanding restores it.
  if (sidebarCollapsed) return null

  return (
    <div
      className="bg-i3x-surface border-r border-i3x-border flex"
      style={{ width: `${width}px`, minWidth: '224px', maxWidth: '480px' }}
    >
      {/* Tree content, TreeView owns its own (vertical) scroll area; long
          labels truncate. No horizontal padding: rows span the full panel
          width (their highlights, indent guides and count pills reach the
          edges); the filter input carries its own inset. */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden py-2 flex flex-col">
        {!isConnected ? (
          <div className="flex items-center justify-center h-full text-i3x-text-muted text-sm">
            Connect to a server to browse
          </div>
        ) : isLoading ? (
          <TreeSkeleton />
        ) : (
          <TreeView />
        )}
      </div>

      {/* Resize handle */}
      <div
        className={`w-1 cursor-ew-resize hover:bg-i3x-primary/50 transition-colors ${
          isResizing ? 'bg-i3x-primary' : ''
        }`}
        onMouseDown={handleMouseDown}
      />
    </div>
  )
}
