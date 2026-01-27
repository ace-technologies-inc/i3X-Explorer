import type { ObjectType } from '../../api/types'
import { JsonViewer } from './JsonViewer'

interface ObjectTypeDetailProps {
  objectType: ObjectType
}

export function ObjectTypeDetail({ objectType }: ObjectTypeDetailProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-i3x-text mb-1">
          {objectType.displayName}
        </h2>
        <p className="text-sm text-i3x-text-muted">Object Type</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Element ID</label>
          <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
            {objectType.elementId}
          </code>
        </div>
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Namespace URI</label>
          <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
            {objectType.namespaceUri}
          </code>
        </div>
      </div>

      <div>
        <label className="block text-xs text-i3x-text-muted mb-1">Schema</label>
        <JsonViewer data={objectType.schema} />
      </div>
    </div>
  )
}
