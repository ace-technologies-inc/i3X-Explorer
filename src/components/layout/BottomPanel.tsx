import { useState, useCallback, useEffect } from 'react'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { SubscriptionPanel } from '../subscriptions/SubscriptionPanel'

export function BottomPanel() {
  const { subscriptions } = useSubscriptionsStore()
  const [height, setHeight] = useState(330)
  const [isResizing, setIsResizing] = useState(false)

  const hasSubscriptions = subscriptions.size > 0

  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
  }, [])

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

  return (
    <div
      className="border-t border-i3x-border bg-i3x-bg flex flex-col"
      style={{ height: `${height}px` }}
    >
      {/* Resize handle */}
      <div
        className={`h-1 cursor-ns-resize hover:bg-i3x-primary/50 transition-colors ${
          isResizing ? 'bg-i3x-primary' : ''
        }`}
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-i3x-border">
        <span className="text-xs font-medium text-i3x-text">Subscriptions</span>
        {hasSubscriptions && (
          <span className="px-1.5 py-0.5 text-xs bg-i3x-primary/20 text-i3x-primary rounded">
            {subscriptions.size}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <SubscriptionPanel />
      </div>
    </div>
  )
}
