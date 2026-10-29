// Long enough to amortize the yield, short enough that input and paint never wait a full frame.
const SLICE_BUDGET_MS = 8
const CLOCK_CHECK_INTERVAL = 512

interface SchedulerWithYield {
  yield?: () => Promise<void>
}

/** Give the browser a turn: `scheduler.yield()` where supported, otherwise a MessageChannel task. */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerWithYield }).scheduler
  if (scheduler?.yield) return scheduler.yield()
  return new Promise(resolve => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/** Calls `visit(0..count-1)` in slices of about SLICE_BUDGET_MS, yielding between slices. */
export async function forEachSliced(count: number, visit: (index: number) => void): Promise<void> {
  let index = 0
  while (index < count) {
    const deadline = performance.now() + SLICE_BUDGET_MS
    while (index < count) {
      visit(index++)
      if (index % CLOCK_CHECK_INTERVAL === 0 && performance.now() >= deadline) break
    }
    if (index < count) await yieldToMain()
  }
}
