import type {
  Namespace,
  ObjectType,
  ObjectInstance,
  RelationshipType,
  RelatedByTypeEntry,
  LastKnownValue,
  HistoricalValue,
  CreateSubscriptionResponse,
  SyncResponseItem,
  GetSubscriptionsResponse,
  ServerCapabilities
} from './types'
import { buildAuthHeaders } from './auth'
import { HttpStatusError } from './subscription'
import {
  bulkOutcome,
  extractV1BulkResults,
  failureMessage,
  failureStatus,
  failureText,
  isFailedEnvelope,
  normalizeV1Object,
  readInfoResponse,
  singleBulkResult,
  subscriptionUpdateItems,
  unwrapV1Envelope,
  AuthRequiredError,
  UnsupportedServerError,
  type BulkOutcome,
} from './normalize'
import { processObjectResponse } from './objectCatalog'
import { describeGetNamespaces, describeGetObjectTypes, describeGetObjects, describeGetRelationshipTypes } from './requestShape'
import type { RequestDescriptor } from './requestShape'

import type { Credentials } from '../stores/connection'
import { traceSpan } from '../diagnostics/perfTrace'

export type ClientCredentials = Credentials

export interface StreamConfig {
  url: string
  method: 'GET' | 'POST'
  postBody?: object
}

/** The unmodified HTTP response produced by an inspector request. */
export interface InspectedResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

/**
 * A server can accept the TCP connection and then never send an HTTP response.
 * `fetch` has no default timeout, so those requests stay pending forever and the
 * UI sits in "Connecting…" with nothing to report. Abort instead.
 */
export const REQUEST_TIMEOUT_MS = 15_000

const RELATED_BY_TYPE_PAGE_SIZE = 1000
const OBJECTS_LIST_CHUNK_SIZE = 500
const COALESCIBLE_POST_PATHS = [
  '/objects/list',
  '/objects/related',
  '/objects/related-by-type',
  '/objects/value',
  '/objects/history',
  '/objects/query',
  '/objecttypes/query',
  '/relationshiptypes/query',
]
type CoalescedResponseShape =
  | 'json'
  | 'inspector'
  | 'info-probe'
  | 'object-list'
  | 'object-catalog'
  | 'root-objects'
  | 'envelope'

interface RequestResponseProcessor<T> {
  shape: CoalescedResponseShape
  process: (buffer: ArrayBuffer) => T
}

function canCoalesceRead(method: string, url: string): boolean {
  const pathname = new URL(url).pathname.replace(/\/+$/, '')
  if (method === 'GET') return !pathname.endsWith('/stream')
  return method === 'POST' && COALESCIBLE_POST_PATHS.some(path => pathname.endsWith(path))
}

