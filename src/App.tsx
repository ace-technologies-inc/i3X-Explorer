import { useConnectionStore } from './stores/connection'
import { Toolbar } from './components/layout/Toolbar'
import { Sidebar } from './components/layout/Sidebar'
import { MainPanel } from './components/layout/MainPanel'
import { HistoryPanel } from './components/layout/HistoryPanel'
import { BottomPanel } from './components/layout/BottomPanel'
import { ConnectionDialog } from './components/connection/ConnectionDialog'

function App() {
  const { showConnectionDialog } = useConnectionStore()

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
    </div>
  )
}

export default App
