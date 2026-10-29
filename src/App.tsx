import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './data/queryClient'
import { useConnectionStore } from './stores/connection'
import { useSubscriptionsStore } from './stores/subscriptions'
import { getClient } from './api/client'
import { Toolbar } from './components/layout/Toolbar'
import { Sidebar } from './components/layout/Sidebar'
import { MainPanel } from './components/layout/MainPanel'
import { StatusBar } from './components/layout/StatusBar'
import { SubscriptionTransportProvider } from './components/subscriptions/SubscriptionTransport'
import { SubscriptionsDrawer } from './components/subscriptions/SubscriptionsDrawer'
import { ConnectionDialog } from './components/connection/ConnectionDialog'
import { UpdateChecker } from './components/updater/UpdateChecker'
import { PerfProfiler } from './diagnostics/PerfProfiler'

function App() {
  const showConnectionDialog = useConnectionStore(s => s.showConnectionDialog)

  // Sync persisted ignoreCertErrors to main process on startup. Read through
  // getState(): this is a one-shot mount sync, not a subscription.
  useEffect(() => {
    window.electronAPI?.setIgnoreCertErrors(useConnectionStore.getState().ignoreCertErrors)
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onAppBeforeQuit) return
    return window.electronAPI.onAppBeforeQuit(async () => {
      try {
        const client = getClient()
        if (client) {
          const ids = Array.from(useSubscriptionsStore.getState().subscriptions.keys())
          await Promise.allSettled(ids.map((id) => client.deleteSubscription(id)))
        }
      } finally {
        window.electronAPI?.notifyCleanupDone()
      }
    })
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
    {/* The subscription transport lives above the views so switching tabs (or
        navigating away from an element) never tears down a live stream. */}
    <SubscriptionTransportProvider>
      <div className="h-full flex flex-col bg-i3x-bg">
        <PerfProfiler id="Toolbar">
          <Toolbar />
        </PerfProfiler>

        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Left sidebar - Tree browser */}
          <PerfProfiler id="Sidebar">
            <Sidebar />
          </PerfProfiler>

          {/* Main content area, Home shell or tabbed element detail */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <PerfProfiler id="MainPanel">
              <MainPanel />
            </PerfProfiler>
          </div>
        </div>

        {/* Subscriptions are global, not element-scoped, so they get a drawer
            spanning the window rather than a tab inside one element. */}
        <PerfProfiler id="Subscriptions">
          <SubscriptionsDrawer />
        </PerfProfiler>

        <PerfProfiler id="StatusBar">
          <StatusBar />
        </PerfProfiler>

        {showConnectionDialog && <ConnectionDialog />}
        {/* Desktop-only: the web build has no installer to nag users toward. */}
        {window.electronAPI && <UpdateChecker />}
      </div>
    </SubscriptionTransportProvider>
    </QueryClientProvider>
  )
}

export default App