function requestIdentity(
  method: string,
  url: string,
  body: unknown,
  responseShape: CoalescedResponseShape,
  headers?: Record<string, string>
): string {
  const normalizedUrl = new URL(url)
  normalizedUrl.searchParams.sort()
  const bodyKey = body === undefined ? '' : stableStringify(body)
  return `${responseShape}:${method}:${normalizedUrl.toString()}:${bodyKey}:${headers ? stableStringify(headers) : ''}`
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`
}

function pathWithQuery(descriptor: RequestDescriptor): string {
  if (!descriptor.query) return descriptor.path
  return `${descriptor.path}?${new URLSearchParams(descriptor.query).toString()}`
}

interface ObjectListRequest {
  typeId?: string
  includeMetadata: boolean
  rootsOnly: boolean
  /** Leave out metadata; the catalog resolves namespaceUri from the object types. */
  lean?: boolean
  headers?: Record<string, string>
}

/** A full-catalog response: the body and its ETag, or confirmation that the caller's copy is current. */
export type CatalogBody =
  | { notModified: false; buffer: ArrayBuffer | undefined; etag: string | null }
  | { notModified: true }

/** An element a bulk request could not answer, with the server's reason. */
export interface ElementFailure {
  elementId: string
  message: string
}

export type ObjectDetailsFailure = ElementFailure

export interface ObjectDetailsResult {
  objects: ObjectInstance[]
  failures: ObjectDetailsFailure[]
}

/** Related objects per requested element; failed elements are absent from `related`. */
export interface RelatedBatchResult {
  related: Map<string, ObjectInstance[]>
  failures: ElementFailure[]
}

export interface RelatedByTypeResult {
  entries: RelatedByTypeEntry[]
  failures: ElementFailure[]
}

function bulkItemFailure(item: { elementId: string | null }, fallbackId: string): ElementFailure {
  return { elementId: item.elementId ?? fallbackId, message: failureText(item as unknown as Record<string, unknown>) }
}

/**
 * Requested ids the bulk results never answered, failed with the best reason available: an
 * unattributed item's, then the top-level envelope's (e.g. `{ success: false, results: [] }`).
 */
function unansweredFailures(requested: string[], answered: Set<string>, unattributed: string[], raw: unknown): ElementFailure[] {
  const message = unattributed[0] ?? bulkEnvelopeFailureText(raw) ?? 'Not returned by the server'
  return requested
    .filter(id => !answered.has(id))
    .map(elementId => ({ elementId, message }))
}

/** The reason a bulk body's top level gives for failing, if it gives one. */
function bulkEnvelopeFailureText(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const body = raw as Record<string, unknown>
  return body.success === false && failureMessage(body) !== undefined ? failureText(body) : undefined
}

/** The element a bulk result answers; the spec allows a null elementId, which only a lone request/result pair can resolve. */
function resultElementId(item: { elementId: string | null }, requested: string[], resultCount: number): string | null {
  if (typeof item.elementId === 'string') return item.elementId
  return requested.length === 1 && resultCount === 1 ? requested[0] : null
}

/** A 2xx `success: false` body as an error, typed by its `responseDetail.status` so callers can branch on it. */
function envelopeError(body: Record<string, unknown>): Error {
  const status = failureStatus(body)
  if (status === undefined) return new Error(failureText(body))
  return new HttpStatusError(status, failureMessage(body) ?? 'The server reported a failure')
}

// Each related entry is { sourceRelationship, object: {...} }; sourceRelationship
// lives on the envelope, so carry it onto the object before normalizing.
function normalizeRelatedEnvelope(envelope: Record<string, unknown>): ObjectInstance {
  const inner = (envelope.object ?? envelope) as Record<string, unknown>
  const raw = envelope.object ? { ...inner, sourceRelationship: envelope.sourceRelationship } : inner
  return normalizeV1Object(raw as Record<string, unknown>)
}

/** The cursor of a `Link: <…?cursor=X>; rel="next"` header, if there is one. */
export function nextCursorFromLink(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i)
    if (match) return new URL(match[1], 'http://placeholder').searchParams.get('cursor')
  }
  return null
}

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Server did not respond within ${Math.round(timeoutMs / 1000)}s`)
    this.name = 'TimeoutError'
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    // Our abort and a caller's abort look the same; only ours can fire here.
    if (err instanceof Error && err.name === 'AbortError') throw new TimeoutError(timeoutMs)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export class I3XClient {
  private baseUrl: string
  private credentials: ClientCredentials | null
  // Track last seen sequence number per subscription for sync acknowledgment
  private syncSequenceNumbers = new Map<string, number>()
  // clientId generated at createSubscription time; required by all subsequent subscription ops
  private clientIds = new Map<string, string>()
  // Capabilities matrix from GET /info; captured at connect
  private capabilities: ServerCapabilities | null = null
  private inFlightReads = new Map<string, Promise<unknown>>()

  constructor(baseUrl: string, credentials?: ClientCredentials | null) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.credentials = credentials ?? null
  }

  getCredentials(): ClientCredentials | null {
    return this.credentials
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getCapabilities(): ServerCapabilities | null {
    return this.capabilities
  }

  /**
   * Execute a declarative request shape without applying endpoint-specific
   * response normalization. The request inspector uses this to show exactly
   * what the server returned, including non-success responses.
   */
  async executeDescriptor(descriptor: RequestDescriptor): Promise<InspectedResponse> {
    let url = `${this.baseUrl}${pathWithQuery(descriptor)}`
    if (url.includes('://localhost:')) {
      url = url.replace('://localhost:', '://127.0.0.1:')
    }

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (descriptor.body !== undefined) headers['Content-Type'] = 'application/json'
    Object.assign(headers, buildAuthHeaders(this.credentials))

    return this.coalesceRead(descriptor.method, url, descriptor.body, 'inspector', async () => {
      const response = await fetchWithTimeout(url, {
        method: descriptor.method,
        headers,
        ...(descriptor.body !== undefined ? { body: JSON.stringify(descriptor.body) } : {}),
      })

      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      }
    })
  }

  private coalesceRead<T>(
    method: string,
    url: string,
    body: unknown,
    responseShape: CoalescedResponseShape,
    execute: () => Promise<T>,
    headers?: Record<string, string>
  ): Promise<T> {
    if (!canCoalesceRead(method, url)) return execute()
    const key = requestIdentity(method, url, body, responseShape, headers)
    const existing = this.inFlightReads.get(key)
    if (existing) return existing as Promise<T>

    const shared = execute().finally(() => {
      if (this.inFlightReads.get(key) === shared) this.inFlightReads.delete(key)
    })
    this.inFlightReads.set(key, shared)
    return shared
  }

  // 1.0: a 206 bulk response carries a top-level responseDetail explaining the
  // server-imposed limit that truncated the result (e.g. composition tree depth)
  private extractPartialDetail(raw: unknown): string {
    if (raw && typeof raw === 'object') {
      const detail = (raw as Record<string, unknown>).responseDetail as Record<string, unknown> | undefined
      const text = (detail?.detail ?? detail?.title) as string | undefined
      if (text) return text
    }
    return 'A server-imposed limit truncated this result'
  }

  // Returns parsed response body plus the raw HTTP status code.
  // Use this when the caller needs to inspect the status (e.g. 206 Partial Content from /sync).
  private async requestRaw<T>(
    method: string,
    path: string,
    body?: unknown,
    responseProcessor?: RequestResponseProcessor<T>,
    requestHeaders?: Record<string, string>
  ): Promise<{ data: T; status: number; headers: Headers }> {
    // Fix localhost IPv6 issue - Chromium may prefer IPv6 but servers often only listen on IPv4
    let url = `${this.baseUrl}${path}`
    if (url.includes('://localhost:')) {
      url = url.replace('://localhost:', '://127.0.0.1:')
    }

    return this.coalesceRead(
      method,
      url,
      body,
      responseProcessor?.shape ?? 'json',
      () => this.performRequestRaw(method, url, body, responseProcessor, requestHeaders),
      requestHeaders
    )
  }

  private async performRequestRaw<T>(
    method: string,
    url: string,
    body?: unknown,
    responseProcessor?: RequestResponseProcessor<T>,
    requestHeaders?: Record<string, string>
  ): Promise<{ data: T; status: number; headers: Headers }> {

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...requestHeaders,
    }

    Object.assign(headers, buildAuthHeaders(this.credentials));

    const options: RequestInit = { method, headers }
    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetchWithTimeout(url, options)
    const status = response.status
    const responseHeaders = response.headers

    // Only a conditional request can produce this; the caller's copy is current.
    if (status === 304) return { data: undefined as T, status, headers: responseHeaders }

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage: string
      try {
        const errorData = JSON.parse(errorText) as Record<string, unknown>
        // responseDetail.detail / responseDetail.title
        const detail = errorData?.responseDetail as Record<string, unknown> | undefined
        errorMessage = detail ? String(detail.detail ?? detail.title ?? errorText) : errorText
      } catch {
        errorMessage = errorText
      }
      throw new HttpStatusError(status, errorMessage)
    }

    // 204 No Content and empty 200 bodies are legitimate for register/unregister/
    // delete/sync; response.json() would throw SyntaxError on them.
    if (status === 204) {
      return { data: undefined as T, status, headers: responseHeaders }
    }
    let data: unknown
    if (responseProcessor) {
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength === 0) return { data: undefined as T, status, headers: responseHeaders }
      data = traceSpan(`parse ${method} ${new URL(url).pathname}`, () => responseProcessor.process(buffer))
    } else {
      const text = await response.text()
      if (!text.trim()) return { data: undefined as T, status, headers: responseHeaders }
      data = traceSpan(`parse ${method} ${new URL(url).pathname}`, () => JSON.parse(text))
    }

    // Single-value responses are wrapped: {success: true, result: <data>}
    // POST bulk responses use {success, results: [...]} and are handled per-method.
    let unwrapped: unknown = data
    if (!responseProcessor) {
      // A 2xx non-bulk envelope can still report failure; bulk bodies are judged per item by the caller.
      if (isFailedEnvelope(data)) throw envelopeError(data)
      unwrapped = unwrapV1Envelope(data)
    }

    return { data: unwrapped as T, status, headers: responseHeaders }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const { data } = await this.requestRaw<T>(method, path, body)
    return data
  }

  /** The parsed body with its envelope intact: a failure can carry `success: false` beside a null `result`. */
  private async requestEnvelope(method: string, path: string, body?: unknown): Promise<unknown> {
    const { data } = await this.requestRaw<unknown>(method, path, body, {
      shape: 'envelope',
      process: buffer => JSON.parse(new TextDecoder().decode(buffer)),
    })
    return data
  }

  // Probe GET /info and require an i3X 1.0 release server. A server that does
  // not identify as one rejects with UnsupportedServerError; a hung or
  // unreachable server surfaces as itself (TimeoutError or a network error).
  private async verifyServer(): Promise<void> {
    let url = `${this.baseUrl}/info`
    if (url.includes('://localhost:')) {
      url = url.replace('://localhost:', '://127.0.0.1:')
    }
    const headers: Record<string, string> = { 'Accept': 'application/json' }
    Object.assign(headers, buildAuthHeaders(this.credentials));

    const probe = await this.coalesceRead('GET', url, undefined, 'info-probe', async () => {
      const response = await fetchWithTimeout(url, { method: 'GET', headers })
      return {
        ok: response.ok,
        status: response.status,
        redirected: response.redirected,
        url: response.url,
        body: response.ok ? await response.json().catch(() => undefined) : undefined,
      }
    })

    // If the server redirected (e.g. http → https upgrade), adopt the final URL
    // for all subsequent requests. GETs survive a 301/302 redirect but browsers
    // convert POST to GET and drop the body, so every POST would fail otherwise.
    // Only adopt when the final URL still ends in /info, a redirect to some
    // unrelated page (login portal, captive portal) must not corrupt the base.
    if (probe.redirected && probe.url) {
      const match = probe.url.match(/^(.+?)\/info\/?$/)
      if (match) {
        this.baseUrl = match[1]
      }
    }

    // Interpretation lives in readInfoResponse (normalize.ts) so the rules are
    // unit-testable; an unparseable body is signalled as `undefined`.
    const capabilities = readInfoResponse({ ok: probe.ok, status: probe.status, body: probe.body })
    if (capabilities) {
      this.capabilities = capabilities
    }
  }

  // Exploratory Methods (RFC 4.1)

  async getNamespaces(includeMetadata = true): Promise<Namespace[]> {
    // Auto-unwrapped from {success, result: Namespace[]}
    const descriptor = describeGetNamespaces(includeMetadata)
    return this.request<Namespace[]>('GET', pathWithQuery(descriptor))
  }

  async getObjectTypes(namespaceUri?: string, includeMetadata = true): Promise<ObjectType[]> {
    const descriptor = describeGetObjectTypes(namespaceUri, includeMetadata)
    return this.request<ObjectType[]>('GET', pathWithQuery(descriptor))
  }

  async getRelationshipTypes(namespaceUri?: string, includeMetadata = true): Promise<RelationshipType[]> {
    const descriptor = describeGetRelationshipTypes(namespaceUri, includeMetadata)
    return this.request<RelationshipType[]>('GET', pathWithQuery(descriptor))
  }

  async getObjects(typeId?: string, includeMetadata = false, root?: boolean): Promise<ObjectInstance[]> {
    const { data: list } = await this.fetchObjects({ typeId, includeMetadata, rootsOnly: !!root }, {
      shape: 'object-list',
      process: buffer => processObjectResponse(buffer, { buildIndexes: false }),
    })
    return list.objects
  }

  /**
   * The raw full-catalog body (`GET /objects`), for the catalog engine to
   * fingerprint and parse off the main thread. With `ifNoneMatch`, a server that
   * still holds that catalog answers 304 and nothing is downloaded.
   */
  async getObjectCatalogBytes(ifNoneMatch?: string): Promise<CatalogBody> {
    const { data, status, headers } = await this.fetchObjects({
      includeMetadata: false,
      rootsOnly: false,
      lean: true,
      headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
    }, {
      shape: 'object-catalog',
      process: buffer => buffer,
    })
    if (status === 304) return { notModified: true }
    return { notModified: false, buffer: data, etag: headers.get('ETag') }
  }

  /** The raw hierarchy-roots body for the catalog engine. */
  async getRootObjectBytes(): Promise<ArrayBuffer | undefined> {
    const { data } = await this.fetchObjects({ includeMetadata: false, rootsOnly: true, lean: true }, {
      shape: 'root-objects',
      process: buffer => buffer,
    })
    return data
  }

  private async fetchObjects<T>(
    request: ObjectListRequest,
    processor: RequestResponseProcessor<T>
  ): Promise<{ data: T; status: number; headers: Headers }> {
    const descriptor = describeGetObjects(
      request.typeId,
      request.includeMetadata,
      request.rootsOnly,
      request.lean
    )
    return this.requestRaw<T>('GET', pathWithQuery(descriptor), undefined, processor, request.headers)
  }

  async getObject(elementId: string): Promise<ObjectInstance> {
    // GET /objects/{id} does not exist; use POST /objects/list with a single elementId
    const raw = await this.request<unknown>('POST', '/objects/list', {
      elementIds: [elementId],
      includeMetadata: true
    })
    const result = singleBulkResult<Record<string, unknown>>(raw, elementId)
    if (result) return normalizeV1Object(result)
    throw new Error(`Object ${elementId} not found`)
  }

  async getRelatedObjects(
    elementId: string,
    relationshipType?: string
  ): Promise<ObjectInstance[]> {
    // Always include metadata so namespaceUri (metadata.typeNamespaceUri) is populated
    const raw = await this.request<unknown>('POST', '/objects/related', {
      elementIds: [elementId],
      relationshipType,
      includeMetadata: true
    })
    const result = singleBulkResult<Array<Record<string, unknown>>>(raw, elementId)
    return Array.isArray(result) ? result.map(normalizeRelatedEnvelope) : []
  }

  // Batch /objects/related, used to authoritatively determine which parents
  // have qualifying compositional children (for tree chevrons), in one round
  // trip instead of one call per parent.
  async getRelatedObjectsBatch(
    elementIds: string[],
    relationshipType?: string
  ): Promise<RelatedBatchResult> {
    const related = new Map<string, ObjectInstance[]>()
    const failures: ElementFailure[] = []
    if (elementIds.length === 0) return { related, failures }
    const raw = await this.request<unknown>('POST', '/objects/related', {
      elementIds,
      relationshipType,
      includeMetadata: false
    })
    const results = extractV1BulkResults<Array<Record<string, unknown>>>(raw)
    const answered = new Set<string>()
    const unattributed: string[] = []
    for (const item of results) {
      const elementId = resultElementId(item, elementIds, results.length)
      if (elementId === null) {
        if (item.success === false) unattributed.push(failureText(item as unknown as Record<string, unknown>))
        continue
      }
      answered.add(elementId)
      if (item.success === false) failures.push(bulkItemFailure(item, elementId))
      else related.set(elementId, Array.isArray(item.result) ? item.result.map(normalizeRelatedEnvelope) : [])
    }
    failures.push(...unansweredFailures(elementIds, answered, unattributed, raw))
    return { related, failures }
  }

  // Batch POST /objects/list, chunked so a large id set doesn't become one huge
  // request body. Ids the server doesn't know are simply absent.
  async getObjectsByIds(elementIds: string[]): Promise<ObjectInstance[]> {
    return (await this.getObjectDetails(elementIds)).objects
  }

  /**
   * The full objects (with metadata) for these ids, plus every id the server
   * did not resolve: a failed per-element result, or no result at all.
   */
  async getObjectDetails(elementIds: string[]): Promise<ObjectDetailsResult> {
    if (elementIds.length === 0) return { objects: [], failures: [] }
    const objects: ObjectInstance[] = []
    const failures: ObjectDetailsFailure[] = []
    for (let i = 0; i < elementIds.length; i += OBJECTS_LIST_CHUNK_SIZE) {
      const chunk = elementIds.slice(i, i + OBJECTS_LIST_CHUNK_SIZE)
      const raw = await this.request<unknown>('POST', '/objects/list', {
        elementIds: chunk,
        includeMetadata: true
      })
      const answered = new Set<string>()
      const unattributed: string[] = []
      const results = extractV1BulkResults<Record<string, unknown>>(raw)
      for (const item of results) {
        const elementId = resultElementId(item, chunk, results.length)
        if (elementId === null) {
          if (item.success === false) unattributed.push(failureText(item as unknown as Record<string, unknown>))
          continue
        }
        answered.add(elementId)
        if (item.success && item.result) objects.push(normalizeV1Object(item.result))
        else failures.push(bulkItemFailure(item, elementId))
      }
      failures.push(...unansweredFailures(chunk, answered, unattributed, raw))
    }
    return { objects, failures }
  }

  /**
   * Vendor extension (non-conformant) POST /objects/related-by-type: every
   * source element that has a relationship of this type, with its related
   * objects. Paged via a `Link: rel="next"` cursor; all pages are followed.
   */
  async getRelatedObjectsByType(relationshipType: string): Promise<RelatedByTypeResult> {
    const bySource = new Map<string, ObjectInstance[]>()
    const failures: ElementFailure[] = []
    const seenCursors = new Set<string>()
    let cursor: string | null = null
    do {
      const params = new URLSearchParams({ limit: String(RELATED_BY_TYPE_PAGE_SIZE) })
      if (cursor) params.set('cursor', cursor)
      const { data, headers } = await this.requestRaw<unknown>(
        'POST',
        `/objects/related-by-type?${params.toString()}`,
        { relationshipTypes: [relationshipType], includeMetadata: true }
      )
      const items = extractV1BulkResults<Array<Record<string, unknown>>>(data)
      // No ids were requested, so a failed page with no items is a failure of the whole request.
      if (items.length === 0 && bulkEnvelopeFailureText(data) !== undefined) {
        throw envelopeError(data as Record<string, unknown>)
      }
      for (const item of items) {
        if (item.success === false) {
          failures.push(bulkItemFailure(item, relationshipType))
          continue
        }
        if (!Array.isArray(item.result)) continue
        const related = bySource.get(item.elementId) ?? []
        for (const envelope of item.result) related.push(normalizeRelatedEnvelope(envelope))
        bySource.set(item.elementId, related)
      }
      if (cursor) seenCursors.add(cursor)
      cursor = nextCursorFromLink(headers.get('Link'))
    } while (cursor && !seenCursors.has(cursor))
    return { entries: [...bySource].map(([sourceId, related]) => ({ sourceId, related })), failures }
  }

  // Value Methods (RFC 4.2.1)

  async getValue(elementId: string, maxDepth = 1): Promise<LastKnownValue | null> {
    // Bulk results; flat {value, quality, timestamp} in result (no data array)
    const { data: raw, status } = await this.requestRaw<unknown>('POST', '/objects/value', { elementIds: [elementId], maxDepth })
    // HTTP 206 = server-imposed limit truncated the composition tree;
    // the top-level responseDetail explains the limit.
    const partialDetail = status === 206 ? this.extractPartialDetail(raw) : undefined
    const result = singleBulkResult<Record<string, unknown>>(raw, elementId)
    if (result) {
      // isComposition is absent from value responses (spec commit 32be7d7); infer it
      // from the presence of `components` when the result doesn't say.
      return {
        elementId,
        value: result.value as Record<string, unknown>,
        quality: result.quality as string | undefined,
        timestamp: result.timestamp as string | undefined,
        parentId: null,
        isComposition: (result.isComposition as boolean | undefined) ?? ('components' in result),
        components: result.components as LastKnownValue['components'],
        namespaceUri: '',
        rawResponse: raw,
        ...(partialDetail ? { partialDetail } : {})
      } as LastKnownValue
    }
    return null
  }

  async getValues(elementIds: string[], maxDepth = 1): Promise<LastKnownValue[]> {
    const { data: raw, status } = await this.requestRaw<unknown>('POST', '/objects/value', { elementIds, maxDepth })
    const partialDetail = status === 206 ? this.extractPartialDetail(raw) : undefined
    const results = extractV1BulkResults<Record<string, unknown>>(raw)
    return results
      .filter(r => r.success && r.result)
      .map(r => ({
        elementId: r.elementId,
        value: r.result.value as Record<string, unknown>,
        quality: r.result.quality as string | undefined,
        timestamp: r.result.timestamp as string | undefined,
        parentId: null,
        isComposition: (r.result.isComposition as boolean | undefined) ?? ('components' in r.result),
        components: r.result.components as LastKnownValue['components'],
        namespaceUri: '',
        ...(partialDetail ? { partialDetail } : {})
      } as LastKnownValue))
  }

  async getHistory(
    elementId: string,
    startTime?: string,
    endTime?: string,
    maxDepth = 1
  ): Promise<HistoricalValue> {
    const defaultValue: HistoricalValue = {
      elementId,
      value: [],
      timestamp: new Date().toISOString(),
      parentId: null,
      namespaceUri: ''
    }
    // Bulk results; history in result.values (not data).
    // isComposition was removed from history responses (spec commit 32be7d7).
    const raw = await this.request<unknown>(
      'POST', '/objects/history', { elementIds: [elementId], startTime, endTime, maxDepth }
    )
    const result = singleBulkResult<{ values: Record<string, unknown>[] }>(raw, elementId)
    return {
      ...defaultValue,
      value: result?.values ?? []
    }
  }

  // Subscription Methods (RFC 4.2.3)

  async getSubscriptions(): Promise<GetSubscriptionsResponse> {
    // There is no list-all endpoint; caller must track IDs returned from createSubscription
    return { subscriptionIds: [] }
  }

  async createSubscription(): Promise<CreateSubscriptionResponse> {
    // Auto-unwrapped from {success, result: {clientId, subscriptionId, displayName}}
    // The client MUST supply a cryptographically random clientId; store it for all subsequent ops
    const clientId = crypto.randomUUID()
    const response = await this.request<Record<string, unknown>>('POST', '/subscriptions', { clientId })
    const subscriptionId = String(response.subscriptionId)
    this.clientIds.set(subscriptionId, clientId)
    return { subscriptionId, message: 'Subscription created' }
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    // Purge local state even if the server request fails, callers delete
    // subscriptions that may already be expired server-side (404), and the
    // clientId/sequence entries must not outlive the subscription locally.
    try {
      const clientId = this.clientIds.get(subscriptionId)
      await this.request<unknown>('POST', '/subscriptions/delete', { clientId, subscriptionIds: [subscriptionId] })
    } finally {
      this.syncSequenceNumbers.delete(subscriptionId)
      this.clientIds.delete(subscriptionId)
    }
  }

  async registerMonitoredItems(
    subscriptionId: string,
    elementIds: string[],
    maxDepth = 1
  ): Promise<BulkOutcome> {
    const clientId = this.clientIds.get(subscriptionId)
    return bulkOutcome(
      elementIds,
      await this.requestEnvelope('POST', '/subscriptions/register', { clientId, subscriptionId, elementIds, maxDepth })
    )
  }

  /** `maxDepth` repeats the registration depth, so a composition root stops collecting its components too. */
  async unregisterMonitoredItems(
    subscriptionId: string,
    elementIds: string[],
    maxDepth = 1
  ): Promise<BulkOutcome> {
    const clientId = this.clientIds.get(subscriptionId)
    return bulkOutcome(
      elementIds,
      await this.requestEnvelope('POST', '/subscriptions/unregister', { clientId, subscriptionId, elementIds, maxDepth })
    )
  }

  async sync(subscriptionId: string): Promise<SyncResponseItem[]> {
    // subscriptionId in body; auto-unwrapped from {success, result: [...]}
    // The server returns HTTP 206 when queue overflow caused update loss (partial content)
    const lastSeq = this.syncSequenceNumbers.get(subscriptionId)
    const clientId = this.clientIds.get(subscriptionId)
    const { data: raw, status } = await this.requestRaw<Array<Record<string, unknown>>>('POST', '/subscriptions/sync', {
      clientId,
      subscriptionId,
      ...(lastSeq !== undefined ? { lastSequenceNumber: lastSeq } : {})
    })
    if (status === 206) {
      console.warn(`[i3x] sync 206: subscription ${subscriptionId} queue overflowed, some updates were dropped`)
    }

    const items: SyncResponseItem[] = []
    for (const entry of raw ?? []) {
      if (Array.isArray(entry.updates)) {
        // Batch format: {sequenceNumber, updates: [{elementId, value, quality, timestamp}]}
        const batchSeq = entry.sequenceNumber as number | undefined
        if (typeof batchSeq === 'number') {
          const current = this.syncSequenceNumbers.get(subscriptionId) ?? -1
          if (batchSeq > current) this.syncSequenceNumbers.set(subscriptionId, batchSeq)
        }
        items.push(...subscriptionUpdateItems(entry.updates))
      }
    }
    return items
  }

  // Returns the config needed to open an SSE stream:
  // POST /subscriptions/stream (clientId and subscriptionId in body)
  getStreamConfig(subscriptionId: string): StreamConfig {
    const clientId = this.clientIds.get(subscriptionId)
    return {
      url: `${this.baseUrl}/subscriptions/stream`,
      method: 'POST',
      postBody: { clientId, subscriptionId }
    }
  }

  // Connection test, also requires the server to be an i3X 1.0 release
  async testConnection(): Promise<boolean> {
    try {
      await this.verifyServer()
      await this.getNamespaces()
      return true
    } catch (err) {
      // Everything else collapses to a generic "failed to connect", but a
      // timeout is worth naming: it's the difference between "wrong URL" and
      // "the server is up and not answering". A server that is not an i3X 1.0
      // release is a different answer again, and the caller says so, as it does
      // for a server that answered 401/403 and so never got to say what it is.
      if (err instanceof TimeoutError || err instanceof UnsupportedServerError || err instanceof AuthRequiredError) throw err
      return false
    }
  }
}

// Singleton instance
let clientInstance: I3XClient | null = null

export function getClient(): I3XClient | null {
  return clientInstance
}

export function createClient(baseUrl: string, credentials?: ClientCredentials | null): I3XClient {
  clientInstance = new I3XClient(baseUrl, credentials)
  return clientInstance
}

export function destroyClient(): void {
  clientInstance = null
}
