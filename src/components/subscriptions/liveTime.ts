import { useSyncExternalStore } from 'react'

const TICK_MS = 1000
const listeners = new Set<() => void>()
let clockNow = Date.now()
let timer: number | undefined

const tick = () => {
  clockNow = Date.now()
  listeners.forEach(listener => listener())
}

// One interval for every relative time on screen, so they all re-render in the same tick.
function subscribeClock(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === undefined) {
    clockNow = Date.now()
    timer = window.setInterval(tick, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}

/** The current time, re-read every second so relative times keep counting. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, () => clockNow)
}

/** "just now", "12s ago", "3m ago", "2h ago". */
export function formatAgo(thenMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}
