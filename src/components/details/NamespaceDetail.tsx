import type { Namespace } from '../../api/types'
import { JsonViewer } from './JsonViewer'

interface NamespaceDetailProps {
  namespace: Namespace
}

export function NamespaceDetail({ namespace }: NamespaceDetailProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-i3x-text mb-1">
          {namespace.displayName}
        </h2>
        <p className="text-sm text-i3x-text-muted">Namespace</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">URI</label>
          <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text break-all">
            {namespace.uri}
          </code>
        </div>
        <div>
          <label className="block text-xs text-i3x-text-muted mb-1">Display Name</label>
          <code className="block px-3 py-2 bg-i3x-surface rounded text-sm text-i3x-text">
            {namespace.displayName}
          </code>
        </div>
      </div>

      <div>
        <label className="block text-xs text-i3x-text-muted mb-1">Raw Data</label>
        <JsonViewer data={namespace} />
      </div>
    </div>
  )
}
