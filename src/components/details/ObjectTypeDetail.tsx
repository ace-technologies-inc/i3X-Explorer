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
        {objectType.sourceTypeId && (
          <div>
            <label className="block text-xs text-i3x-text-muted mb-1">Source Type ID</label>
            <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
              {objectType.sourceTypeId}
            </code>
          </div>
        )}
        {objectType.version !== undefined && objectType.version !== null && (
          <div>
            <label className="block text-xs text-i3x-text-muted mb-1">Version</label>
            <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text">
              {objectType.version}
            </code>
          </div>
        )}
      </div>

      {objectType.related && (
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Related Types</label>
          <div className="px-3 py-2 bg-i3x-surface rounded text-sm space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-i3x-text-muted text-xs">Relationship:</span>
              <code className="text-i3x-primary text-xs">{objectType.related.relationshipType}</code>
            </div>
            {objectType.related.types && objectType.related.types.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {objectType.related.types.map(t => (
                  <code key={t} className="text-xs px-1.5 py-0.5 bg-i3x-bg rounded border border-i3x-border text-i3x-text">
                    {t}
                  </code>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs text-i3x-text-muted mb-1">Schema</label>
        <JsonViewer data={objectType.schema} />
      </div>
    </div>
  )
}
