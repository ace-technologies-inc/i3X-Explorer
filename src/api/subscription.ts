import type { SyncResponseItem } from './types'

export type SubscriptionCallback = (items: SyncResponseItem[]) => void
export type ErrorCallback = (error: Error) => void

export class SSESubscription {
  private eventSource: EventSource | null = null
  private url: string
  private onData: SubscriptionCallback
  private onError: ErrorCallback
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor(
    url: string,
    onData: SubscriptionCallback,
    onError: ErrorCallback
  ) {
    this.url = url
    this.onData = onData
    this.onError = onError
  }

  connect(): void {
    if (this.eventSource) {
      this.disconnect()
    }

    this.eventSource = new EventSource(this.url)

    this.eventSource.onopen = () => {
      console.log('SSE connection opened')
      this.reconnectAttempts = 0
    }

    this.eventSource.onmessage = (event) => {
      try {
        const rawData = JSON.parse(event.data) as Array<Record<string, { data: Array<{ value: unknown; quality?: string; timestamp?: string }> }>>
        // Convert new keyed format to SyncResponseItem[]
        const items: SyncResponseItem[] = []
        for (const entry of rawData) {
          for (const [elementId, payload] of Object.entries(entry)) {
            if (payload?.data?.[0]) {
              items.push({
                elementId,
                value: payload.data[0].value,
                quality: payload.data[0].quality ?? null,
                timestamp: payload.data[0].timestamp ?? null
              })
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

    this.eventSource.onerror = (event) => {
      console.error('SSE error:', event)

      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.handleDisconnect()
      }
    }
  }

  private handleDisconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

      setTimeout(() => {
        this.connect()
      }, delay)
    } else {
      this.onError(new Error('Max reconnection attempts reached'))
    }
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this.reconnectAttempts = 0
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN
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
