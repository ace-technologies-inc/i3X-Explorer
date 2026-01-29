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

export class I3XClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
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
    // Handle both wrapped {results:[...]} and direct array formats
    const response = await this.request<
      ObjectInstance[] | { results: Array<{ elementId: string; success: boolean; data: ObjectInstance[] }> }
    >('POST', '/objects/related', {
      elementIds: [elementId],
      relationshiptype: relationshipType,
      includeMetadata
    })
    // Unwrap if needed
    if (Array.isArray(response)) {
      return response
    }
    const result = response.results?.[0]
    return result?.success && Array.isArray(result.data) ? result.data : []
  }

  // Value Methods (RFC 4.2.1)

  async getValue(elementId: string, maxDepth = 1): Promise<LastKnownValue | null> {
    // Handle both wrapped {results:[...]} and direct array formats
    const response = await this.request<
      LastKnownValue[] | { results: Array<{ elementId: string; success: boolean; data: LastKnownValue }> }
    >('POST', '/objects/value', {
      elementIds: [elementId],
      maxDepth
    })
    // Unwrap if needed
    if (Array.isArray(response)) {
      return response?.[0] ?? null
    }
    const result = response.results?.[0]
    return result?.success && result.data ? result.data : null
  }

  async getValues(elementIds: string[], maxDepth = 1): Promise<LastKnownValue[]> {
    // Handle both wrapped {results:[...]} and direct array formats
    const response = await this.request<
      LastKnownValue[] | { results: Array<{ data: LastKnownValue }> }
    >('POST', '/objects/value', { elementIds, maxDepth })
    // Unwrap if needed
    if (Array.isArray(response)) {
      return response
    }
    return response.results.filter(r => r.data).map(r => r.data)
  }

  async getHistory(
    elementId: string,
    startTime?: string,
    endTime?: string,
    maxDepth = 1
  ): Promise<HistoricalValue> {
    // Handle both wrapped {results:[...]} and direct array formats
    const response = await this.request<
      HistoricalValue[] | { results: Array<{ elementId: string; success: boolean; data: HistoricalValue }> }
    >('POST', '/objects/history', {
      elementIds: [elementId],
      startTime,
      endTime,
      maxDepth
    })
    // Unwrap if needed
    const defaultValue: HistoricalValue = {
      elementId,
      value: [],
      timestamp: new Date().toISOString(),
      parentId: null,
      isComposition: false,
      namespaceUri: ''
    }
    if (Array.isArray(response)) {
      return response?.[0] ?? defaultValue
    }
    const result = response.results?.[0]
    return result?.success && result.data ? result.data : defaultValue
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
    return this.request<SyncResponseItem[]>(
      'POST',
      `/subscriptions/${subscriptionId}/sync`
    )
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

export function createClient(baseUrl: string): I3XClient {
  clientInstance = new I3XClient(baseUrl)
  return clientInstance
}

export function destroyClient(): void {
  clientInstance = null
}
