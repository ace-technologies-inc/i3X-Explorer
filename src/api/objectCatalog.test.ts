import { describe, expect, it } from 'vitest'
import { buildObjectIndexes, fingerprint, processObjectResponse } from './objectCatalog'

function responseBuffer(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer
}

describe('fingerprint', () => {
  const bytes = (text: string) => new TextEncoder().encode(text).buffer

  it('is stable for identical bytes and covers both whole words and the trailing bytes', () => {
    expect(fingerprint(bytes('abcdefghij'))).toBe(fingerprint(bytes('abcdefghij')))
    expect(fingerprint(bytes('abcdefghij'))).not.toBe(fingerprint(bytes('Abcdefghij')))
    expect(fingerprint(bytes('abcdefghij'))).not.toBe(fingerprint(bytes('abcdefghiJ')))
    expect(fingerprint(bytes('abcdefghij'))).not.toBe(fingerprint(bytes('abcdefghijk')))
  })
})

describe('processObjectResponse', () => {
  it('builds catalog indexes from a bare object array', () => {
    const catalog = processObjectResponse(responseBuffer([
      { elementId: 'root', displayName: 'Root', typeElementId: 'T', parentId: null, namespaceUri: 'urn:x' },
      { elementId: 'child', displayName: 'Child', typeElementId: 'T', parentId: 'root', namespaceUri: 'urn:x' },
    ]), { buildIndexes: true })

    expect(catalog.objects.map(object => object.elementId)).toEqual(['root', 'child'])
    expect(catalog.childrenByParent.get('root')?.map(object => object.elementId)).toEqual(['child'])
    expect(catalog.objectIndex.get('child')?.displayName).toBe('Child')
    expect(catalog.searchIndex.get('child')).toBe('child child urn:x')
    expect(catalog.objectCountByType.get('T')).toBe(2)
    expect(catalog.fingerprint).toContain(':')
  })

  it('normalizes objects and unwraps the single result envelope', () => {
    const catalog = processObjectResponse(responseBuffer({
      success: true,
      result: [{
        elementId: 'child',
        displayName: 'Child',
        typeElementId: 'T',
        parentId: null,
        metadata: { typeNamespaceUri: 'urn:x' },
      }],
      }), { buildIndexes: true })

    expect(catalog.objects).toMatchObject([{ elementId: 'child', typeId: 'T', namespaceUri: 'urn:x' }])
    expect(catalog.objectCountByType.get('T')).toBe(1)
  })

  it('returns an unindexed object list for filtered object queries', () => {
    const catalog = processObjectResponse(responseBuffer([
      { elementId: 'one', displayName: 'One', typeElementId: 'T', parentId: null, namespaceUri: 'urn:x' },
    ]), { buildIndexes: false })

    expect(catalog.objects.map(object => object.elementId)).toEqual(['one'])
    expect('objectIndex' in catalog).toBe(false)
    expect('fingerprint' in catalog).toBe(false)
  })

  it('builds the same indexes for local store writes', () => {
    const objects = [
      { elementId: 'one', displayName: 'One', typeId: 'T', parentId: 'root', isComposition: false, namespaceUri: 'urn:x' },
    ]
    const indexes = buildObjectIndexes(objects)

    expect(indexes.objectIndex.get('one')).toBe(objects[0])
    expect(indexes.searchIndex.get('one')).toBe('one one urn:x')
    expect(indexes.childrenByParent.get('root')).toEqual(objects)
    expect(indexes.objectCountByType.get('T')).toBe(1)
  })
})