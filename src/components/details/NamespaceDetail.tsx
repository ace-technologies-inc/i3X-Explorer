import type { Namespace } from '../../api/types'
import { describeGetObjectTypes } from '../../api/requestShape'
import { Card, Field } from '../main/primitives'
import { DescriptionCard } from '../main/DescriptionCard'
import { CardCodeSample } from './CodeSamplePanel'
import { DataDisclosure, metadataExcept } from './DataDisclosure'

interface NamespaceDetailProps {
  namespace: Namespace
}

export function NamespaceDetail({ namespace }: NamespaceDetailProps) {
  // No heading here: SimpleDetailView (the shell every simple detail renders
  // in) already shows the display name and the "Namespace" kind label.
  return (
    <div className="space-y-4">
      <DescriptionCard metadata={namespace.metadata} />

      <Card
        title="Identity"
        actions={
          <CardCodeSample
            descriptor={describeGetObjectTypes(namespace.uri)}
            title={namespace.displayName}
            subtitle="Namespace"
          />
        }
      >
        <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <Field label="URI" value={namespace.uri} />
          <Field label="Display Name" value={namespace.displayName} />
        </div>
      </Card>

      <DataDisclosure
        title="Namespace Data"
        sections={[
          { label: 'Metadata', data: metadataExcept(namespace.metadata, ['description']) },
          { label: 'Raw Namespace', data: namespace },
        ]}
      />
    </div>
  )
}
