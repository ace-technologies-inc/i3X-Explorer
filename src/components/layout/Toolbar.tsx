import { useState, useEffect } from 'react'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { createClient, destroyClient, getClient, type ApiVersion } from '../../api/client'
import { SearchModal } from '../search/SearchModal'
import iconPng from '/icon.png'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const saved = localStorage.getItem('i3x-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const POLL_OPTIONS = [
  { label: 'Refresh every 15 seconds', ms: 15_000 },
  { label: 'Refresh every 30 seconds', ms: 30_000 },
  { label: 'Refresh every 60 seconds', ms: 60_000 },
  { label: 'No automatic refresh', ms: 0 },
]

export function Toolbar() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [apiVersion, setApiVersion] = useState<ApiVersion | null>(null)
  const [showV0Warning, setShowV0Warning] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('i3x-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
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

  const { setNamespaces, setObjectTypes, setLoading, reset: resetExplorer, pollIntervalMs, setPollIntervalMs, triggerManualRefresh } = useExplorerStore()
  const { clearAll: clearSubscriptions } = useSubscriptionsStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isConnected) setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isConnected])

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
        const detectedVersion = client.getApiVersion()
        setApiVersion(detectedVersion)
        if (detectedVersion === 'v0') setShowV0Warning(true)
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

  const handleDisconnect = async () => {
    const client = getClient()
    if (client) {
      const ids = Array.from(useSubscriptionsStore.getState().subscriptions.keys())
      await Promise.allSettled(ids.map(id => client.deleteSubscription(id)))
    }

    destroyClient()
    disconnectStore()
    resetExplorer()
    clearSubscriptions()
    setApiVersion(null)
  }

  return (
    <div className="h-12 bg-i3x-surface border-b border-i3x-border flex items-center px-4 gap-4 drag-region">
      {/* macOS traffic light spacing */}
      {window.electronAPI?.platform === 'darwin' && <div className="w-16" />}

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
        {window.electronAPI && (
          <button
            onClick={() => window.electronAPI?.openDevTools()}
            className="px-3 py-1.5 text-xs bg-orange-500/20 text-orange-400 rounded border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
          >
            Developer
          </button>
        )}
      </div>

      {/* Settings gear + search + theme toggle */}
      <div className="flex items-center no-drag">
        <button
          onClick={() => setShowSearch(true)}
          disabled={!isConnected}
          title="Search objects (⌘K)"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-i3x-bg transition-colors text-base disabled:opacity-30 disabled:cursor-not-allowed"
        >
          🔍
        </button>
        <div className="relative">
          <button
            onClick={() => setShowSettingsMenu(m => !m)}
            title="Settings"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-i3x-bg transition-colors text-base"
          >
            ⚙️
          </button>
          {showSettingsMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSettingsMenu(false)} />
              <div className="absolute right-0 top-9 z-50 bg-i3x-surface border border-i3x-border rounded-lg shadow-xl w-56 py-1">
                {POLL_OPTIONS.map(opt => (
                  <button
                    key={opt.ms}
                    onClick={() => { setPollIntervalMs(opt.ms); setShowSettingsMenu(false) }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-i3x-bg transition-colors flex items-center justify-between ${
                      pollIntervalMs === opt.ms ? 'text-i3x-primary' : 'text-i3x-text'
                    }`}
                  >
                    {opt.label}
                    {pollIntervalMs === opt.ms && <span>✓</span>}
                  </button>
                ))}
                <div className="border-t border-i3x-border my-1" />
                <button
                  onClick={() => { triggerManualRefresh(); setShowSettingsMenu(false) }}
                  disabled={!isConnected}
                  className="w-full text-left px-3 py-2 text-xs text-i3x-text hover:bg-i3x-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Refresh now
                </button>
              </div>
            </>
          )}
        </div>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-i3x-bg transition-colors text-base"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
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
        {isConnected && apiVersion && (
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${
            apiVersion === 'v1'
              ? 'bg-i3x-success/10 text-i3x-success border-i3x-success/20'
              : 'bg-i3x-warning/10 text-i3x-warning border-i3x-warning/20'
          }`}>
            {apiVersion}
          </span>
        )}
        {isConnected && credentials && (
          <span title="Authenticated connection">🔒</span>
        )}
      </div>

      {error && (
        <span className="text-xs text-i3x-error truncate max-w-xs" title={error}>
          {error}
        </span>
      )}

      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}

      {showV0Warning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-i3x-surface rounded-lg shadow-xl w-full max-w-md border border-i3x-border">
            <div className="px-4 py-3 border-b border-i3x-border flex items-center gap-2">
              <span className="text-i3x-warning text-base">⚠️</span>
              <h2 className="text-sm font-semibold text-i3x-text">Deprecation Warning</h2>
            </div>
            <div className="p-4 space-y-3 text-sm text-i3x-text">
              <p>You've connected to a <span className="font-mono font-semibold text-i3x-primary">v0</span> i3X Server.</p>
              <p>The <strong>v1 release is now in Beta</strong> — support for v0 will be dropped soon. Please migrate your server to the v1 spec.</p>
              <p>
                Find more details at{' '}
                <a
                  href="https://www.i3x.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="text-i3x-primary underline hover:text-i3x-primary/80"
                >
                  www.i3x.dev
                </a>
              </p>
            </div>
            <div className="px-4 py-3 border-t border-i3x-border flex justify-end">
              <button
                onClick={() => setShowV0Warning(false)}
                className="px-4 py-1.5 text-sm bg-i3x-primary text-white rounded hover:bg-i3x-primary/80 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
