import { useExplorerStore, type HomeTab } from '../../stores/explorer'
import { useConnectionStore } from '../../stores/connection'
import { performConnect } from '../../services/connection'
import { PerfProfiler } from '../../diagnostics/PerfProfiler'
import { InsightsView } from '../insights/InsightsView'
import { ModelOverview } from './ModelOverview'
import { ErrorNotice, TabStrip } from './homePrimitives'

/**
 * View A, the landing state, shown whenever nothing is selected.
 *
 * Three tabs. **Overview** is the model at a glance: four headline numbers,
 * what it is made of, its shape, where to start, and how consistent it is.
 * **Model** is the same data to read closely (every type, the hierarchy, the
 * namespaces). **Model insights** is what the instances imply: the conventions
 * the model keeps, where they are broken, and where each type lives. With
 * nothing connected, Home is the way in.
 *
 * Every page of Home is a tab in this strip. Model insights used to open over
 * Home as a page of its own with a Close button; a page you have to close is a
 * different kind of thing from its neighbors, and it was the only one.
 *
 * The header is the tab strip and nothing else: the toolbar already shows the
 * server address and the search, and the status bar the connection and the
 * object count.
 *
 * There is deliberately no whole-model graph. At the scale this app browses,
 * that is a hairball: it looks like structure but you can't read a single fact
 * off it. Drilling into one element's relationships is the Relationships tab's
 * job, where a graph can be rooted somewhere and bounded by depth.
 */

const TABS: { id: HomeTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'model', label: 'Model' },
  { id: 'insights', label: 'Model insights' },
]

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function HomeView() {
  const allObjects = useExplorerStore(state => state.allObjects)
  const objectTypes = useExplorerStore(state => state.objectTypes)
  const namespaces = useExplorerStore(state => state.namespaces)
  const isLoading = useExplorerStore(state => state.isLoading)
  const activeTab = useExplorerStore(state => state.homeTab)
  const setActiveTab = useExplorerStore(state => state.setHomeTab)
  const isConnected = useConnectionStore(state => state.isConnected)

  if (!isConnected && allObjects.length === 0 && !isLoading) return <Welcome />

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-i3x-bg">
      <header className="px-1 sm:px-2 pt-1.5 bg-i3x-surface border-b border-i3x-border">
        <TabStrip tabs={TABS} active={activeTab} onChange={setActiveTab} label="Home" idPrefix="home" />
      </header>

      {/* Keyed by tab, so each one opens at its top instead of inheriting the last tab's scroll position. */}
      <div
        key={activeTab}
        role="tabpanel"
        id={`home-panel-${activeTab}`}
        aria-labelledby={`home-tab-${activeTab}`}
        className="flex-1 min-h-0 flex flex-col"
      >
        {activeTab === 'insights' ? (
          <PerfProfiler id="Insights">
            <InsightsView />
          </PerfProfiler>
        ) : (
          <ModelOverview
            section={activeTab}
            objects={allObjects}
            objectTypes={objectTypes}
            namespaces={namespaces}
            isLoading={isLoading}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Home with nothing connected: the one thing there is to do, and why the last
 * attempt failed if it did. No tagline and no feature list: they say nothing a
 * person who opened the app doesn't know.
 */
function Welcome() {
  const serverUrl = useConnectionStore(state => state.serverUrl)
  const isConnecting = useConnectionStore(state => state.isConnecting)
  const error = useConnectionStore(state => state.error)
  const setShowConnectionDialog = useConnectionStore(state => state.setShowConnectionDialog)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-i3x-bg grid place-items-center px-4 py-10">
      <div className="w-full max-w-lg bg-i3x-surface border border-i3x-border rounded-xl px-7 py-7">
        <h1 className="text-[20px] leading-tight font-semibold text-i3x-text">Connect to an i3X server</h1>

        <div className="flex flex-wrap items-center gap-2.5 mt-5">
          {serverUrl && (
            <button
              type="button"
              onClick={() => void performConnect()}
              disabled={isConnecting}
              title={serverUrl}
              className="max-w-full truncate px-4 py-2 text-[13.5px] font-medium bg-i3x-primary text-white rounded-lg hover:bg-i3x-primary/85 disabled:opacity-60 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-i3x-primary"
            >
              {isConnecting ? 'Connecting…' : `Connect to ${hostOf(serverUrl)}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowConnectionDialog(true)}
            className={`px-4 py-2 text-[13.5px] rounded-lg transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
              serverUrl
                ? 'border border-i3x-border text-i3x-text hover:border-i3x-primary'
                : 'font-medium bg-i3x-primary text-white hover:bg-i3x-primary/85'
            }`}
          >
            {serverUrl ? 'Choose another server' : 'Choose a server'}
          </button>
        </div>

        {error && !isConnecting && <ErrorNotice className="mt-5">{error}</ErrorNotice>}
      </div>
    </div>
  )
}
