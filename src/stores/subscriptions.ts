import { create } from 'zustand'

export interface LiveValue {
  elementId: string
  displayName: string
  value: unknown
  timestamp: string | null
  quality: string | null
  lastUpdated: number // for triggering flash animation
}

export interface TrendPoint {
  value: number
  timestamp: number // ms since epoch
}

// Max points to keep in trend history
const MAX_TREND_POINTS = 60

export interface Subscription {
  id: string
  createdAt: string
  monitoredItems: string[] // elementIds
  isStreaming: boolean
}

interface SubscriptionsState {
  subscriptions: Map<string, Subscription>
  liveValues: Map<string, LiveValue>
  trendData: Map<string, TrendPoint[]> // keyed by elementId
  activeSubscriptionId: string | null
  isBottomPanelExpanded: boolean

  addSubscription: (sub: Subscription) => void
  removeSubscription: (id: string) => void
  setActiveSubscription: (id: string | null) => void
  addMonitoredItem: (subscriptionId: string, elementId: string) => void
  removeMonitoredItem: (subscriptionId: string, elementId: string) => void
  updateLiveValue: (value: LiveValue) => void
  setStreaming: (subscriptionId: string, streaming: boolean) => void
  setBottomPanelExpanded: (expanded: boolean) => void
  clearAll: () => void
}

export const useSubscriptionsStore = create<SubscriptionsState>((set, get) => ({
  subscriptions: new Map(),
  liveValues: new Map(),
  trendData: new Map(),
  activeSubscriptionId: null,
  isBottomPanelExpanded: true,

  addSubscription: (sub) => {
    const { subscriptions } = get()
    const updated = new Map(subscriptions)
    updated.set(sub.id, sub)
    set({ subscriptions: updated, activeSubscriptionId: sub.id })
  },

  removeSubscription: (id) => {
    const { subscriptions, activeSubscriptionId } = get()
    const updated = new Map(subscriptions)
    updated.delete(id)
    set({
      subscriptions: updated,
      activeSubscriptionId: activeSubscriptionId === id ? null : activeSubscriptionId
    })
  },

  setActiveSubscription: (id) => set({ activeSubscriptionId: id }),

  addMonitoredItem: (subscriptionId, elementId) => {
    const { subscriptions } = get()
    const sub = subscriptions.get(subscriptionId)
    if (sub && !sub.monitoredItems.includes(elementId)) {
      const updated = new Map(subscriptions)
      updated.set(subscriptionId, {
        ...sub,
        monitoredItems: [...sub.monitoredItems, elementId]
      })
      set({ subscriptions: updated })
    }
  },

  removeMonitoredItem: (subscriptionId, elementId) => {
    const { subscriptions, liveValues } = get()
    const sub = subscriptions.get(subscriptionId)
    if (sub) {
      const updatedSubs = new Map(subscriptions)
      updatedSubs.set(subscriptionId, {
        ...sub,
        monitoredItems: sub.monitoredItems.filter(id => id !== elementId)
      })
      const updatedValues = new Map(liveValues)
      updatedValues.delete(elementId)
      set({ subscriptions: updatedSubs, liveValues: updatedValues })
    }
  },

  updateLiveValue: (value) => {
    const { liveValues, trendData } = get()
    const updatedLive = new Map(liveValues)
    updatedLive.set(value.elementId, { ...value, lastUpdated: Date.now() })

    // If value is numeric, add to trend data
    const numericValue = typeof value.value === 'number' ? value.value : parseFloat(String(value.value))
    if (!isNaN(numericValue)) {
      const updatedTrend = new Map(trendData)
      const points = updatedTrend.get(value.elementId) || []
      const newPoints = [
        ...points,
        { value: numericValue, timestamp: Date.now() }
      ].slice(-MAX_TREND_POINTS) // Keep only last N points
      updatedTrend.set(value.elementId, newPoints)
      set({ liveValues: updatedLive, trendData: updatedTrend })
    } else {
      set({ liveValues: updatedLive })
    }
  },

  setStreaming: (subscriptionId, streaming) => {
    const { subscriptions } = get()
    const sub = subscriptions.get(subscriptionId)
    if (sub) {
      const updated = new Map(subscriptions)
      updated.set(subscriptionId, { ...sub, isStreaming: streaming })
      set({ subscriptions: updated })
    }
  },

  setBottomPanelExpanded: (expanded) => set({ isBottomPanelExpanded: expanded }),

  clearAll: () => set({
    subscriptions: new Map(),
    liveValues: new Map(),
    trendData: new Map(),
    activeSubscriptionId: null
  })
}))
