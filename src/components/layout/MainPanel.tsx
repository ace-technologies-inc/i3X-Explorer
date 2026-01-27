import { useExplorerStore } from '../../stores/explorer'
import { NamespaceDetail } from '../details/NamespaceDetail'
import { ObjectTypeDetail } from '../details/ObjectTypeDetail'
import { ObjectDetail } from '../details/ObjectDetail'
import type { Namespace, ObjectType, ObjectInstance } from '../../api/types'

export function MainPanel() {
  const { selectedItem } = useExplorerStore()

  if (!selectedItem) {
    return (
      <div className="flex-1 flex items-center justify-center bg-i3x-bg text-i3x-text-muted">
        <div className="text-center">
          <p className="text-lg mb-2">No item selected</p>
          <p className="text-sm">Select an item from the tree to view details</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-i3x-bg p-4">
      {selectedItem.type === 'namespace' && (
        <NamespaceDetail namespace={selectedItem.data as Namespace} />
      )}
      {selectedItem.type === 'objectType' && (
        <ObjectTypeDetail objectType={selectedItem.data as ObjectType} />
      )}
      {selectedItem.type === 'object' && (
        <ObjectDetail object={selectedItem.data as ObjectInstance} />
      )}
    </div>
  )
}
