import { Profiler, useSyncExternalStore, type ReactNode } from 'react'
import { isPerfTraceEnabled, recordCommit, subscribePerfTrace } from './perfTrace'

/** Records this subtree's React commits while tracing is on (development builds only). */
export function PerfProfiler({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler id={id} onRender={recordCommit}>
      {children}
    </Profiler>
  )
}

export function usePerfTraceEnabled(): boolean {
  return useSyncExternalStore(subscribePerfTrace, isPerfTraceEnabled)
}
