import type { RelationshipType } from '../../api/types'
import { describeGetRelationshipTypes } from '../../api/requestShape'
import { Card, Field } from '../main/primitives'
import { DescriptionCard } from '../main/DescriptionCard'
import { CardCodeSample } from './CodeSamplePanel'
import { DataDisclosure, metadataExcept } from './DataDisclosure'

interface RelationshipTypeDetailProps {
  relationshipType: RelationshipType
}

export function RelationshipTypeDetail({
  relationshipType,
}: RelationshipTypeDetailProps) {
  return (
    <div className="space-y-4">
      <DescriptionCard
        description={relationshipType.description}
        metadata={relationshipType.metadata}
      />

      <Card
        title="Identity"
        actions={
          <CardCodeSample
            descriptor={describeGetRelationshipTypes(relationshipType.namespaceUri)}
            title={relationshipType.displayName}
            subtitle="Relationship Type"
          />
        }
      >
        <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <Field label="Element ID" value={relationshipType.elementId} />
          <Field
            label="Relationship ID"
            value={relationshipType.relationshipId ?? relationshipType.elementId}
          />
          <Field label="Namespace URI" value={relationshipType.namespaceUri} />
          <Field label="Reverse Of" value={relationshipType.reverseOf} />
        </div>
      </Card>

      <DataDisclosure
        title="Relationship Type Data"
        sections={[
          { label: 'Metadata', data: metadataExcept(relationshipType.metadata, ['description']) },
          { label: 'Raw Relationship Type', data: relationshipType },
        ]}
      />
    </div>
  )
}
