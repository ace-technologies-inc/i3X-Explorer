import { useExplorerStore } from '../../stores/explorer'
import { ModelOverview } from './ModelOverview'

/**
 * View A, the landing state, shown whenever nothing is selected.
 *
 * It used to be a force-directed map of the whole model. At the scale this app
 * browses, that is a hairball: it looks like structure but you can't read a
 * single fact off it. The overview is now statistical, how much of each type
 * there is, how deep the hierarchy runs, and which types contain which. Drilling
 * into one element's actual relationships is the Relationships tab's job, where
 * a graph can be rooted somewhere and bounded by depth.
 */
export function HomeView() {
  const allObjects = useExplorerStore(state => state.allObjects)
  const objectTypes = useExplorerStore(state => state.objectTypes)
  const namespaces = useExplorerStore(state => state.namespaces)
  const isLoading = useExplorerStore(state => state.isLoading)

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-i3x-bg">
      <header className="px-3 sm:px-5 py-4 bg-i3x-surface border-b border-i3x-border">
        <h1 className="text-base font-semibold text-i3x-text">i3X model overview</h1>
        <p className="text-xs text-i3x-text-muted mt-1">
          What the loaded model is made of. Select an element in the tree for its own values and
          relationships.
        </p>
      </header>

      <ModelOverview
        objects={allObjects}
        objectTypes={objectTypes}
        namespaceCount={namespaces.length}
        isLoading={isLoading}
      />
    </div>
  )
}
