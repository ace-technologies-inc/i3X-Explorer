import { describe, expect, it } from 'vitest'
import { computeInsightsReport } from './insightsReport'
import type { ObjectInstance } from '../../api/types'

/**
 * Working-scale budget for the full report. The assertion is a loose
 * complexity guard (an accidental O(n·m) lands in minutes, not milliseconds);
 * the printed number is the deliverable. Precedents on the dev machine:
 * modelStats ~70–93ms, diff scalar ~44–90ms at 100k.
 */

function make(
  elementId: string,
  typeId: string,
  parentId: string | null,
  displayName = elementId
): ObjectInstance {
  return { elementId, displayName, typeId, parentId, isComposition: false, namespaceUri: 'urn:ns' }
}

describe('computeInsightsReport at working scale', () => {
  it('builds the full report over ~100k objects within budget', () => {
    const objects: ObjectInstance[] = []
    // 1,000 racks × (98 PLCs + usually a switch) ≈ 100k, with engineered
    // patterns: PLC names follow "A-9" with rare deviants, ~1% of racks miss
    // their switch, and sensors split across two parent types.
    for (let rack = 0; rack < 1_000; rack++) {
      objects.push(make(`rack${rack}`, 'rack', null, `RK-${rack}`))
      for (let slot = 0; slot < 90; slot++) {
        const name = slot === 7 && rack % 211 === 0 ? 'odd name' : `PLC-${rack}-${slot}`
        objects.push(make(`rack${rack}-plc${slot}`, 'plc', `rack${rack}`, name))
      }
      if (rack % 97 !== 0) {
        objects.push(make(`rack${rack}-switch`, 'switch', `rack${rack}`, `SW-${rack}`))
      }
      // Sensors: 94% under racks, 6% under cabinets, an engineered split.
      // Their names deliberately take a different shape from the PLCs': a
      // pattern the rest of the catalog shares just as much is house style,
      // not a convention of one type, and the gate would (rightly) drop it.
      for (let s = 0; s < 8; s++) {
        const parent = (rack * 8 + s) % 100 < 94 ? `rack${rack}` : `cab${rack % 50}`
        objects.push(make(`rack${rack}-sen${s}`, 'sensor', parent, `Sensor ${rack} ${s}`))
      }
    }
    for (let cab = 0; cab < 50; cab++) objects.push(make(`cab${cab}`, 'cabinet', null, `CB-${cab}`))

    const start = performance.now()
    const report = computeInsightsReport(objects, [])
    const ms = performance.now() - start
    console.log(
      `[perf] insights report over ${objects.length.toLocaleString()} objects: ${ms.toFixed(0)}ms, ` +
        `${report.summary.conventions} conventions · ${report.summary.deviations} deviations · ${report.summary.splits} splits`
    )

    // The engineered patterns must actually fall out of the data.
    expect(report.deviations.find(d => d.kind === 'missing-child' && d.relatedTypeId === 'switch')).toBeDefined()
    expect(report.deviations.find(d => d.kind === 'naming' && d.typeId === 'plc')).toBeDefined()
    expect(report.splits.find(s => s.typeId === 'sensor')).toBeDefined()
    expect(ms).toBeLessThan(1_000)
  })
})
