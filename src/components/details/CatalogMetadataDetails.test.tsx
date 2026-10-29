// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Namespace, ObjectType, RelationshipType } from '../../api/types'
import { NamespaceDetail } from './NamespaceDetail'
import { ObjectTypeDetail } from './ObjectTypeDetail'
import { RelationshipTypeDetail } from './RelationshipTypeDetail'
import { destroyClient } from '../../api/client'

afterEach(() => {
  cleanup()
  destroyClient()
})

function expectMetadataSourceId(sourceId: string) {
  // The data disclosure renders its sections only once opened.
  const details = document.querySelector('details')
  expect(details).not.toBeNull()
  act(() => {
    details!.open = true
    fireEvent(details!, new Event('toggle'))
  })
  const metadataSection = screen.getByText('Metadata').parentElement
  expect(metadataSection).not.toBeNull()
  expect(within(metadataSection as HTMLElement).getByText(new RegExp(sourceId))).toBeTruthy()
}

describe('catalog detail metadata', () => {
  it('shows namespace metadata', () => {
    const namespace: Namespace = {
      uri: 'urn:example',
      displayName: 'Example',
      isExtended: false,
      metadata: { description: 'Example namespace', system: { sourceId: 'namespace-source' } },
    }

    render(<NamespaceDetail namespace={namespace} />)

    expectMetadataSourceId('namespace-source')
    expect(screen.getByText('Example namespace')).toBeTruthy()
  })

  it('shows object-type metadata', () => {
    const objectType: ObjectType = {
      elementId: 'urn:example:Pump',
      displayName: 'Pump',
      namespaceUri: 'urn:example',
      schema: { type: 'object' },
      isExtended: false,
      metadata: { description: 'Pump type', system: { sourceId: 'object-type-source' } },
    }

    render(<ObjectTypeDetail objectType={objectType} />)

    expectMetadataSourceId('object-type-source')
    expect(screen.getByText('Pump type')).toBeTruthy()
  })

  it('prefers the object type\'s own description over metadata', () => {
    const objectType: ObjectType = {
      elementId: 'urn:example:Valve',
      displayName: 'Valve',
      description: 'A flow control valve',
      namespaceUri: 'urn:example',
      schema: { type: 'object' },
    }

    render(<ObjectTypeDetail objectType={objectType} />)

    expect(screen.getByText('A flow control valve')).toBeTruthy()
  })

  it('says so when there is no description', () => {
    const namespace: Namespace = { uri: 'urn:bare', displayName: 'Bare' }

    render(<NamespaceDetail namespace={namespace} />)

    expect(screen.getByText('No description provided.')).toBeTruthy()
  })

  it('shows relationship-type metadata', () => {
    const relationshipType: RelationshipType = {
      elementId: 'urn:example:HasComponent',
      displayName: 'Has Component',
      namespaceUri: 'urn:example',
      reverseOf: 'ComponentOf',
      isExtended: false,
      metadata: { description: 'Composition link', system: { sourceId: 'relationship-source' } },
    }

    render(<RelationshipTypeDetail relationshipType={relationshipType} />)

    expectMetadataSourceId('relationship-source')
    expect(screen.getByText('Composition link')).toBeTruthy()
  })
})