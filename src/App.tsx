import { useEffect } from 'react'
import { useConnectionStore } from './stores/connection'
import { useSubscriptionsStore } from './stores/subscriptions'
import { getClient } from './api/client'
import { Toolbar } from './components/layout/Toolbar'
import { Sidebar } from './components/layout/Sidebar'
import { MainPanel } from './components/layout/MainPanel'
import { HistoryPanel } from './components/layout/HistoryPanel'
import { BottomPanel } from './components/layout/BottomPanel'
import { ConnectionDialog } from './components/connection/ConnectionDialog'
import { UpdateChecker } from './components/updater/UpdateChecker'

function App() {
  const { showConnectionDialog, ignoreCertErrors } = useConnectionStore()

  // Sync persisted ignoreCertErrors to main process on startup
  useEffect(() => {
    window.electronAPI?.setIgnoreCertErrors(ignoreCertErrors)
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
    <div className="h-full flex flex-col bg-i3x-bg">
      <Toolbar />

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Tree browser */}
        <Sidebar />

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Details panel */}
          <MainPanel />

          {/* History panel */}
          <HistoryPanel />

          {/* Bottom panel - Subscriptions */}
          <BottomPanel />
        </div>
      </div>

      {showConnectionDialog && <ConnectionDialog />}
      <UpdateChecker />
    </div>
  )
}

export default App
