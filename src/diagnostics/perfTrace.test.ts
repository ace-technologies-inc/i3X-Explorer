import { afterEach, describe, expect, it } from 'vitest'
import { clearPerfTrace, perfReport, recordCommit, setPerfTraceEnabled, traceSpan } from './perfTrace'

afterEach(() => {
  setPerfTraceEnabled(false)
  clearPerfTrace()
})

describe('perfTrace', () => {
  it('records nothing while off and still returns the work result', () => {
    expect(traceSpan('work', () => 42)).toBe(42)
    recordCommit('Panel', 'update', 5, 5, 0)

    expect(perfReport().byName).toEqual([])
  })

  it('aggregates spans and commits by name, slowest total first', () => {
    setPerfTraceEnabled(true)
    traceSpan('cheap', () => undefined)
    recordCommit('Panel', 'update', 30, 30, performance.now())
    recordCommit('Panel', 'update', 20, 20, performance.now())

    const [first, second] = perfReport().byName
    expect(first).toMatchObject({ name: 'Panel update', count: 2, total: 50, max: 30 })
    expect(second).toMatchObject({ name: 'cheap', count: 1 })
  })
})
