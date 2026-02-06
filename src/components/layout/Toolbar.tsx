import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { createClient, destroyClient, getClient } from '../../api/client'
import iconPng from '/icon.png'

export function Toolbar() {
  const {
    serverUrl,
    credentials,
    getCredentialsForUrl,
    setCredentials,
    isConnected,
    isConnecting,
    error,
    setShowConnectionDialog,
    setConnected,
    setConnecting,
    setError,
    addRecentUrl,
    disconnect: disconnectStore
  } = useConnectionStore()

  const { setNamespaces, setObjectTypes, setLoading, reset: resetExplorer } = useExplorerStore()
  const { clearAll: clearSubscriptions } = useSubscriptionsStore()

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)

    // Use saved credentials if none are currently set
    const activeCredentials = credentials ?? getCredentialsForUrl(serverUrl)
    if (activeCredentials && !credentials) {
      setCredentials(activeCredentials)
    }

    try {
      const client = createClient(serverUrl, activeCredentials)
      const success = await client.testConnection()

      if (success) {
        setConnected(true)
        addRecentUrl(serverUrl)

        // Load initial data
        setLoading(true)
        const [namespaces, objectTypes] = await Promise.all([
          client.getNamespaces(),
          client.getObjectTypes()
        ])
        setNamespaces(namespaces)
        setObjectTypes(objectTypes)
        setLoading(false)
      } else {
        setError('Failed to connect to server')
        destroyClient()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
      destroyClient()
    }
  }

  const handleDisconnect = () => {
    // Clean up subscriptions
    const client = getClient()
    if (client) {
      // TODO: Clean up active subscriptions
    }

    destroyClient()
    disconnectStore()
    resetExplorer()
    clearSubscriptions()
  }

  return (
    <div className="h-12 bg-i3x-surface border-b border-i3x-border flex items-center px-4 gap-4 drag-region">
      {/* macOS traffic light spacing */}
      <div className="w-16" />

      <img src={iconPng} alt="" className="w-5 h-5" />
      <h1 className="text-sm font-semibold text-i3x-text">i3X Explorer</h1>

      <div className="flex-1 flex items-center gap-2">
        <button
          onClick={() => setShowConnectionDialog(true)}
          className="px-3 py-1.5 text-xs bg-i3x-bg rounded border border-i3x-border hover:border-i3x-primary transition-colors truncate max-w-2xl"
        >
          {serverUrl || 'Click to configure'}
        </button>

        {!isConnected ? (
          <button
            onClick={handleConnect}
            disabled={isConnecting || !serverUrl}
            className="px-3 py-1.5 text-xs bg-i3x-primary text-white rounded hover:bg-i3x-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        ) : (
          <button
            onClick={handleDisconnect}
            className="px-3 py-1.5 text-xs bg-i3x-error/20 text-i3x-error rounded hover:bg-i3x-error/30 transition-colors"
          >
            Disconnect
          </button>
        )}
        <button
          onClick={() => window.electronAPI?.openDevTools()}
          className="px-3 py-1.5 text-xs bg-orange-500/20 text-orange-400 rounded border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
        >
          Developer
        </button>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            isConnected
              ? 'bg-i3x-success'
              : isConnecting
              ? 'bg-i3x-warning animate-pulse'
              : 'bg-i3x-secondary'
          }`}
        />
        <span className="text-xs text-i3x-text-muted">
          {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
        </span>
        {isConnected && credentials && (
          <span title="Authenticated connection">🔒</span>
        )}
      </div>

      {error && (
        <span className="text-xs text-i3x-error truncate max-w-xs" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
