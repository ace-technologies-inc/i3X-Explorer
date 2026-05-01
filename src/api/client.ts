import type {
  Namespace,
  ObjectType,
  ObjectInstance,
  RelationshipType,
  LastKnownValue,
  HistoricalValue,
  CreateSubscriptionResponse,
  SyncResponseItem,
  GetSubscriptionsResponse
} from './types'

import type { Credentials } from '../stores/connection'

export type ClientCredentials = Credentials

// v0 = Alpha, v1-beta = v1 Beta, v1 = v1 Release (1.0+)
export type ApiVersion = 'v0' | 'v1-beta' | 'v1'

// #TODO: Discuss this nested payload format suggested by Dylan DuFresne as a potential alternative
// Extracts value/quality/timestamp from either standard format or nested Data.Value format
// Standard: { value: X, quality: Y, timestamp: Z }
// Nested value: { value: { Data: { Value: X, Quality: Y, Timestamp: Z }, Source: {...} } }
function extractVQT(payload: Record<string, unknown>): { value: unknown; quality?: string; timestamp?: string } {
  if (payload.value && typeof payload.value === 'object' && payload.value !== null) {
    const valueObj = payload.value as Record<string, unknown>
    if (valueObj.Data && typeof valueObj.Data === 'object') {
      const data = valueObj.Data as Record<string, unknown>
      return {
        value: data.Value,
        quality: data.Quality as string | undefined,
        timestamp: data.Timestamp as string | undefined
      }
    }
  }
  return {
    value: payload.value,
    quality: payload.quality as string | undefined,
    timestamp: payload.timestamp as string | undefined
  }
}

// v1 object instances use typeElementId instead of typeId, and may omit namespaceUri.
// As of commit 27f15c7, metadata fields (typeNamespaceUri, relationships, etc.) are
// nested under raw.metadata rather than being flat on the object.
// Normalize to the ObjectInstance shape used throughout the app.
function normalizeV1Object(raw: Record<string, unknown>): ObjectInstance {
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>
  // Beta called this extendedAttributes; 1.0 renamed it schemaExtensions. Accept both.
  const schemaExtensions = (
    metadata.schemaExtensions ?? metadata.extendedAttributes ??
    raw.schemaExtensions ?? raw.extendedAttributes
  ) as Record<string, unknown> | undefined
  return {
    elementId: raw.elementId as string,
    displayName: raw.displayName as string,
    typeId: ((raw.typeElementId ?? raw.typeId) as string) ?? '',
    parentId: (raw.parentId as string | null) ?? null,
    isComposition: (raw.isComposition as boolean) ?? false,
    isExtended: (raw.isExtended as boolean) ?? false,
    namespaceUri: ((raw.namespaceUri ?? metadata.typeNamespaceUri) as string) ?? '',
    description: (metadata.description as string) ?? undefined,
    relationships: (metadata.relationships ?? raw.relationships) as Record<string, unknown> | undefined,
    sourceRelationship: raw.sourceRelationship as string | undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    ...(schemaExtensions ? { schemaExtensions } : {})
  }
}

// v1 POST bulk responses: {success, results: [{success, elementId, result: T}]}
// Returns the results array, or empty array if the shape doesn't match.
function extractV1BulkResults<T>(raw: unknown): Array<{ success: boolean; elementId: string; result: T }> {
  if (raw && typeof raw === 'object' && 'results' in (raw as object)) {
    return ((raw as Record<string, unknown>).results as Array<{ success: boolean; elementId: string; result: T }>) ?? []
  }
  return []
}

export interface StreamConfig {
  url: string
  method: 'GET' | 'POST'
  postBody?: object
}

export class I3XClient {
  private baseUrl: string
  private credentials: ClientCredentials | null
  private apiVersion: ApiVersion = 'v0'
  // Track last seen sequence number per subscription for v1 sync acknowledgment
  private syncSequenceNumbers = new Map<string, number>()

