import { describe, expect, it } from 'vitest'
import {
  describeGetHistory,
  describeGetObject,
  describeGetObjectTypes,
  describeGetObjects,
  describeGetNamespaces,
  describeGetRelationshipTypes,
  describeGetRelatedObjects,
  describeGetValue,
} from './requestShape'

describe('requestShape', () => {
  it('includes metadata in namespace requests by default', () => {
    expect(describeGetNamespaces().query).toEqual({ includeMetadata: 'true' })
    expect(describeGetNamespaces(false).query).toEqual({ includeMetadata: 'false' })
  })

  it('includes namespace and metadata options in object type requests', () => {
    expect(describeGetObjectTypes('urn:example').query).toEqual({
      includeMetadata: 'true',
      namespaceUri: 'urn:example',
    })
    expect(describeGetObjectTypes('urn:example', false).query).toEqual({
      includeMetadata: 'false',
      namespaceUri: 'urn:example',
    })
  })

  it('includes namespace and metadata options in relationship type requests', () => {
    expect(describeGetRelationshipTypes('urn:example').query).toEqual({
      includeMetadata: 'true',
      namespaceUri: 'urn:example',
    })
    expect(describeGetRelationshipTypes('urn:example', false).query).toEqual({
      includeMetadata: 'false',
      namespaceUri: 'urn:example',
    })
  })

  it('reads a single object via the bulk list', () => {
    const d = describeGetObject('eq-1')
    expect(d.method).toBe('POST')
    expect(d.path).toBe('/objects/list')
    expect(d.body).toEqual({ elementIds: ['eq-1'], includeMetadata: true })
  })

  it('filters objects by typeElementId and asks for roots only on request', () => {
    expect(describeGetObjects('t1').query).toEqual({
      typeElementId: 't1',
      includeMetadata: 'true',
    })
    expect(describeGetObjects(undefined, false, true).query).toEqual({
      includeMetadata: 'true',
      root: 'true',
    })
    expect(describeGetObjects(undefined, false, true, true).query).toEqual({
      includeMetadata: 'false',
      root: 'true',
    })
  })

  it('builds the value request with maxDepth', () => {
    const d = describeGetValue('eq-1', 0)
    expect(d.method).toBe('POST')
    expect(d.path).toBe('/objects/value')
    expect(d.body).toEqual({ elementIds: ['eq-1'], maxDepth: 0 })
    expect(d.note).toMatch(/composition/i)
  })

  it('omits absent history bounds and keeps present ones', () => {
    const d = describeGetHistory('eq-1', '2024-01-01T00:00:00Z', undefined, 1)
    expect(d.body).toEqual({
      elementIds: ['eq-1'],
      maxDepth: 1,
      startTime: '2024-01-01T00:00:00Z',
    })
  })

  it('names the relationship-type filter relationshipType', () => {
    const d = describeGetRelatedObjects('eq-1', 'HasComponent')
    expect(d.body).toMatchObject({ relationshipType: 'HasComponent', includeMetadata: true })
  })
})
