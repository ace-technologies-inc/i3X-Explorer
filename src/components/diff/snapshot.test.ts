import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_FORMAT_VERSION,
  SnapshotFormatError,
  compressSnapshotText,
  createSnapshot,
  decodeSnapshotBytes,
  isGzipData,
  parseSnapshot,
  serializeSnapshot,
  suggestSnapshotFilename,
} from './snapshot'
import type { ObjectInstance } from '../../api/types'

function obj(elementId: string): ObjectInstance {
  return {
    elementId,
    displayName: elementId,
    typeId: 'T',
    parentId: null,
    isComposition: false,
    namespaceUri: 'urn:ns',
  }
}

function sampleSnapshot() {
  return createSnapshot({
    appVersion: '1.0.0',
    serverUrl: 'https://api.example.com/v1',
    capturedAt: '2026-07-31T12:00:00Z',
    namespaces: [{ uri: 'urn:ns', displayName: 'NS' }],
    objectTypes: [{ elementId: 'T', displayName: 'T', namespaceUri: 'urn:ns', schema: {} }],
    objects: [obj('A'), obj('B')],
  })
}

describe('createSnapshot / parseSnapshot', () => {
  it('round-trips through serialization', () => {
    const snapshot = sampleSnapshot()
    const { snapshot: parsed, warnings } = parseSnapshot(serializeSnapshot(snapshot))
    expect(parsed).toEqual(snapshot)
    expect(warnings).toEqual([])
  })

  it('derives counts from the collections', () => {
    const snapshot = sampleSnapshot()
    expect(snapshot.counts).toEqual({ namespaces: 1, objectTypes: 1, objects: 2 })
    expect(snapshot.formatVersion).toBe(SNAPSHOT_FORMAT_VERSION)
  })

  it('rejects non-JSON with a user-facing message', () => {
    expect(() => parseSnapshot('not json at all {')).toThrow(SnapshotFormatError)
    expect(() => parseSnapshot('not json at all {')).toThrow(/not valid JSON/)
  })

  it('rejects JSON without a snapshot envelope', () => {
    expect(() => parseSnapshot('[1,2,3]')).toThrow(/JSON object envelope/)
    expect(() => parseSnapshot('{"foo":1}')).toThrow(/formatVersion/)
  })

  it('refuses a formatVersion from the future, naming both versions', () => {
    const text = JSON.stringify({ ...sampleSnapshot(), formatVersion: 999 })
    expect(() => parseSnapshot(text)).toThrow(/format version 999/)
    expect(() => parseSnapshot(text)).toThrow(new RegExp(`up to version ${SNAPSHOT_FORMAT_VERSION}`))
  })

  it('rejects a snapshot missing one of its collections', () => {
    const { objects: _, ...withoutObjects } = sampleSnapshot()
    expect(() => parseSnapshot(JSON.stringify(withoutObjects))).toThrow(/"objects" list/)
  })

  it('tolerates unknown extra fields', () => {
    const text = JSON.stringify({ ...sampleSnapshot(), futureField: { anything: true } })
    const { snapshot } = parseSnapshot(text)
    expect(snapshot.counts.objects).toBe(2)
  })

  it('tolerates missing provenance fields, defaulting instead of failing', () => {
    const bare = {
      formatVersion: 1,
      namespaces: [],
      objectTypes: [],
      objects: [obj('A')],
    }
    const { snapshot } = parseSnapshot(JSON.stringify(bare))
    expect(snapshot.serverUrl).toBe('')
    expect(snapshot.counts.objects).toBe(1)
  })

  it('drops object entries without an elementId and reports them as a warning', () => {
    const mangled = {
      ...sampleSnapshot(),
      objects: [obj('A'), null, 42, { displayName: 'no id' }, obj('B')],
    }
    const { snapshot, warnings } = parseSnapshot(JSON.stringify(mangled))
    expect(snapshot.objects.map(o => o.elementId)).toEqual(['A', 'B'])
    expect(snapshot.counts.objects).toBe(2)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/3 object entries/)
  })
})

describe('gzip framing', () => {
  it('round-trips snapshot JSON through gzip', async () => {
    const json = serializeSnapshot(sampleSnapshot())
    const blob = await compressSnapshotText(json)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(isGzipData(bytes)).toBe(true)
    expect(bytes.length).toBeLessThan(json.length)
    expect(await decodeSnapshotBytes(await blob.arrayBuffer())).toBe(json)
  })

  it('passes plain JSON bytes through untouched', async () => {
    const json = serializeSnapshot(sampleSnapshot())
    const buffer = new TextEncoder().encode(json).buffer as ArrayBuffer
    expect(await decodeSnapshotBytes(buffer)).toBe(json)
  })
})

describe('suggestSnapshotFilename', () => {
  it('uses the server host and a compact timestamp', () => {
    expect(
      suggestSnapshotFilename('https://api.example.com/v1', '2026-07-31T12:34:56Z')
    ).toBe('i3x-api.example.com-20260731-123456.i3xsnap.gz')
  })

  it('falls back to a generic stem for a non-URL', () => {
    expect(suggestSnapshotFilename('', '2026-07-31T12:34:56Z')).toMatch(/^i3x-catalog-/)
  })
})
