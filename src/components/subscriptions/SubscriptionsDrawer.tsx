import { useState, useCallback, useEffect } from 'react'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { SubscriptionsView } from './SubscriptionsView'
import { CloseIcon } from '../common/icons'

const MIN_HEIGHT = 120
const MAX_HEIGHT = 600

/**
 * Global subscriptions drawer, opened from the status bar's subscription count
 * or by subscribing to an element. It sits between the main panel and the status
 * bar, so live values stay visible while you keep browsing the model.
 *
 * Collapsing this only hides it, the SSE/polling transport lives in
 * SubscriptionTransportProvider, above the views, and keeps running.
 */
export function SubscriptionsDrawer() {
  const isOpen = useSubscriptionsStore(state => state.isSubscriptionsOpen)
  const setOpen = useSubscriptionsStore(state => state.setSubscriptionsOpen)
  const subscriptionCount = useSubscriptionsStore(state => state.subscriptions.size)

  const [height, setHeight] = useState(300)
  const [isResizing, setIsResizing] = useState(false)

  const handleMouseMove = useCallback((event: MouseEvent) => {
    setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, window.innerHeight - event.clientY)))
  }, [])

  const handleMouseUp = useCallback(() => setIsResizing(false), [])

  useEffect(() => {
    if (!isResizing) return
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  if (!isOpen) return null

  return (
    <div
      className="border-t border-i3x-border bg-i3x-bg flex flex-col flex-shrink-0"
      style={{ height: `${height}px` }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize subscriptions drawer"
        onMouseDown={() => setIsResizing(true)}
        className={`h-1 cursor-ns-resize hover:bg-i3x-primary/50 transition-colors motion-reduce:transition-none flex-shrink-0 ${
          isResizing ? 'bg-i3x-primary' : ''
        }`}
      />

      <div className="px-3 py-2 flex items-center gap-2 border-b border-i3x-border flex-shrink-0">
        <span className="text-xs font-medium text-i3x-text">Subscriptions</span>
        {subscriptionCount > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-i3x-primary/20 text-i3x-primary rounded">
            {subscriptionCount}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close subscriptions"
          title="Close subscriptions"
          className="ml-auto px-1.5 py-0.5 text-i3x-text-muted hover:text-i3x-text rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        >
          <CloseIcon size={13} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <SubscriptionsView />
      </div>
    </div>
  )
}
