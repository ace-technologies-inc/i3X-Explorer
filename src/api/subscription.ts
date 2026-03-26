import type { SyncResponseItem } from './types'
import type { ClientCredentials } from './client'

export type SubscriptionCallback = (items: SyncResponseItem[]) => void
export type ErrorCallback = (error: Error) => void

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

export class SSESubscription {
  private abortController: AbortController | null = null
  private url: string
  private credentials: ClientCredentials | null
  private postBody: object | undefined
  private onData: SubscriptionCallback
  private onError: ErrorCallback
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private connected = false

  constructor(
    url: string,
    onData: SubscriptionCallback,
    onError: ErrorCallback,
    credentials?: ClientCredentials | null,
    // If provided, the stream is opened with POST + JSON body (v1).
    // If omitted, uses GET (v0).
    postBody?: object
  ) {
    // Fix localhost IPv6 issue - Chromium may prefer IPv6 but servers often only listen on IPv4
    this.url = url.includes('://localhost:')
      ? url.replace('://localhost:', '://127.0.0.1:')
      : url
    this.onData = onData
    this.onError = onError
    this.credentials = credentials ?? null
    this.postBody = postBody
  }

  connect(): void {
    this.disconnect()
    this.abortController = new AbortController()
    this.startFetch()
  }

  private async startFetch(): Promise<void> {
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream'
    }

    if (this.postBody) {
      headers['Content-Type'] = 'application/json'
    }

    if (this.credentials) {
      if (this.credentials.type === 'bearer') {
        headers['Authorization'] = `Bearer ${this.credentials.token}`
      } else {
        const encoded = btoa(`${this.credentials.username}:${this.credentials.password}`)
        headers['Authorization'] = `Basic ${encoded}`
      }
    }

    try {
      const response = await fetch(this.url, {
        method: this.postBody ? 'POST' : 'GET',
        headers,
        body: this.postBody ? JSON.stringify(this.postBody) : undefined,
        signal: this.abortController?.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      console.log('SSE connection opened')
      this.connected = true
      this.reconnectAttempts = 0

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            if (dataStr.trim()) {
              this.processMessage(dataStr)
            }
          }
        }
      }

      // Stream ended normally
      this.connected = false
      this.handleDisconnect()
    } catch (err) {
      this.connected = false
      if (err instanceof Error && err.name === 'AbortError') {
        // Intentional disconnect, don't reconnect
        return
      }
      console.error('SSE error:', err)
      this.handleDisconnect()
    }
  }

  private processMessage(dataStr: string): void {
    try {
      const rawData = JSON.parse(dataStr) as Array<Record<string, unknown>>
      const items: SyncResponseItem[] = []
      for (const entry of rawData) {
        if (typeof entry.elementId === 'string') {
          // v1 flat format: {elementId, value, quality, timestamp}
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
      if (items.length > 0) {
        this.onData(items)
      }
    } catch (err) {
      console.error('Failed to parse SSE data:', err)
    }
  }

  private handleDisconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

      setTimeout(() => {
        this.abortController = new AbortController()
        this.startFetch()
      }, delay)
    } else {
      this.onError(new Error('Max reconnection attempts reached'))
    }
  }

  disconnect(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this.connected = false
    this.reconnectAttempts = 0
  }

  isConnected(): boolean {
    return this.connected
  }
}

// Polling-based subscription (QoS 2 fallback)
export class PollingSubscription {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private syncFn: () => Promise<SyncResponseItem[]>
  private onData: SubscriptionCallback
  private onError: ErrorCallback
  private pollInterval: number

  constructor(
    syncFn: () => Promise<SyncResponseItem[]>,
    onData: SubscriptionCallback,
    onError: ErrorCallback,
    pollInterval = 1000
  ) {
    this.syncFn = syncFn
    this.onData = onData
    this.onError = onError
    this.pollInterval = pollInterval
  }

  start(): void {
    this.stop()
    this.poll() // Initial poll
    this.intervalId = setInterval(() => this.poll(), this.pollInterval)
  }

  private async poll(): Promise<void> {
    try {
      const items = await this.syncFn()
      if (items.length > 0) {
        this.onData(items)
      }
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null
  }
}
