/**
 * Opt-in render performance tracing. While on, every long animation frame (or
 * long task, where the browser lacks LoAF) is logged to the console with the
 * scripts the browser blames for it, the named spans that ran inside it, and
 * the React commits that landed in it. Spans and commits also show up as
 * User Timing measures ("i3x …") in the DevTools Performance panel.
 *
 * Turn it on from Settings, with `?perf` in the URL, or `__i3xPerf.enable()`
 * in the console; `__i3xPerf.report()` summarises everything recorded so far.
 */

const STORAGE_KEY = 'i3x-perf-trace'
const MAX_ENTRIES = 2000
const MAX_FRAMES = 200

export interface PerfSpan {
  kind: 'span' | 'commit'
  name: string
  start: number
  duration: number
}

export interface PerfFrameScript {
  invoker: string
  source: string
  duration: number
}

export interface PerfLongFrame {
  start: number
  duration: number
  /** The part of the frame that blocked input, where the browser reports it. */
  blocking: number | null
  scripts: PerfFrameScript[]
  spans: PerfSpan[]
}

// LoAF is newer than the DOM typings this project compiles against.
interface LongAnimationFrameScript {
  invoker: string
  sourceURL: string
  sourceFunctionName: string
  sourceCharPosition: number
  duration: number
}
interface LongFrameEntry extends PerformanceEntry {
  blockingDuration?: number
  scripts?: LongAnimationFrameScript[]
}

const entries: PerfSpan[] = []
const frames: PerfLongFrame[] = []
const listeners = new Set<() => void>()
let enabled = readInitialState()
let stopObserving: (() => void) | null = null

function readInitialState(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf')) return true
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function isPerfTraceEnabled(): boolean {
  return enabled
}

export function setPerfTraceEnabled(on: boolean): void {
  if (on === enabled) return
  enabled = on
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: the setting just won't persist.
  }
  if (on) startObserving()
  else stopObservingFrames()
  listeners.forEach(listener => listener())
}

export function subscribePerfTrace(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Time a synchronous piece of work under `name`. Free when tracing is off. */
export function traceSpan<T>(name: string, work: () => T): T {
  if (!enabled) return work()
  const start = performance.now()
  try {
    return work()
  } finally {
    record({ kind: 'span', name, start, duration: performance.now() - start })
  }
}

/** A React `<Profiler onRender>` callback: one entry per commit of the profiled tree. */
export function recordCommit(id: string, phase: string, actualDuration: number, _baseDuration: number, startTime: number): void {
  if (!enabled) return
  record({ kind: 'commit', name: `${id} ${phase}`, start: startTime, duration: actualDuration })
}

function record(span: PerfSpan): void {
  entries.push(span)
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  try {
    performance.measure(`i3x ${span.name}`, { start: span.start, duration: span.duration })
  } catch {
    // User Timing L3 unavailable; the console report still has the entry.
  }
}

function startObserving(): void {
  if (stopObserving || typeof PerformanceObserver === 'undefined') return
  const supported = PerformanceObserver.supportedEntryTypes ?? []
  const type = supported.includes('long-animation-frame') ? 'long-animation-frame'
    : supported.includes('longtask') ? 'longtask' : null
  if (!type) return
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) reportLongFrame(entry as LongFrameEntry)
  })
  observer.observe({ type, buffered: true })
  stopObserving = () => observer.disconnect()
}

function stopObservingFrames(): void {
  stopObserving?.()
  stopObserving = null
}

function reportLongFrame(entry: LongFrameEntry): void {
  // A long frame with no blocking time never held up input (e.g. a hidden tab waiting to render).
  if (entry.blockingDuration === 0) return
  const end = entry.startTime + entry.duration
  const frame: PerfLongFrame = {
    start: entry.startTime,
    duration: entry.duration,
    blocking: entry.blockingDuration ?? null,
    scripts: (entry.scripts ?? []).map(script => ({
      invoker: script.invoker,
      source: `${script.sourceFunctionName || '(anonymous)'} ${script.sourceURL}:${script.sourceCharPosition}`,
      duration: Math.round(script.duration),
    })),
    spans: entries.filter(span => span.start < end && span.start + span.duration > entry.startTime),
  }
  frames.push(frame)
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES)

  console.groupCollapsed(
    `[perf] ${Math.round(frame.duration)} ms frame at ${Math.round(frame.start)} ms` +
      (frame.blocking !== null ? ` (${Math.round(frame.blocking)} ms blocking)` : '')
  )
  if (frame.scripts.length > 0) console.table(frame.scripts)
  if (frame.spans.length > 0) console.table(frame.spans.map(roundSpan))
  console.groupEnd()
}

function roundSpan(span: PerfSpan) {
  return { ...span, start: Math.round(span.start), duration: Math.round(span.duration * 10) / 10 }
}

/** Everything recorded: long frames, and spans/commits aggregated by name, slowest first. */
export function perfReport(): { frames: PerfLongFrame[]; byName: { name: string; count: number; total: number; max: number }[] } {
  const totals = new Map<string, { name: string; count: number; total: number; max: number }>()
  for (const span of entries) {
    const row = totals.get(span.name) ?? { name: span.name, count: 0, total: 0, max: 0 }
    row.count++
    row.total += span.duration
    row.max = Math.max(row.max, span.duration)
    totals.set(span.name, row)
  }
  const byName = [...totals.values()]
    .map(row => ({ ...row, total: Math.round(row.total), max: Math.round(row.max) }))
    .sort((left, right) => right.total - left.total)
  return { frames: [...frames], byName }
}

export function clearPerfTrace(): void {
  entries.length = 0
  frames.length = 0
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __i3xPerf: unknown }).__i3xPerf = {
    enable: () => setPerfTraceEnabled(true),
    disable: () => setPerfTraceEnabled(false),
    clear: clearPerfTrace,
    report: () => {
      const report = perfReport()
      console.table(report.byName)
      console.table(report.frames.map(frame => ({
        start: Math.round(frame.start),
        duration: Math.round(frame.duration),
        topScript: frame.scripts[0]?.source ?? '',
        spans: frame.spans.map(span => span.name).join(', '),
      })))
      return report
    },
  }
  if (enabled) startObserving()
}
