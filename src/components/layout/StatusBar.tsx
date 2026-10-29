import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { LockIcon, WarningIcon } from '../common/icons'

/**
 * The bottom status strip. Everything here used to be crammed into the toolbar's
 * right edge; the mockup gives it a home of its own.
 *
 * The mockup also shows a server timestamp, we have no such value without a
 * request, so it's omitted rather than faked.
 */
export function StatusBar() {
  const isConnected = useConnectionStore(state => state.isConnected)
  const isConnecting = useConnectionStore(state => state.isConnecting)
  const credentials = useConnectionStore(state => state.credentials)
  const serverUrl = useConnectionStore(state => state.serverUrl)
  const error = useConnectionStore(state => state.error)

  const objectCount = useExplorerStore(state => state.allObjects.length)
  const namespaceCount = useExplorerStore(state => state.namespaces.length)
  const cachedAt = useExplorerStore(state => state.catalogOrigin?.kind === 'cache' ? state.catalogOrigin.at : null)

  const subscriptionCount = useSubscriptionsStore(state => state.subscriptions.size)
  const isSubscriptionsOpen = useSubscriptionsStore(state => state.isSubscriptionsOpen)
  const setSubscriptionsOpen = useSubscriptionsStore(state => state.setSubscriptionsOpen)

  const statusLabel = isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'
  const statusColor = isConnected
    ? 'text-i3x-success'
    : isConnecting
    ? 'text-i3x-warning'
    : 'text-i3x-text-muted'

  const displayUrl = serverUrl.replace(/^https?:\/\//, '')

  return (
    <footer className="h-7 flex items-stretch bg-i3x-surface border-t border-i3x-border font-mono text-[11.5px] text-i3x-text-muted flex-shrink-0">
      <div className={`flex items-center gap-2 px-3 border-r border-i3x-border ${statusColor}`}>
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full bg-current ${
            isConnecting ? 'animate-pulse motion-reduce:animate-none' : ''
          }`}
        />
        <span>
          {statusLabel}
        </span>
        {isConnected && credentials && (
          <span title="Authenticated connection" className="flex items-center">
            <LockIcon size={12} />
          </span>
        )}
      </div>

      {serverUrl && (
        <div className="hidden sm:flex items-center px-3 border-r border-i3x-border min-w-0">
          <span className="truncate max-w-[16rem]" title={serverUrl}>
            {displayUrl}
          </span>
        </div>
      )}

      {isConnected && (
        <div className="hidden md:flex items-center px-3 border-r border-i3x-border text-i3x-primary whitespace-nowrap">
          {objectCount.toLocaleString()} objects · {namespaceCount} namespaces
          {cachedAt && (
            <span
              className="ml-2 text-i3x-text-muted"
              title={`Showing the catalog cached at ${new Date(cachedAt).toLocaleString()} while the server copy loads`}
            >
              · cached, refreshing…
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setSubscriptionsOpen(!isSubscriptionsOpen)}
        aria-expanded={isSubscriptionsOpen}
        title={isSubscriptionsOpen ? 'Hide subscriptions' : 'Show subscriptions'}
        className={`flex items-center px-3 border-r border-i3x-border whitespace-nowrap hover:bg-i3x-bg transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary focus-visible:ring-inset ${
          isSubscriptionsOpen ? 'text-i3x-primary' : ''
        }`}
      >
        {subscriptionCount} {subscriptionCount === 1 ? 'subscription' : 'subscriptions'}
      </button>

      {error && (
        <div className="flex items-center gap-1.5 px-3 border-r border-i3x-border text-i3x-error min-w-0">
          <WarningIcon size={12} />
          <span className="truncate max-w-[28rem]" title={error}>{error}</span>
        </div>
      )}

      <div className="flex-1" />

      {window.electronAPI && (
        <button
          type="button"
          onClick={() => window.electronAPI?.openDevTools()}
          title="Developer tools"
          className="flex items-center px-3 border-l border-i3x-border text-i3x-warning hover:bg-i3x-warning/10 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary focus-visible:ring-inset"
        >
          &lt;/&gt; Developer
        </button>
      )}
    </footer>
  )
}
