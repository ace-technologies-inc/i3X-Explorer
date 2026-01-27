import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'
import { TreeView } from '../tree/TreeView'

export function Sidebar() {
  const { isConnected } = useConnectionStore()
  const { isLoading, searchQuery, setSearchQuery } = useExplorerStore()

  return (
    <div className="w-72 min-w-56 max-w-96 bg-i3x-surface border-r border-i3x-border flex flex-col">
      {/* Search */}
      <div className="p-2 border-b border-i3x-border">
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-1.5 text-sm bg-i3x-bg rounded border border-i3x-border focus:border-i3x-primary focus:outline-none"
          disabled={!isConnected}
        />
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-auto p-2">
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
    </div>
  )
}
