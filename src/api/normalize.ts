import type { ObjectInstance, ServerCapabilities, SyncResponseItem } from './types'

/**
 * Pure response-normalization helpers for the I3X 1.0 client.
 * Extracted from client.ts so the most regression-prone logic in the app
 * is unit-testable without a network.
 */

/**
 * maxDepth for reading or subscribing to an object: a composition object takes its
 * whole HasComponent tree (0), everything else just itself (1).
 */
export function compositionDepth(isComposition: boolean): number {
  return isComposition ? 0 : 1
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Sync/stream updates as one item per element. A server may report a composition's component
 * changes as updates of their own or inside the root update's `components` map (the
 * `/objects/value` shape); both arrive here as per-element items, and an element sent on its own
 * keeps that update.
 */
export function subscriptionUpdateItems(updates: unknown[]): SyncResponseItem[] {
  const records = updates.filter(isRecord).filter(update => typeof update.elementId === 'string')
  const direct = new Set(records.map(update => update.elementId as string))
  const items: SyncResponseItem[] = []
  for (const update of records) {
    const quality = (update.quality as string | null | undefined) ?? null
    const timestamp = (update.timestamp as string | null | undefined) ?? null
    items.push({ elementId: update.elementId as string, value: update.value, quality, timestamp })
    if (!isRecord(update.components)) continue
    for (const [elementId, component] of Object.entries(update.components)) {
      if (direct.has(elementId) || !isRecord(component)) continue
      items.push({
        elementId,
        value: component.value,
        quality: (component.quality as string | null | undefined) ?? quality,
        timestamp: (component.timestamp as string | null | undefined) ?? timestamp,
      })
    }
  }
  return items
}

/** Unwraps the { success, result } envelope for non-bulk responses. */
export function unwrapV1Envelope(data: unknown): unknown {
  if (data && typeof data === 'object') {
    const envelope = data as Record<string, unknown>
    if ('result' in envelope && !('results' in envelope)) return envelope.result
  }
  return data
}

// 1.0 object instances use typeElementId instead of typeId, and may omit namespaceUri.
// Metadata fields (typeNamespaceUri, relationships, etc.) are nested under raw.metadata
// rather than being flat on the object.
// Normalize to the ObjectInstance shape used throughout the app.
export function normalizeV1Object(raw: Record<string, unknown>): ObjectInstance {
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>
  const schemaExtensions = (metadata.schemaExtensions ?? raw.schemaExtensions) as Record<string, unknown> | undefined
  return {
    elementId: raw.elementId as string,
    displayName: raw.displayName as string,
    typeId: ((raw.typeElementId ?? raw.typeId) as string) ?? '',
    parentId: (raw.parentId as string | null) ?? null,
    isComposition: (raw.isComposition as boolean) ?? false,
    isExtended: (raw.isExtended as boolean) ?? false,
    namespaceUri: ((raw.namespaceUri ?? metadata.typeNamespaceUri) as string) ?? '',
    description: (metadata.description as string) ?? undefined,
    sourceTypeId: typeof metadata.sourceTypeId === 'string' ? metadata.sourceTypeId : undefined,
    relationships: (metadata.relationships ?? raw.relationships) as Record<string, unknown> | undefined,
    sourceRelationship: raw.sourceRelationship as string | undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    ...(schemaExtensions ? { schemaExtensions } : {})
  }
}

// POST bulk responses: {success, results: [{success, elementId, result: T}]}
// Returns the results array, or empty array if the shape doesn't match.
export function extractV1BulkResults<T>(raw: unknown): Array<{ success: boolean; elementId: string; result: T }> {
  if (raw && typeof raw === 'object' && 'results' in (raw as object)) {
    return ((raw as Record<string, unknown>).results as Array<{ success: boolean; elementId: string; result: T }>) ?? []
  }
  return []
}

/** Which requested elements a register/unregister call applied to. */
export interface BulkOutcome {
  accepted: string[]
  rejected: Array<{ elementId: string; message: string }>
}

/** The failure text a 1.0 body's `responseDetail` carries. */
export function failureMessage(body: Record<string, unknown>): string | undefined {
  const detail = body.responseDetail
  if (!isRecord(detail)) return undefined
  const text = detail.detail ?? detail.title
  return typeof text === 'string' ? text : undefined
}

/** A non-bulk `{ success: false, ... }` body. */
export function isFailedEnvelope(data: unknown): data is Record<string, unknown> {
  return isRecord(data) && data.success === false && !('results' in data)
}

/** The HTTP status a failed body's `responseDetail` carries, if any. */
export function failureStatus(body: Record<string, unknown>): number | undefined {
  const detail = body.responseDetail
  return isRecord(detail) && typeof detail.status === 'number' ? detail.status : undefined
}

