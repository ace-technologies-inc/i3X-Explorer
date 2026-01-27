// RFC 4.1.1 - Namespace
export interface Namespace {
  uri: string
  displayName: string
}

// RFC 4.1.2/4.1.3 - Object Type
export interface ObjectType {
  elementId: string
  displayName: string
  namespaceUri: string
  schema: Record<string, unknown>
}

// RFC 4.1.4/4.1.5 - Relationship Type
export interface RelationshipType {
  elementId: string
  displayName: string
  namespaceUri: string
  reverseOf: string
}

// RFC 3.1.1 - Object Instance (Minimal)
export interface ObjectInstanceMinimal {
  elementId: string
  displayName: string
  typeId: string
  parentId: string | null
  isComposition: boolean
  namespaceUri: string
}

// RFC 3.1.1 + 3.1.2 - Object Instance (Full)
export interface ObjectInstance extends ObjectInstanceMinimal {
  relationships?: Record<string, unknown>
}

// RFC 4.2.1.1 - Last Known Value
export interface LastKnownValue {
  elementId: string
  value: Record<string, unknown>
  parentId: string | null
  isComposition: boolean
  namespaceUri: string
  dataType?: string
  timestamp?: string
}

// RFC 4.2.1.2 - Historical Value
export interface HistoricalValue {
  elementId: string
  value: Record<string, unknown> | Array<Record<string, unknown>>
  timestamp: string
  parentId: string | null
  isComposition: boolean
  namespaceUri: string
  dataType?: string
}

// Subscription types
export interface SubscriptionSummary {
  subscriptionId: number
  created: string
}

export interface GetSubscriptionsResponse {
  subscriptionIds: SubscriptionSummary[]
}

export interface CreateSubscriptionResponse {
  subscriptionId: string
  message: string
}

export interface SyncResponseItem {
  elementId: string
  value: unknown
  timestamp: string | null
  quality: string | null
  [key: string]: unknown
}

// Batch response types
export interface BatchResult<T> {
  elementId: string
  success: boolean
  data?: T
  error?: string
}

export interface BatchResponse<T> {
  results: BatchResult<T>[]
  totalRequested: number
  totalSuccess: number
  totalFailed: number
}
