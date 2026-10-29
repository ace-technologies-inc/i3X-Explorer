import type { Namespace, ObjectType, ObjectInstance } from '../../api/types'

/**
 * The snapshot file format: a versioned JSON envelope around the three catalog
 * collections the explorer already holds in memory (namespaces, object types,
 * objects). Capture is a pure read of the stores, zero network requests, so a
 * snapshot is exactly "what the app knew at that moment", nothing fresher.
 *
 * Objects are stored in the client's normalized `ObjectInstance` shape (wire
 * differences were already flattened by the API client). Snapshot files written
 * by earlier builds carry an `apiVersion` field; it is ignored on load.
 *
 * Files are gzip by default (`.i3xsnap.gz`): a 100k-object catalog is tens of
 * MB as JSON and ~10× smaller compressed. Plain `.json` is accepted on load,
 * the sniff is the gzip magic bytes, not the file name.
 */

export const SNAPSHOT_FORMAT_VERSION = 1

/** Default file extension for saved snapshots. */
export const SNAPSHOT_EXTENSION = '.i3xsnap.gz'

export interface SnapshotCounts {
  namespaces: number
  objectTypes: number
  objects: number
}

export interface Snapshot {
  formatVersion: number
  /** App version that wrote the file. Provenance only. */
  appVersion: string
  /** Server the catalog was fetched from. Provenance only, diffs across servers are legal. */
  serverUrl: string
  /** RFC 3339 capture time. */
  capturedAt: string
  counts: SnapshotCounts
  namespaces: Namespace[]
  objectTypes: ObjectType[]
  objects: ObjectInstance[]
}

/** Load-time problems worth telling the user about that don't block the load. */
export interface ParsedSnapshot {
  snapshot: Snapshot
  warnings: string[]
}

/** Thrown by parseSnapshot with a message fit to show the user verbatim. */
export class SnapshotFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotFormatError'
  }
}

export function createSnapshot(input: {
  appVersion: string
  serverUrl: string
  capturedAt: string
  namespaces: Namespace[]
  objectTypes: ObjectType[]
  objects: ObjectInstance[]
}): Snapshot {
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    appVersion: input.appVersion,
    serverUrl: input.serverUrl,
    capturedAt: input.capturedAt,
    counts: {
      namespaces: input.namespaces.length,
      objectTypes: input.objectTypes.length,
      objects: input.objects.length,
    },
    namespaces: input.namespaces,
    objectTypes: input.objectTypes,
    objects: input.objects,
  }
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(snapshot)
}

/**
 * Parse and validate snapshot JSON.
 *
 * Structural problems (not JSON, no envelope, a formatVersion this build
 * doesn't understand, missing collections) throw SnapshotFormatError with a
 * message meant for the user. Unknown extra fields are tolerated, a newer app
 * may add fields without bumping the format. Entries that aren't usable
 * objects (no string elementId) are dropped and counted in `warnings` rather
 * than failing the whole file.
 */
export function parseSnapshot(text: string): ParsedSnapshot {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SnapshotFormatError('Not a snapshot file: the content is not valid JSON.')
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SnapshotFormatError('Not a snapshot file: expected a JSON object envelope.')
  }
  const envelope = raw as Record<string, unknown>

  const version = envelope.formatVersion
  if (typeof version !== 'number') {
    throw new SnapshotFormatError(
      'Not an i3X Explorer snapshot: the file has no formatVersion field.'
    )
  }
  if (version > SNAPSHOT_FORMAT_VERSION) {
    throw new SnapshotFormatError(
      `This snapshot uses format version ${version}, but this build of i3X Explorer only reads up to version ${SNAPSHOT_FORMAT_VERSION}. Update the app to load it.`
    )
  }
  if (version < 1) {
    throw new SnapshotFormatError(`Unrecognized snapshot format version: ${version}.`)
  }

  for (const field of ['namespaces', 'objectTypes', 'objects'] as const) {
    if (!Array.isArray(envelope[field])) {
      throw new SnapshotFormatError(`Snapshot is missing its "${field}" list.`)
    }
  }

  const warnings: string[] = []
  const objects = (envelope.objects as unknown[]).filter((entry): entry is ObjectInstance => {
    return (
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as { elementId?: unknown }).elementId === 'string'
    )
  })
  const droppedObjects = (envelope.objects as unknown[]).length - objects.length
  if (droppedObjects > 0) {
    warnings.push(
      `${droppedObjects.toLocaleString()} object ${droppedObjects === 1 ? 'entry' : 'entries'} had no elementId and were skipped.`
    )
  }

  return {
    snapshot: {
      formatVersion: version,
      appVersion: typeof envelope.appVersion === 'string' ? envelope.appVersion : '',
      serverUrl: typeof envelope.serverUrl === 'string' ? envelope.serverUrl : '',
      capturedAt: typeof envelope.capturedAt === 'string' ? envelope.capturedAt : '',
      counts: {
        namespaces: (envelope.namespaces as unknown[]).length,
        objectTypes: (envelope.objectTypes as unknown[]).length,
        objects: objects.length,
      },
      namespaces: envelope.namespaces as Namespace[],
      objectTypes: envelope.objectTypes as ObjectType[],
      objects,
    },
    warnings,
  }
}

/* ── gzip framing ─────────────────────────────────────────────────────────── */

/** Gzip magic bytes: how a loaded file is recognized, regardless of its name. */
export function isGzipData(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/**
 * Compress snapshot JSON with the native CompressionStream, no dependency,
 * identical in Electron and the web build.
 */
export async function compressSnapshotText(json: string): Promise<Blob> {
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).blob()
}

/** Decode a loaded file: gunzip when the magic bytes say so, else plain UTF-8. */
export async function decodeSnapshotBytes(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  if (isGzipData(bytes)) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).text()
  }
  return new TextDecoder().decode(bytes)
}

/** `i3x-{host}-{yyyyMMdd-HHmmss}.i3xsnap.gz`, safe for every filesystem. */
export function suggestSnapshotFilename(serverUrl: string, capturedAt: string): string {
  let host = 'catalog'
  try {
    host = new URL(serverUrl).hostname || host
  } catch {
    // Not a URL (or empty), keep the generic stem.
  }
  const stamp = capturedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `i3x-${host}-${stamp}${SNAPSHOT_EXTENSION}`
}