/** The error text for a failed body or BulkResultItem (`success: false` with a `responseDetail`). */
export function failureText(body: Record<string, unknown>): string {
  const status = failureStatus(body)
  const message = failureMessage(body) ?? 'The server reported a failure'
  return status !== undefined ? `HTTP ${status}: ${message}` : message
}

/**
 * The result for a one-element bulk request, or undefined when the server returned none.
 * Throws the server's reason when the element (or the whole request) failed.
 */
export function singleBulkResult<T>(raw: unknown, elementId: string): T | undefined {
  const results = extractV1BulkResults<T>(raw)
  // elementId is nullable in the spec, so a lone unlabeled result still answers the request.
  const item = results.find(r => r.elementId === elementId)
    ?? (results.length === 1 && results[0]?.elementId == null ? results[0] : undefined)
  if (item?.success === false) throw new Error(failureText(item as unknown as Record<string, unknown>))
  if (!item && isRecord(raw) && raw.success === false) throw new Error(failureText(raw))
  return item?.success ? item.result ?? undefined : undefined
}

/**
 * Splits a register/unregister response into accepted and rejected elements. A body with
 * `success: false` rejects every element, a failed per-item result rejects that element, and an
 * empty body (204) or one without per-item results accepts them all.
 */
export function bulkOutcome(elementIds: string[], body: unknown): BulkOutcome {
  if (isRecord(body) && body.success === false) {
    const message = failureMessage(body) ?? 'The server rejected the request'
    return { accepted: [], rejected: elementIds.map(elementId => ({ elementId, message })) }
  }
  const results = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.results) ? body.results : []
  const failures = new Map<string, string>()
  for (const result of results) {
    if (isRecord(result) && typeof result.elementId === 'string' && result.success === false) {
      failures.set(result.elementId, failureMessage(result) ?? 'Rejected by the server')
    }
  }
  return {
    accepted: elementIds.filter(id => !failures.has(id)),
    rejected: elementIds.filter(id => failures.has(id)).map(elementId => ({ elementId, message: failures.get(elementId)! })),
  }
}

/** An error naming every rejected element, or null when all were accepted. */
export function bulkRejection(outcome: BulkOutcome): Error | null {
  if (outcome.rejected.length === 0) return null
  return new Error(outcome.rejected.map(({ elementId, message }) => `${elementId}: ${message}`).join('; '))
}

/** Thrown when GET /info does not identify an i3X 1.0 release server. `found` says what it did identify. */
export class UnsupportedServerError extends Error {
  readonly found: string
  constructor(found: string) {
    super(`This server does not implement i3X 1.0 (found: ${found}). i3X Explorer 1.1 supports 1.0 servers only.`)
    this.name = 'UnsupportedServerError'
    this.found = found
  }
}

/** Thrown when GET /info answers 401 or 403: the server may well be 1.0, but it did not accept the credentials. */
export class AuthRequiredError extends Error {
  readonly status: number
  constructor(status: number) {
    super(
      status === 401
        ? 'The server requires authentication (HTTP 401). Check the Authentication settings and try again.'
        : `The server denied access (HTTP ${status}). Check that the credentials in the Authentication settings are allowed to read it.`
    )
    this.name = 'AuthRequiredError'
    this.status = status
  }
}

/**
 * Interprets the GET /info probe. An OK response with a parseable
 * specVersion/version/apiVersion ≥ 1.0 and no "beta" serverVersion is a 1.0
 * server: its capabilities matrix (null if it sent none) is returned. A 401 or
 * 403 throws AuthRequiredError (the version is unknown, not wrong). Anything
 * else (another non-OK status, an unusable body, an older or beta server)
 * throws UnsupportedServerError. Pass `body: undefined` when parsing failed.
 */
export function readInfoResponse(input: { ok: boolean; status: number; body: unknown }): ServerCapabilities | null {
  if (!input.ok && (input.status === 401 || input.status === 403)) throw new AuthRequiredError(input.status)
  if (!input.ok) throw new UnsupportedServerError(`GET /info answered HTTP ${input.status}`)
  if (!isRecord(input.body)) throw new UnsupportedServerError('an unreadable /info response')
  // The payload is wrapped as {success, result: {...}}; also accept unwrapped bodies
  const info = (isRecord(input.body.result) ? input.body.result : input.body) as Record<string, unknown>
  const serverVersion = String(info.serverVersion ?? '').toLowerCase()
  const specRaw = String(info.specVersion ?? info.version ?? info.apiVersion ?? '')
  const specMajor = parseFloat(specRaw)
  if (isNaN(specMajor)) throw new UnsupportedServerError('no spec version in /info')
  if (specMajor < 1.0 || serverVersion.includes('beta')) {
    throw new UnsupportedServerError(`spec version ${specRaw}${serverVersion ? `, server ${serverVersion}` : ''}`)
  }
  // The capabilities matrix is mandatory in 1.0 ServerInfo.
  return info.capabilities && typeof info.capabilities === 'object' ? (info.capabilities as ServerCapabilities) : null
}
