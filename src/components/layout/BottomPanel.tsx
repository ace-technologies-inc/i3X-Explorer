import { useState, useCallback, useEffect } from 'react'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { SubscriptionPanel } from '../subscriptions/SubscriptionPanel'

export function BottomPanel() {
  const { subscriptions } = useSubscriptionsStore()
  const [height, setHeight] = useState(330)
  const [isResizing, setIsResizing] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const hasSubscriptions = subscriptions.size > 0

  const handleMouseDown = useCallback(() => {
    if (isCollapsed) return
    setIsResizing(true)
  }, [isCollapsed])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    // Calculate new height based on mouse position from bottom of window
    const newHeight = window.innerHeight - e.clientY
    // Clamp between min and max heights
    setHeight(Math.max(100, Math.min(600, newHeight)))
  }, [isResizing])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev)
  }, [])

  return (
    <div
      className="border-t border-i3x-border bg-i3x-bg flex flex-col"
      style={{ height: isCollapsed ? 'auto' : `${height}px` }}
    >
      {/* Resize handle - only show when expanded */}
      {!isCollapsed && (
        <div
          className={`h-1 cursor-ns-resize hover:bg-i3x-primary/50 transition-colors ${
            isResizing ? 'bg-i3x-primary' : ''
          }`}
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Header */}
      <div
        className="px-3 py-2 flex items-center gap-2 border-b border-i3x-border cursor-pointer hover:bg-i3x-surface/50"
        onClick={toggleCollapsed}
      >
        <svg
          className={`w-3 h-3 text-i3x-text-muted transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
        <span className="text-xs font-medium text-i3x-text">Subscriptions</span>
        {hasSubscriptions && (
          <span className="px-1.5 py-0.5 text-xs bg-i3x-primary/20 text-i3x-primary rounded">
            {subscriptions.size}
          </span>
        )}
      </div>

      {/* Content - only show when expanded */}
      {!isCollapsed && (
        <div className="flex-1 overflow-auto">
          <SubscriptionPanel />
        </div>
      )}
    </div>
  )
}
