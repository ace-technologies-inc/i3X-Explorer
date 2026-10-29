import { useExplorerStore } from '../../stores/explorer'
import { NamespaceDetail } from '../details/NamespaceDetail'
import { ObjectTypeDetail } from '../details/ObjectTypeDetail'
import { DiffView } from '../diff/DiffView'
import { InsightsView } from '../insights/InsightsView'
import { HomeView } from '../main/HomeView'
import { ObjectDetailView } from '../main/ObjectDetailView'
import { SimpleDetailView } from '../main/SimpleDetailView'
import type { Namespace, ObjectType, ObjectInstance, RelationshipType } from '../../api/types'
import { RelationshipTypeDetail } from '../details/RelationshipTypeDetail'
import { PerfProfiler } from '../../diagnostics/PerfProfiler'

/**
 * The main content panel. Top-level states, read straight off the current
 * navigation stop (`stores/explorer.ts`, one entry = item + tab + page):
 *
 *   page 'diff'      → snapshot diff
 *   page 'insights'  → model insights
 *   nothing selected → Home shell (model overview)
 *   object selected  → tabbed element detail
 *   relationship type selected → simple element detail
 *
 * The two full-panel views are mutually exclusive for free: one `page` field
 * can only name one of them, and navigating anywhere pushes a stop with no
 * page. Namespace and object-type selections reuse the same header frame
 * without tabs. The panel never imports the tree; both sides share `selectItem`.
 */
export function MainPanel() {
  const selectedItem = useExplorerStore(state => state.selectedItem)
  const page = useExplorerStore(state => state.activePage)

  if (page === 'diff') {
    return (
      <PerfProfiler id="Diff">
        <DiffView />
      </PerfProfiler>
    )
  }

  if (page === 'insights') {
    return (
      <PerfProfiler id="Insights">
        <InsightsView />
      </PerfProfiler>
    )
  }

  if (!selectedItem) {
    return (
      <PerfProfiler id="Home">
        <HomeView />
      </PerfProfiler>
    )
  }

  if (selectedItem.type === 'object') {
    const object = selectedItem.data as ObjectInstance
    // Re-key on the element so per-element view state (active tab, loaded value,
    // history range) starts fresh instead of bleeding across selections.
    return (
      <PerfProfiler id="Object detail">
        <ObjectDetailView key={object.elementId} object={object} />
      </PerfProfiler>
    )
  }

  if (selectedItem.type === 'namespace') {
    const namespace = selectedItem.data as Namespace
    return (
      <SimpleDetailView label={namespace.displayName} kind="Namespace">
        <NamespaceDetail namespace={namespace} />
      </SimpleDetailView>
    )
  }

  if (selectedItem.type === 'objectType') {
    const objectType = selectedItem.data as ObjectType
    return (
      <SimpleDetailView label={objectType.displayName} kind="Object Type">
        <ObjectTypeDetail objectType={objectType} />
      </SimpleDetailView>
    )
  }

  if (selectedItem.type === 'relationshipType') {
    const relationshipType = selectedItem.data as RelationshipType
    return (
      <SimpleDetailView label={relationshipType.displayName} kind="Relationship Type">
        <RelationshipTypeDetail relationshipType={relationshipType} />
      </SimpleDetailView>
    )
  }

  return <HomeView />
}
