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

// #TODO: Discuss this nested payload format suggested by Dylan DuFresne as a potential alternative
// Extracts value/quality/timestamp from either standard format or nested Data.Value format
// Standard: { value: X, quality: Y, timestamp: Z }
// Nested value: { value: { Data: { Value: X, Quality: Y, Timestamp: Z }, Source: {...} } }
function extractVQT(payload: Record<string, unknown>): { value: unknown; quality?: string; timestamp?: string } {
  // Check if the value field contains the nested Data structure
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
  // Standard format
  return {
    value: payload.value,
    quality: payload.quality as string | undefined,
    timestamp: payload.timestamp as string | undefined
  }
}

export class I3XClient {
  private baseUrl: string
  private credentials: ClientCredentials | null

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

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
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

    const options: RequestInit = {
      method,
      headers
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    return response.json()
  }

  // Exploratory Methods (RFC 4.1)

  async getNamespaces(): Promise<Namespace[]> {
    return this.request<Namespace[]>('GET', '/namespaces')
  }

  async getObjectTypes(namespaceUri?: string): Promise<ObjectType[]> {
    const params = namespaceUri ? `?namespaceUri=${encodeURIComponent(namespaceUri)}` : ''
    return this.request<ObjectType[]>('GET', `/objecttypes${params}`)
  }

  async getObjectType(elementId: string): Promise<ObjectType> {
    return this.request<ObjectType>('GET', `/objecttypes/${encodeURIComponent(elementId)}`)
  }

  async getRelationshipTypes(namespaceUri?: string): Promise<RelationshipType[]> {
    const params = namespaceUri ? `?namespaceUri=${encodeURIComponent(namespaceUri)}` : ''
    return this.request<RelationshipType[]>('GET', `/relationshiptypes${params}`)
  }

  async getObjects(typeId?: string, includeMetadata = false): Promise<ObjectInstance[]> {
    const params = new URLSearchParams()
    if (typeId) params.set('typeId', typeId)
    params.set('includeMetadata', String(includeMetadata))
    const queryString = params.toString()
    return this.request<ObjectInstance[]>('GET', `/objects?${queryString}`)
  }

  async getObject(elementId: string, includeMetadata = false): Promise<ObjectInstance> {
    const params = `?includeMetadata=${includeMetadata}`
    return this.request<ObjectInstance>('GET', `/objects/${encodeURIComponent(elementId)}${params}`)
  }

  async getRelatedObjects(
    elementId: string,
    relationshipType?: string,
    includeMetadata = false
  ): Promise<ObjectInstance[]> {
    // Returns direct array
    return this.request<ObjectInstance[]>('POST', '/objects/related', {
      elementIds: [elementId],
      relationshiptype: relationshipType,
      includeMetadata
    })
  }

  // Value Methods (RFC 4.2.1)

  async getValue(elementId: string, maxDepth = 1): Promise<LastKnownValue | null> {
    // Response format: {elementId: {data: [{value, quality, timestamp}]}}
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
    // Response format: {elementId: {data: [{value, quality, timestamp}]}, ...}
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
    // Response format: {elementId: {data: [...]}}
    const response = await this.request<Record<string, { data: Record<string, unknown>[] }>>(
      'POST', '/objects/history', { elementIds: [elementId], startTime, endTime, maxDepth }
    )
    const defaultValue: HistoricalValue = {
      elementId,
      value: [],
      timestamp: new Date().toISOString(),
      parentId: null,
      isComposition: false,
      namespaceUri: ''
    }
    const entry = response[elementId]
    if (entry?.data) {
      return { ...defaultValue, value: entry.data }
    }
    return defaultValue
  }

  // Subscription Methods (RFC 4.2.3)

  async getSubscriptions(): Promise<GetSubscriptionsResponse> {
    return this.request<GetSubscriptionsResponse>('GET', '/subscriptions')
  }

  async createSubscription(): Promise<CreateSubscriptionResponse> {
    return this.request<CreateSubscriptionResponse>('POST', '/subscriptions', {})
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await this.request<unknown>('DELETE', `/subscriptions/${subscriptionId}`)
  }

  async registerMonitoredItems(
    subscriptionId: string,
    elementIds: string[],
    maxDepth = 1
  ): Promise<unknown> {
    return this.request<unknown>(
      'POST',
      `/subscriptions/${subscriptionId}/register`,
      { elementIds, maxDepth }
    )
  }

  async unregisterMonitoredItems(
    subscriptionId: string,
    elementIds: string[]
  ): Promise<unknown> {
    return this.request<unknown>(
      'POST',
      `/subscriptions/${subscriptionId}/unregister`,
      { elementIds }
    )
  }

  async sync(subscriptionId: string): Promise<SyncResponseItem[]> {
    // Response format: [{elementId: {data: [{value, quality, timestamp}]}}, ...]
    const response = await this.request<Array<Record<string, { data: Array<Record<string, unknown>> }>>>(
      'POST',
      `/subscriptions/${subscriptionId}/sync`
    )
    const items: SyncResponseItem[] = []
    for (const entry of response) {
      for (const [elementId, payload] of Object.entries(entry)) {
        if (payload?.data?.[0]) {
          const vqt = extractVQT(payload.data[0])
          items.push({
            elementId,
            value: vqt.value,
            quality: vqt.quality ?? null,
            timestamp: vqt.timestamp ?? null
          })
        }
      }
    }
    return items
  }

  getStreamUrl(subscriptionId: string): string {
    return `${this.baseUrl}/subscriptions/${subscriptionId}/stream`
  }

  // Connection test
  async testConnection(): Promise<boolean> {
    try {
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
