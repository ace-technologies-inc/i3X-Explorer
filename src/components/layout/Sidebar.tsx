import { useState, useCallback, useEffect } from 'react'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { TreeView } from '../tree/TreeView'

export function Sidebar() {
  const { isConnected } = useConnectionStore()
  const { isLoading, sidebarCollapsed } = useExplorerStore()
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
      {/* Tree content — TreeView owns its own scroll area (both axes) */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden p-2 flex flex-col">
        {!isConnected ? (
          <div className="flex items-center justify-center h-full text-i3x-text-muted text-sm">
            Connect to a server to browse
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full text-i3x-text-muted text-sm">
            Loading...
          </div>
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