  constructor(baseUrl: string, credentials?: ClientCredentials | null) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.credentials = credentials ?? null
  }

  private getAuthHeader(): string | null {
    if (!this.credentials) return null
    if (this.credentials.type === 'bearer') {
      return `Bearer ${this.credentials.token}`
    }
    const encoded = btoa(`${this.credentials.username}:${this.credentials.password}`)
    return `Basic ${encoded}`
  }

  getCredentials(): ClientCredentials | null {
    return this.credentials
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getApiVersion(): ApiVersion {
    return this.apiVersion
  }

  // True for v1-beta and v1 (Release) — any server that speaks the v1 wire format
  private isV1(): boolean {
    return this.apiVersion === 'v1' || this.apiVersion === 'v1-beta'
  }

  // Returns parsed response body plus the raw HTTP status code.
  // Use this when the caller needs to inspect the status (e.g. 206 Partial Content from /sync).
  private async requestRaw<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ data: T; status: number }> {
    // Fix localhost IPv6 issue - Chromium may prefer IPv6 but servers often only listen on IPv4
    let url = `${this.baseUrl}${path}`
    if (url.includes('://localhost:')) {
      url = url.replace('://localhost:', '://127.0.0.1:')
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }

    const authHeader = this.getAuthHeader()
    if (authHeader) {
      headers['Authorization'] = authHeader
    }

    const options: RequestInit = { method, headers }
    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)
    const status = response.status

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `HTTP ${status}`
      try {
        const errorData = JSON.parse(errorText) as Record<string, unknown>
        // 1.0: responseDetail.detail / responseDetail.title
        // Beta: problemDetail.detail / problemDetail.title
        // Alpha/v0: error.message / error.code
        const detail = (errorData?.responseDetail ?? errorData?.problemDetail ?? errorData?.error) as Record<string, unknown> | undefined
        if (detail) {
          errorMessage += `: ${detail.detail ?? detail.message ?? detail.title ?? errorText}`
        } else {
          errorMessage += `: ${errorText}`
        }
      } catch {
        errorMessage += `: ${errorText}`
      }
      throw new Error(errorMessage)
    }

    const data = await response.json()

    // v1 wraps single-value responses: {success: true, result: <data>}
    // POST bulk responses use {success, results: [...]} and are handled per-method.
    let unwrapped: unknown = data
    if (this.isV1() && data && typeof data === 'object') {
      const d = data as Record<string, unknown>
      if ('result' in d && !('results' in d)) {
        unwrapped = d.result
      }
    }

    return { data: unwrapped as T, status }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const { data } = await this.requestRaw<T>(method, path, body)
    return data
  }

  // Detect API version by probing GET /info (v1 only). Falls back to v0.
  // Distinguishes v1-beta from v1 (Release) by looking for a specVersion/version field in /info.
  private async detectVersion(): Promise<void> {
    try {
      let url = `${this.baseUrl}/info`
      if (url.includes('://localhost:')) {
        url = url.replace('://localhost:', '://127.0.0.1:')
      }
      const headers: Record<string, string> = { 'Accept': 'application/json' }
      const authHeader = this.getAuthHeader()
      if (authHeader) headers['Authorization'] = authHeader

      const response = await fetch(url, { method: 'GET', headers })
      if (!response.ok) {
        this.apiVersion = 'v0'
        return
      }

      // Try to read a version field from the /info body.
      // 1.0 servers are expected to advertise specVersion / version / apiVersion >= "1.0".
      try {
        const body = await response.json() as Record<string, unknown>
        // v1 wraps the payload: {success, result: {...}}; also accept unwrapped bodies
        const info = (body.result ?? body) as Record<string, unknown>
        const serverVersion = String(info.serverVersion ?? '').toLowerCase()
        const specRaw = (info.specVersion ?? info.version ?? info.apiVersion ?? '') as string
        const specMajor = parseFloat(specRaw)
        const isRelease = !isNaN(specMajor) && specMajor >= 1.0 && !serverVersion.includes('beta')
        this.apiVersion = isRelease ? 'v1' : 'v1-beta'
      } catch {
        // /info responded OK but body isn't useful — treat as Beta
        this.apiVersion = 'v1-beta'
      }
    } catch {
      this.apiVersion = 'v0'
    }
  }

  // Exploratory Methods (RFC 4.1)

  async getNamespaces(): Promise<Namespace[]> {
    // v0: Namespace[]  v1: auto-unwrapped from {success, result: Namespace[]}
    return this.request<Namespace[]>('GET', '/namespaces')
  }

  async getObjectTypes(namespaceUri?: string): Promise<ObjectType[]> {
    const params = namespaceUri ? `?namespaceUri=${encodeURIComponent(namespaceUri)}` : ''
    // ObjectType shape is compatible between v0 and v1 (extra fields ignored)
    return this.request<ObjectType[]>('GET', `/objecttypes${params}`)
  }

  async getObjectType(elementId: string): Promise<ObjectType> {
    return this.request<ObjectType>('GET', `/objecttypes/${encodeURIComponent(elementId)}`)
  }

  async getRelationshipTypes(namespaceUri?: string): Promise<RelationshipType[]> {
    const params = namespaceUri ? `?namespaceUri=${encodeURIComponent(namespaceUri)}` : ''
    // RelationshipType shape is compatible between v0 and v1 (extra fields ignored)
    return this.request<RelationshipType[]>('GET', `/relationshiptypes${params}`)
  }

  async getObjects(typeId?: string, includeMetadata = false, root?: boolean): Promise<ObjectInstance[]> {
    const params = new URLSearchParams()
    // v1 renamed the query param: typeId → typeElementId
    if (typeId) params.set(this.isV1() ? 'typeElementId' : 'typeId', typeId)
    // v1: always request metadata so namespaceUri (metadata.typeNamespaceUri) is present
    params.set('includeMetadata', String(this.isV1() ? true : includeMetadata))
    // v1 supports root=true server-side; v0 doesn't have this param so we filter locally below.
    if (root && this.isV1()) params.set('root', 'true')
    const raw = await this.request<Array<Record<string, unknown>>>('GET', `/objects?${params.toString()}`)
    if (this.isV1()) {
      return raw.map(normalizeV1Object)
    }
    const all = raw as unknown as ObjectInstance[]
    // v0: simulate root filtering locally — root objects have parentId === '/'
    if (root) return all.filter(obj => obj.parentId === '/')
    return all
  }

  async getObject(elementId: string, includeMetadata = false): Promise<ObjectInstance> {
    // v1: always request metadata so namespaceUri (metadata.typeNamespaceUri) is present
    const params = `?includeMetadata=${this.isV1() ? true : includeMetadata}`
    const raw = await this.request<Record<string, unknown>>('GET', `/objects/${encodeURIComponent(elementId)}${params}`)
    if (this.isV1()) {
      return normalizeV1Object(raw)
    }
    return raw as unknown as ObjectInstance
  }

  async getRelatedObjects(
    elementId: string,
    relationshipType?: string,
    includeMetadata = false
  ): Promise<ObjectInstance[]> {
    if (this.isV1()) {
      // v1: subscriptionId in body, camelCase field, bulk results response
      // Always include metadata so namespaceUri (metadata.typeNamespaceUri) is populated
      const raw = await this.request<unknown>('POST', '/objects/related', {
        elementIds: [elementId],
        relationshipType,
        includeMetadata: true
      })
      const results = extractV1BulkResults<Array<Record<string, unknown>>>(raw)
      const objects: ObjectInstance[] = []
      for (const item of results) {
        if (item.success && Array.isArray(item.result)) {
          for (const envelope of item.result) {
            // Each entry is { sourceRelationship, object: {...} } (spec commit 51593eb).
            // sourceRelationship is on the envelope, not the inner object — inject it so
            // normalizeV1Object can map it onto ObjectInstance.sourceRelationship.
            const inner = (envelope.object ?? envelope) as Record<string, unknown>
            const raw = envelope.object
              ? { ...inner, sourceRelationship: envelope.sourceRelationship }
              : inner
            objects.push(normalizeV1Object(raw as Record<string, unknown>))
          }
        }
      }
      return objects
    }
    // v0: lowercase field, direct array response
    return this.request<ObjectInstance[]>('POST', '/objects/related', {
      elementIds: [elementId],
      relationshiptype: relationshipType,
      includeMetadata
    })
  }

  // Value Methods (RFC 4.2.1)

  async getValue(elementId: string, maxDepth = 1): Promise<LastKnownValue | null> {
    if (this.isV1()) {
      // v1: bulk results; flat {value, quality, timestamp} in result (no data array)
      const raw = await this.request<unknown>('POST', '/objects/value', { elementIds: [elementId], maxDepth })
      const results = extractV1BulkResults<Record<string, unknown>>(raw)
      const item = results.find(r => r.elementId === elementId && r.success)
      if (item?.result) {
        // isComposition was removed from v1 value responses (spec commit 32be7d7);
        // infer it from the presence of the components field instead.
        return {
          elementId,
          value: item.result.value as Record<string, unknown>,
          quality: item.result.quality as string | undefined,
          timestamp: item.result.timestamp as string | undefined,
          parentId: null,
          isComposition: 'components' in item.result,
          components: item.result.components as LastKnownValue['components'],
          namespaceUri: ''
        } as LastKnownValue
      }
      return null
    }
    // v0: {elementId: {data: [{value, quality, timestamp}]}}
    const response = await this.request<Record<string, { data: Array<Record<string, unknown>> }>>(
      'POST', '/objects/value', { elementIds: [elementId], maxDepth }
    )
    const entry = response[elementId]
    if (entry?.data?.[0]) {
      const vqt = extractVQT(entry.data[0])
      return { elementId, ...vqt } as LastKnownValue
    }
    return null
  }

  async getValues(elementIds: string[], maxDepth = 1): Promise<LastKnownValue[]> {
    if (this.isV1()) {
      const raw = await this.request<unknown>('POST', '/objects/value', { elementIds, maxDepth })
      const results = extractV1BulkResults<Record<string, unknown>>(raw)
      return results
        .filter(r => r.success && r.result)
        .map(r => ({
          elementId: r.elementId,
          value: r.result.value as Record<string, unknown>,
          quality: r.result.quality as string | undefined,
          timestamp: r.result.timestamp as string | undefined,
          parentId: null,
          isComposition: 'components' in r.result,
          components: r.result.components as LastKnownValue['components'],
          namespaceUri: ''
        } as LastKnownValue))
    }
    // v0
    const response = await this.request<Record<string, { data: Array<Record<string, unknown>> }>>(
      'POST', '/objects/value', { elementIds, maxDepth }
    )
    const values: LastKnownValue[] = []
    for (const id of elementIds) {
      const entry = response[id]
      if (entry?.data?.[0]) {
        const vqt = extractVQT(entry.data[0])
        values.push({ elementId: id, ...vqt } as LastKnownValue)
      }
    }
    return values
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
    if (this.isV1()) {
      // v1: bulk results; history in result.values (not data).
      // isComposition was removed from v1 history responses (spec commit 32be7d7).
      const raw = await this.request<unknown>(
        'POST', '/objects/history', { elementIds: [elementId], startTime, endTime, maxDepth }
      )
      const results = extractV1BulkResults<{ values: Record<string, unknown>[] }>(raw)
      const item = results.find(r => r.elementId === elementId && r.success)
      return {
        ...defaultValue,
        value: item?.result?.values ?? []
      }
    }
    // v0: {elementId: {data: [...]}}
    const response = await this.request<Record<string, { data: Record<string, unknown>[] }>>(
      'POST', '/objects/history', { elementIds: [elementId], startTime, endTime, maxDepth }
    )
    const entry = response[elementId]
    if (entry?.data) {
      return { ...defaultValue, value: entry.data }
    }
    return defaultValue
  }

  // Subscription Methods (RFC 4.2.3)

  async getSubscriptions(): Promise<GetSubscriptionsResponse> {
    if (this.isV1()) {
      // v1 has no list-all endpoint; caller must track IDs returned from createSubscription
      return { subscriptionIds: [] }
    }
    return this.request<GetSubscriptionsResponse>('GET', '/subscriptions')
  }

  async createSubscription(): Promise<CreateSubscriptionResponse> {
    // v0: {subscriptionId, message}
    // v1: auto-unwrapped from {success, result: {clientId, subscriptionId, displayName}}
    // v1 (1.0): client must supply a cryptographically random clientId (issue #27)
    const body = this.isV1()
      ? { clientId: crypto.randomUUID() }
      : {}
    const response = await this.request<Record<string, unknown>>('POST', '/subscriptions', body)
    return {
      subscriptionId: String(response.subscriptionId),
      message: (response.message as string | undefined) ?? 'Subscription created'
    }
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    if (this.isV1()) {
      // v1: DELETE replaced by POST /subscriptions/delete with IDs in body
      await this.request<unknown>('POST', '/subscriptions/delete', { subscriptionIds: [subscriptionId] })
    } else {
      await this.request<unknown>('DELETE', `/subscriptions/${subscriptionId}`)
    }
    this.syncSequenceNumbers.delete(subscriptionId)
  }

  async registerMonitoredItems(
    subscriptionId: string,
    elementIds: string[],
    maxDepth = 1
  ): Promise<unknown> {
    if (this.isV1()) {
      // v1: subscriptionId moved from URL path to request body
      return this.request<unknown>('POST', '/subscriptions/register', { subscriptionId, elementIds, maxDepth })
    }
    return this.request<unknown>('POST', `/subscriptions/${subscriptionId}/register`, { elementIds, maxDepth })
  }

  async unregisterMonitoredItems(
    subscriptionId: string,
    elementIds: string[]
  ): Promise<unknown> {
    if (this.isV1()) {
      return this.request<unknown>('POST', '/subscriptions/unregister', { subscriptionId, elementIds })
    }
    return this.request<unknown>('POST', `/subscriptions/${subscriptionId}/unregister`, { elementIds })
  }

  async sync(subscriptionId: string): Promise<SyncResponseItem[]> {
    let raw: Array<Record<string, unknown>>

    if (this.isV1()) {
      // v1: subscriptionId in body; auto-unwrapped from {success, result: [...]}
      // 1.0: server returns HTTP 206 when queue overflow caused update loss (partial content)
      const lastSeq = this.syncSequenceNumbers.get(subscriptionId)
      const { data, status } = await this.requestRaw<Array<Record<string, unknown>>>('POST', '/subscriptions/sync', {
        subscriptionId,
        ...(lastSeq !== undefined ? { lastSequenceNumber: lastSeq } : {})
      })
      raw = data
      if (status === 206) {
        console.warn(`[i3x] sync 206: subscription ${subscriptionId} queue overflowed — some updates were dropped`)
      }
    } else {
      raw = await this.request<Array<Record<string, unknown>>>('POST', `/subscriptions/${subscriptionId}/sync`)
    }

    const items: SyncResponseItem[] = []
    for (const entry of raw ?? []) {
      if (typeof entry.elementId === 'string') {
        // v1 flat format: {elementId, value, quality, timestamp}
        const seq = entry.sequenceNumber
        if (typeof seq === 'number') {
          const current = this.syncSequenceNumbers.get(subscriptionId) ?? -1
          if (seq > current) this.syncSequenceNumbers.set(subscriptionId, seq)
        }
        items.push({
          elementId: entry.elementId,
          value: entry.value,
          quality: (entry.quality as string | null) ?? null,
          timestamp: (entry.timestamp as string | null) ?? null
        })
      } else {
        // v0 keyed format: {elementId: {data: [{value, quality, timestamp}]}}
        for (const [elementId, payload] of Object.entries(entry)) {
          const p = payload as Record<string, unknown>
          if (p?.data && Array.isArray(p.data) && p.data[0]) {
            const vqt = extractVQT(p.data[0] as Record<string, unknown>)
            items.push({
              elementId,
              value: vqt.value,
              quality: vqt.quality ?? null,
              timestamp: vqt.timestamp ?? null
            })
          }
        }
      }
    }
    return items
  }

  // Returns the config needed to open an SSE stream.
  // v0: GET /subscriptions/{id}/stream
  // v1: POST /subscriptions/stream  (subscriptionId in body)
  getStreamConfig(subscriptionId: string): StreamConfig {
    if (this.isV1()) {
      return {
        url: `${this.baseUrl}/subscriptions/stream`,
        method: 'POST',
        postBody: { subscriptionId }
      }
    }
    return {
      url: `${this.baseUrl}/subscriptions/${subscriptionId}/stream`,
      method: 'GET'
    }
  }

  // Connection test — also detects API version (v0 vs v1)
  async testConnection(): Promise<boolean> {
    try {
      await this.detectVersion()
      await this.getNamespaces()
      return true
    } catch {
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
