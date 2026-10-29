import { formatAgo, useNow } from './liveTime'

/** Identical deliveries in a row before the feed reads as stale rather than live. */
export const STALE_AFTER_REPEATS = 2

export function isRepeatingFeed(repeatCount: number): boolean {
  return repeatCount >= STALE_AFTER_REPEATS
}

/** "Re-sent the same reading 12 times; nothing new since 3m ago." */
export function repeatingFeedText(repeatCount: number, freshAt: number, now: number): string {
  return `The server re-sent the same reading ${repeatCount.toLocaleString()} times; nothing new since ${formatAgo(freshAt, now)}`
}

/**
 * "● Live · 3s ago" for an element with a subscription feeding it. The dot pulses
 * once per update received, so a stream that is alive but unchanging still shows
 * it is alive. When the server keeps re-sending one reading it turns amber and
 * reads "No new data". Ticks on its own so its parent doesn't re-render every second.
 */
export function LiveBadge({
  receivedAt,
  updateCount,
  repeatCount,
  freshAt,
}: {
  receivedAt: number
  updateCount: number
  repeatCount: number
  freshAt: number
}) {
  const now = useNow()
  const stale = isRepeatingFeed(repeatCount)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal whitespace-nowrap ${
        stale
          ? 'border-i3x-warning/30 bg-i3x-warning/10 text-i3x-warning'
          : 'border-i3x-success/30 bg-i3x-success/10 text-i3x-success'
      }`}
      title={
        stale
          ? repeatingFeedText(repeatCount, freshAt, now)
          : `${updateCount.toLocaleString()} update${updateCount === 1 ? '' : 's'} received · last at ${new Date(receivedAt).toLocaleTimeString()}`
      }
    >
      <LivePulse receivedAt={receivedAt} stale={stale} />
      {stale ? `No new data · ${formatAgo(freshAt, now)}` : `Live · ${formatAgo(receivedAt, now)}`}
    </span>
  )
}

/** "12s ago", counting on its own so only this text re-renders each second. */
export function TimeAgo({ at }: { at: number }) {
  return <>{formatAgo(at, useNow())}</>
}

/** A dot that pulses once each time `receivedAt` changes; amber while the feed repeats itself. */
export function LivePulse({ receivedAt, stale = false }: { receivedAt: number; stale?: boolean }) {
  const tone = stale ? 'bg-i3x-warning' : 'bg-i3x-success'
  return (
    <span aria-hidden="true" className="relative inline-flex w-2 h-2">
      <span key={receivedAt} className={`live-pulse absolute inset-0 rounded-full ${tone}`} />
      <span className={`relative w-2 h-2 rounded-full ${tone}`} />
    </span>
  )
}
