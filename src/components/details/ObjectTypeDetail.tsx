import type { ObjectType } from '../../api/types'
import { describeGetObjectTypes } from '../../api/requestShape'
import { Card, Field } from '../main/primitives'
import { DescriptionCard } from '../main/DescriptionCard'
import { CardCodeSample } from './CodeSamplePanel'
import { DataDisclosure, metadataExcept } from './DataDisclosure'
import { JsonViewer } from './JsonViewer'

interface ObjectTypeDetailProps {
  objectType: ObjectType
}

export function ObjectTypeDetail({ objectType }: ObjectTypeDetailProps) {
  // No heading here: SimpleDetailView (the shell every simple detail renders
  // in) already shows the display name and the "Object Type" kind label.
  return (
    <div className="space-y-4">
      <DescriptionCard description={objectType.description} metadata={objectType.metadata} />

      <Card
        title="Identity"
        actions={
          <CardCodeSample
            descriptor={describeGetObjectTypes(objectType.namespaceUri)}
            title={objectType.displayName}
            subtitle="Object Type"
          />
        }
      >
        <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <Field label="Element ID" value={objectType.elementId} />
          <Field label="Namespace URI" value={objectType.namespaceUri} />
          <Field label="Source Type ID" value={objectType.sourceTypeId} />
          <Field label="Version" value={objectType.version} />
        </div>

        {objectType.related && (
          <div className="mt-3.5">
            <label className="block text-[11.5px] text-i3x-text-muted mb-1.5">Related Types</label>
            <div className="px-3 py-2 bg-i3x-bg border border-i3x-border rounded-lg text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-i3x-text-muted text-xs">Relationship:</span>
                <code className="text-i3x-primary text-xs">{objectType.related.relationshipType}</code>
              </div>
              {objectType.related.types && objectType.related.types.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {objectType.related.types.map(t => (
                    <code key={t} className="text-xs px-1.5 py-0.5 bg-i3x-surface rounded border border-i3x-border text-i3x-text">
                      {t}
                    </code>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title="Schema">
        <JsonViewer data={objectType.schema} />
      </Card>

      <DataDisclosure
        title="Object Type Data"
        sections={[
          { label: 'Metadata', data: metadataExcept(objectType.metadata, ['description']) },
          { label: 'Raw Object Type', data: objectType },
        ]}
      />
    </div>
  )
}
