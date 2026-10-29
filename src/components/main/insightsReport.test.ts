import { describe, expect, it } from 'vitest'
import {
  MIN_NORM_INSTANCES,
  MIN_NORM_LIFT,
  computeInsightsReport,
  conventionText,
  deviationHeadline,
  deviationNorm,
  getInsightsReport,
  groupLabel,
  nameSignature,
  normLift,
  wilsonLower,
} from './insightsReport'
import { computeModelStats } from './modelStats'
import type { ObjectInstance, ObjectType } from '../../api/types'

function obj(elementId: string, over: Partial<ObjectInstance> = {}): ObjectInstance {
  return {
    elementId,
    displayName: elementId,
    typeId: 'T',
    parentId: null,
    isComposition: false,
    namespaceUri: 'urn:ns',
    ...over,
  }
}

function type(elementId: string, displayName = elementId): ObjectType {
  return { elementId, displayName, namespaceUri: 'urn:ns', schema: {} }
}

/** N pumps under station(s), each with a sensor child except the holdouts. */
function pumpsWithSensors(count: number, holdouts: number[]): ObjectInstance[] {
  const objects: ObjectInstance[] = [obj('station', { typeId: 'stationT' })]
  for (let i = 0; i < count; i++) {
    objects.push(obj(`pump${i}`, { typeId: 'pump', parentId: 'station', displayName: `PMP-${i}` }))
    if (!holdouts.includes(i)) {
      objects.push(
        obj(`sensor${i}`, { typeId: 'sensor', parentId: `pump${i}`, displayName: `VS-${i}` })
      )
    }
  }
  return objects
}

describe('wilsonLower', () => {
  it('is 0 for empty samples and below 1 even at perfect conformance', () => {
    expect(wilsonLower(0, 0)).toBe(0)
    expect(wilsonLower(10, 10)).toBeLessThan(1)
    expect(wilsonLower(10, 10)).toBeGreaterThan(0.6)
  })

  it('ranks large samples above small ones at the same raw coverage', () => {
    expect(wilsonLower(990, 1000)).toBeGreaterThan(wilsonLower(9, 10))
  })

  it('grows with n at fixed proportion', () => {
    expect(wilsonLower(90, 100)).toBeGreaterThan(wilsonLower(9, 10))
    expect(wilsonLower(900, 1000)).toBeGreaterThan(wilsonLower(90, 100))
  })
})

describe('nameSignature', () => {
  it('collapses letter and digit runs, keeping separators', () => {
    expect(nameSignature('PMP-999')).toBe('A-9')
    expect(nameSignature('Pump 12')).toBe('A 9')
    expect(nameSignature('NORTHSITE')).toBe('A')
    expect(nameSignature('12345')).toBe('9')
    expect(nameSignature('A1B2')).toBe('A9A9')
    expect(nameSignature('')).toBe('')
  })

  it('treats non-Latin letters and digits like Latin ones', () => {
    // A Cyrillic or CJK word must collapse to a bare (uninformative) 'A' just
    // like 'Pump' does, otherwise non-Latin catalogs get their literal names
    // reported as "patterns" and fabricated naming deviations.
    expect(nameSignature('Насос')).toBe('A')
    expect(nameSignature('温度計')).toBe('A')
    expect(nameSignature('Насос-12')).toBe('A-9')
    expect(nameSignature('１２３')).toBe('9') // full-width digits
  })
})

describe('type profiles', () => {
  it('builds placement distributions whose shares sum to 1, with special buckets', () => {
    const report = computeInsightsReport(
      [
        obj('p1', { typeId: 'plc', parentId: 'rack' }),
        obj('p2', { typeId: 'plc', parentId: 'missing' }), // orphan parent
        obj('p3', { typeId: 'plc' }), // root
        obj('rack', { typeId: 'rackT' }),
      ],
      []
    )
    const plc = report.profiles.find(p => p.typeId === 'plc')!
    expect(plc.instanceCount).toBe(3)
    expect(plc.placements.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1)
    const labels = plc.placements.map(p => p.parentTypeLabel).sort()
    expect(labels).toEqual(['(at root)', '(parent not in catalog)', 'rackT'])
  })

  it('computes child cardinality: min, max, and the modal count', () => {
    // 3 racks: two hold 2 plcs, one holds 5.
    const objects: ObjectInstance[] = []
    const counts = [2, 2, 5]
    counts.forEach((n, rack) => {
      objects.push(obj(`rack${rack}`, { typeId: 'rackT' }))
      for (let i = 0; i < n; i++) {
        objects.push(obj(`r${rack}p${i}`, { typeId: 'plc', parentId: `rack${rack}` }))
      }
    })
    const rack = computeInsightsReport(objects, []).profiles.find(p => p.typeId === 'rackT')!
    const stat = rack.children.find(c => c.childTypeId === 'plc')!
    expect(stat.presence).toBe(3)
    expect(stat.minCount).toBe(2)
    expect(stat.maxCount).toBe(5)
    expect(stat.typicalCount).toBe(2)
  })

  it('tracks depth ranges and caps examples at 3', () => {
    const objects = [
      obj('a', { typeId: 'X' }),
      obj('b', { typeId: 'X', parentId: 'a' }),
      obj('c', { typeId: 'X', parentId: 'b' }),
      obj('d', { typeId: 'X', parentId: 'c' }),
    ]
    const profile = computeInsightsReport(objects, []).profiles[0]
    expect(profile.depthMin).toBe(0)
    expect(profile.depthMax).toBe(3)
    expect(profile.examples).toHaveLength(3)
  })

  it('reports a naming profile only when a dominant informative signature exists', () => {
    const named = pumpsWithSensors(20, [])
    const pump = computeInsightsReport(named, []).profiles.find(p => p.typeId === 'pump')!
    expect(pump.naming).toMatchObject({ signature: 'A-9', share: 1 })

    // Bare single-word names ("A") are uninformative, no naming profile.
    const words = Array.from({ length: 20 }, (_, i) =>
      obj(`w${i}`, { typeId: 'W', displayName: `Word${i}` === '' ? 'x' : 'Word' })
    )
    const wordProfile = computeInsightsReport(words, []).profiles.find(p => p.typeId === 'W')!
    expect(wordProfile.naming).toBeNull()
  })
})

describe('conventions', () => {
  it('reports a 100% containment norm as a convention with cardinality prose', () => {
    const report = computeInsightsReport(pumpsWithSensors(20, []), [
      type('pump', 'Pump'),
      type('sensor', 'Vibration Sensor'),
    ])
    const convention = report.conventions.find(
      c => c.kind === 'missing-child' && c.typeId === 'pump'
    )!
    expect(convention.coverage).toBe(1)
    expect(convention.cardinalityText).toBe('exactly 1')
    expect(conventionText(convention)).toBe('Every Pump contains exactly 1 Vibration Sensor')
    // And no deviation for a norm without exceptions.
    expect(report.deviations.filter(d => d.kind === 'missing-child')).toHaveLength(0)
  })

  it('records near-norms as conventions too, alongside their deviation', () => {
    const report = computeInsightsReport(pumpsWithSensors(20, [3]), [type('pump', 'Pump')])
    const convention = report.conventions.find(
      c => c.kind === 'missing-child' && c.typeId === 'pump'
    )!
    expect(convention.coverage).toBeCloseTo(19 / 20)
    expect(report.deviations.find(d => d.kind === 'missing-child')).toBeDefined()
  })

  it('phrases placement and naming conventions', () => {
    const report = computeInsightsReport(pumpsWithSensors(20, []), [
      type('pump', 'Pump'),
      type('stationT', 'Station'),
    ])
    const placement = report.conventions.find(c => c.kind === 'unusual-parent')!
    expect(conventionText(placement)).toBe('Every Pump sits under a Station')
    const naming = report.conventions.find(c => c.kind === 'naming' && c.typeId === 'pump')!
    expect(conventionText(naming)).toBe('Every Pump name follows the pattern A-9')
  })
})

describe('deviations', () => {
  it('needs MIN_NORM_INSTANCES and the coverage threshold', () => {
    expect(
      computeInsightsReport(pumpsWithSensors(MIN_NORM_INSTANCES - 2, [1]), []).deviations
    ).toHaveLength(0)
    // 14 of 20 = 70%: a tendency, not a norm.
    expect(
      computeInsightsReport(pumpsWithSensors(20, [0, 1, 2, 3, 4, 5]), []).deviations.filter(
        d => d.kind === 'missing-child'
      )
    ).toHaveLength(0)
  })

  it('keeps full, uncapped outlier lists', () => {
    const holdouts = Array.from({ length: 30 }, (_, i) => i * 13) // 30 of 400 → 92.5%
    const report = computeInsightsReport(pumpsWithSensors(400, holdouts), [])
    const deviation = report.deviations.find(d => d.kind === 'missing-child')!
    expect(deviation.outlierCount).toBe(30)
    const memberTotal = deviation.groups.reduce((sum, g) => sum + g.members.length, 0)
    expect(memberTotal).toBe(30)
  })

  it('groups unusual-parent outliers by their actual parent type, with subtree annotation', () => {
    // 19 plcs under racks, 2 under one bin that lives inside a site subtree.
    const objects: ObjectInstance[] = [
      obj('site', { typeId: 'siteT', displayName: 'NORTHSITE' }),
      obj('bin', { typeId: 'binT', parentId: 'site' }),
      obj('rack', { typeId: 'rackT' }),
    ]
    for (let i = 0; i < 19; i++) objects.push(obj(`plc${i}`, { typeId: 'plc', parentId: 'rack' }))
    objects.push(obj('plc19', { typeId: 'plc', parentId: 'bin' }))
    objects.push(obj('plc20', { typeId: 'plc', parentId: 'bin' }))

    const report = computeInsightsReport(objects, [type('binT', 'Bin'), type('rackT', 'Rack')])
    const deviation = report.deviations.find(d => d.kind === 'unusual-parent' && d.typeId === 'plc')!
    expect(deviation.groups).toHaveLength(1)
    const group = deviation.groups[0]
    expect(group.keyLabel).toBe('Bin')
    expect(group.members.map(m => m.elementId).sort()).toEqual(['plc19', 'plc20'])
    expect(group.subtreeRootLabel).toBe('NORTHSITE')
    expect(groupLabel('unusual-parent', group)).toBe('2 sit under Bin instead, all within NORTHSITE')
    // Disambiguation context on members: the actual parent's label.
    expect(group.members[0].context).toBe('bin')
  })

  it('ranks by Wilson strength: 990/1000 beats 9/10', () => {
    const big = pumpsWithSensors(1000, Array.from({ length: 10 }, (_, i) => i * 97))
    // Small type: 9 of 10 valves have an actuator, rename ids to avoid collisions.
    const small: ObjectInstance[] = []
    for (let i = 0; i < 10; i++) {
      small.push(obj(`valve${i}`, { typeId: 'valve' }))
      if (i !== 0) small.push(obj(`act${i}`, { typeId: 'act', parentId: `valve${i}` }))
    }
    const report = computeInsightsReport([...big, ...small], [])
    const kinds = report.deviations.filter(d => d.kind === 'missing-child').map(d => d.typeId)
    expect(kinds.indexOf('pump')).toBeLessThan(kinds.indexOf('valve'))
  })

  it('never lets self-containment form a containment norm, chain tails are not defects', () => {
    // 40 chains of depth 3, all one recursive type: every leaf "misses" a
    // child of its own type by structural necessity, not by mistake.
    const objects: ObjectInstance[] = []
    for (let chain = 0; chain < 40; chain++) {
      objects.push(obj(`c${chain}-0`, { typeId: 'loc' }))
      objects.push(obj(`c${chain}-1`, { typeId: 'loc', parentId: `c${chain}-0` }))
      objects.push(obj(`c${chain}-2`, { typeId: 'loc', parentId: `c${chain}-1` }))
    }
    const report = computeInsightsReport(objects, [])
    expect(
      report.deviations.filter(d => d.kind === 'missing-child' && d.relatedTypeId === 'loc')
    ).toHaveLength(0)
    expect(
      report.conventions.filter(c => c.kind === 'missing-child' && c.relatedTypeId === 'loc')
    ).toHaveLength(0)
    // The atlas still shows the recursive structure, it's real, just not a norm.
    const profile = report.profiles.find(p => p.typeId === 'loc')!
    expect(profile.children.find(c => c.childTypeId === 'loc')).toBeDefined()
  })

  it('never lets the root establish a placement norm', () => {
    const objects: ObjectInstance[] = [obj('rack', { typeId: 'rackT' })]
    for (let i = 0; i < 19; i++) objects.push(obj(`p${i}`, { typeId: 'plc' })) // at root
    objects.push(obj('p19', { typeId: 'plc', parentId: 'rack' }))
    const report = computeInsightsReport(objects, [])
    expect(report.deviations.filter(d => d.kind === 'unusual-parent')).toHaveLength(0)
    expect(report.conventions.filter(c => c.kind === 'unusual-parent' && c.typeId === 'plc')).toHaveLength(0)
  })

  it('flags naming deviants grouped by their own signature', () => {
    // The sensors are renamed off "A-9" on purpose: pumpsWithSensors names
    // both types the same way, and a name shape the rest of the catalog uses
    // just as much is house style, not a Pump convention (see MIN_NORM_LIFT).
    const objects = pumpsWithSensors(20, []).map(o => {
      if (o.elementId === 'pump7') return { ...o, displayName: 'Odd Name' }
      if (o.typeId === 'sensor') return { ...o, displayName: `Vibration ${o.elementId}` }
      return o
    })
    const report = computeInsightsReport(objects, [type('pump', 'Pump')])
    const naming = report.deviations.find(d => d.kind === 'naming' && d.typeId === 'pump')!
    expect(naming.signature).toBe('A-9')
    expect(naming.groups[0].keyLabel).toBe('A A')
    expect(naming.groups[0].members[0].elementId).toBe('pump7')
    expect(deviationNorm(naming)).toBe('19 of 20 Pump names follow A-9')
    expect(deviationHeadline(naming)).toBe(
      '19 of 20 Pump names follow A-9, the one exception:'
    )
  })
})

describe('informativeness gate', () => {
  /** One container type for the entire model: nothing distinguishes any type. */
  function oneContainerModel(strayPump = false): ObjectInstance[] {
    const objects: ObjectInstance[] = [obj('loc', { typeId: 'locT' })]
    if (strayPump) objects.push(obj('other', { typeId: 'otherT' }))
    for (let i = 0; i < 20; i++) {
      const parentId = strayPump && i === 19 ? 'other' : 'loc'
      objects.push(obj(`pump${i}`, { typeId: 'pump', parentId }))
    }
    for (let i = 0; i < 200; i++) objects.push(obj(`thing${i}`, { typeId: 'thing', parentId: 'loc' }))
    return objects
  }

  it('measures lift against the rest of the catalog, not the whole of it', () => {
    // 20 of 20 for the type, 220 of 221 catalog-wide: excluding the type's own
    // instances is what stops a big type from setting its own baseline.
    const perfect = normLift(20, 20, 220, 221)
    expect(perfect.baseRate).toBeCloseTo(200 / 201)
    expect(perfect.lift).toBeLessThan(MIN_NORM_LIFT)
    expect(perfect.notable).toBe(false)
  })

  it('treats "nothing else does this" and "nothing to compare with" as maximally informative', () => {
    expect(normLift(20, 20, 20, 500)).toMatchObject({ lift: Infinity, notable: true })
    expect(normLift(20, 20, 20, 20)).toMatchObject({ baseRate: null, notable: true })
  })

  it('keeps a norm the whole model shares, but marks it unremarkable', () => {
    const report = computeInsightsReport(oneContainerModel(), [
      type('pump', 'Pump'),
      type('locT', 'Location'),
    ])
    const placement = report.conventions.find(
      c => c.kind === 'unusual-parent' && c.typeId === 'pump'
    )!
    // Still stated (it is true, and the page lists it), just not headline.
    expect(conventionText(placement)).toBe('Every Pump sits under a Location')
    expect(placement.notable).toBe(false)
    expect(placement.lift).toBeLessThan(MIN_NORM_LIFT)
    expect(report.summary.conventions).toBe(0)
    expect(report.summary.trivialConventions).toBeGreaterThan(0)
  })

  it('reports a placement only this type keeps', () => {
    const objects: ObjectInstance[] = [
      obj('loc', { typeId: 'locT' }),
      obj('station', { typeId: 'stationT', parentId: 'loc' }),
    ]
    for (let i = 0; i < 20; i++) objects.push(obj(`pump${i}`, { typeId: 'pump', parentId: 'station' }))
    for (let i = 0; i < 200; i++) objects.push(obj(`thing${i}`, { typeId: 'thing', parentId: 'loc' }))

    const placement = computeInsightsReport(objects, [])
      .conventions.find(c => c.kind === 'unusual-parent' && c.typeId === 'pump')!
    expect(placement.notable).toBe(true)
    expect(placement.lift).toBe(Infinity)
  })

  it('raises no deviation and no anomaly points from an unremarkable norm', () => {
    const report = computeInsightsReport(oneContainerModel(true), [])
    // 19 of 20 pumps under Location, one elsewhere: a 95% norm, but so is the
    // rest of the catalog, so the odd pump is not evidence of anything.
    const convention = report.conventions.find(
      c => c.kind === 'unusual-parent' && c.typeId === 'pump'
    )!
    expect(convention.coverage).toBeCloseTo(0.95)
    expect(convention.notable).toBe(false)
    expect(report.deviations.filter(d => d.typeId === 'pump')).toHaveLength(0)
    expect(report.anomalies).toHaveLength(0)
  })

  it('sorts notable conventions ahead of the rest', () => {
    const report = computeInsightsReport(oneContainerModel(), [])
    const flags = report.conventions.map(c => c.notable)
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)))
  })
})

describe('splits', () => {
  it('classifies a 94%-with-concentrated-6% norm as a split, not a deviation', () => {
    // 940 under an area, 60 under a zone (a different parent TYPE, placement
    // norms are typed), the location-hierarchy case from a real catalog.
    const objects: ObjectInstance[] = [
      obj('areaA', { typeId: 'areaT' }),
      obj('areaB', { typeId: 'zoneT' }),
    ]
    for (let i = 0; i < 940; i++) objects.push(obj(`la${i}`, { typeId: 'loc', parentId: 'areaA' }))
    for (let i = 0; i < 60; i++) objects.push(obj(`lb${i}`, { typeId: 'loc', parentId: 'areaB' }))

    const report = computeInsightsReport(objects, [])
    expect(report.deviations.filter(d => d.kind === 'unusual-parent' && d.typeId === 'loc')).toHaveLength(0)
    const split = report.splits.find(s => s.typeId === 'loc')!
    expect(split.populations[0].count).toBe(940)
    expect(split.populations[1].count).toBe(60)
    expect(split.populations[1].examples).toHaveLength(3)
  })

  it('keeps scattered exceptions as a deviation, not a split', () => {
    // 940 under areaA; 60 scattered under 60 distinct parents (no concentration).
    const objects: ObjectInstance[] = [obj('areaA', { typeId: 'areaT' })]
    for (let i = 0; i < 940; i++) objects.push(obj(`la${i}`, { typeId: 'loc', parentId: 'areaA' }))
    for (let i = 0; i < 60; i++) {
      objects.push(obj(`host${i}`, { typeId: `hostT${i}` }))
      objects.push(obj(`lb${i}`, { typeId: 'loc', parentId: `host${i}` }))
    }
    const report = computeInsightsReport(objects, [])
    expect(report.splits.filter(s => s.typeId === 'loc')).toHaveLength(0)
    expect(report.deviations.find(d => d.kind === 'unusual-parent' && d.typeId === 'loc')).toBeDefined()
  })

  it('detects a sub-threshold two-population split (55/40), root allowed as a population', () => {
    const objects: ObjectInstance[] = [obj('rack', { typeId: 'rackT' })]
    for (let i = 0; i < 55; i++) objects.push(obj(`a${i}`, { typeId: 'plc', parentId: 'rack' }))
    for (let i = 0; i < 40; i++) objects.push(obj(`b${i}`, { typeId: 'plc' })) // at root
    const report = computeInsightsReport(objects, [])
    const split = report.splits.find(s => s.typeId === 'plc')!
    expect(split.populations.map(p => p.parentTypeLabel)).toEqual(['rackT', '(at root)'])
    expect(report.deviations.filter(d => d.kind === 'unusual-parent' && d.typeId === 'plc')).toHaveLength(0)
  })

  it('stays silent on genuinely mixed placement (no dominant pair)', () => {
    const objects: ObjectInstance[] = []
    for (let host = 0; host < 4; host++) {
      objects.push(obj(`host${host}`, { typeId: `hostT${host}` }))
      for (let i = 0; i < 25; i++) {
        objects.push(obj(`h${host}p${i}`, { typeId: 'plc', parentId: `host${host}` }))
      }
    }
    const report = computeInsightsReport(objects, [])
    expect(report.splits.filter(s => s.typeId === 'plc')).toHaveLength(0)
    expect(report.deviations.filter(d => d.typeId === 'plc' && d.kind === 'unusual-parent')).toHaveLength(0)
  })
})

describe('anomalies', () => {
  it('ranks objects breaking two independent norms, with both reasons', () => {
    // pump7 both misses its sensor AND sits under the wrong parent.
    const objects = pumpsWithSensors(30, [7]).map(o =>
      o.elementId === 'pump7' ? { ...o, parentId: 'bin' } : o
    )
    objects.push(obj('bin', { typeId: 'binT' }))
    const report = computeInsightsReport(objects, [
      type('pump', 'Pump'),
      type('sensor', 'Sensor'),
      type('stationT', 'Station'),
      type('binT', 'Bin'),
    ])
    expect(report.anomalies).toHaveLength(1)
    const anomaly = report.anomalies[0]
    expect(anomaly.elementId).toBe('pump7')
    expect(anomaly.score).toBe(2)
    expect(anomaly.reasons.join(' ')).toContain('missing Sensor')
    expect(anomaly.reasons.join(' ')).toContain('sits under Bin')
    // Where it sits, so two same-named objects of one type can't render as
    // identical rows (the failure this list was built to fix).
    expect(anomaly.context).toBe('bin')
  })

  it('excludes single-norm violators', () => {
    const report = computeInsightsReport(pumpsWithSensors(30, [7]), [])
    expect(report.anomalies).toHaveLength(0)
  })
})

describe('data quality', () => {
  it('lists orphans and untyped matching computeModelStats counts, plus duplicates and unused types', () => {
    const objects = [
      obj('a'),
      obj('orphan1', { parentId: 'nowhere' }),
      obj('untyped1', { typeId: '' }),
      obj('dup'),
      obj('dup', { displayName: 'second' }),
    ]
    const types = [type('T'), type('Unused')]
    const report = computeInsightsReport(objects, types)

    expect(report.dataQuality.orphans.map(o => o.elementId)).toEqual(['orphan1'])
    expect(report.dataQuality.untyped.map(o => o.elementId)).toEqual(['untyped1'])
    expect(report.dataQuality.unusedTypes.map(t => t.typeId)).toEqual(['Unused'])
    expect(report.dataQuality.duplicateElementIds).toEqual([{ elementId: 'dup', count: 2 }])

    // Counts agree with modelStats on a duplicate-free catalog.
    const clean = objects.filter(o => o.displayName !== 'second' && o.elementId !== 'dup')
    const stats = computeModelStats(clean, types, 1)
    const cleanReport = computeInsightsReport(clean, types)
    expect(cleanReport.dataQuality.orphans).toHaveLength(stats.orphans)
    expect(cleanReport.dataQuality.untyped).toHaveLength(stats.untyped)
    expect(cleanReport.dataQuality.unusedTypes).toHaveLength(stats.unusedTypes)
  })

  it('keeps unused types out of the issue count and reports them separately', () => {
    // A namespace is a type library: declaring types this server doesn't
    // instantiate is normal, so it must not inflate the issue headline.
    const objects = [obj('a'), obj('orphan1', { parentId: 'nowhere' })]
    const types = [type('T'), type('U1'), type('U2'), type('U3')]
    const report = computeInsightsReport(objects, types)

    expect(report.dataQuality.unusedTypes).toHaveLength(3)
    expect(report.summary.unusedTypes).toBe(3)
    expect(report.summary.dataQualityIssues).toBe(1) // the orphan, nothing else
  })
})

describe('robustness', () => {
  it('handles empty inputs', () => {
    const report = computeInsightsReport([], [])
    expect(report.summary).toEqual({
      typesAnalyzed: 0,
      conventions: 0,
      trivialConventions: 0,
      conventionsWithExceptions: 0,
      deviations: 0,
      splits: 0,
      dataQualityIssues: 0,
      unusedTypes: 0,
    })
  })

  it('completes on parentId cycles (subtree walks break the loop)', () => {
    const objects: ObjectInstance[] = []
    for (let i = 0; i < 10; i++) {
      objects.push(obj(`a${i}`, { typeId: 'A', parentId: `b${i}` }))
      objects.push(obj(`b${i}`, { typeId: 'B', parentId: `a${i}` }))
    }
    const report = computeInsightsReport(objects, [])
    expect(report.profiles).toHaveLength(2)
  })

  it('summary counts match section lengths', () => {
    const report = computeInsightsReport(pumpsWithSensors(24, [3, 9]), [type('Unused')])
    // The headline convention count is the notable ones only; the rest are
    // still in the array, and the two add up to it.
    expect(report.summary.conventions).toBe(report.conventions.filter(c => c.notable).length)
    expect(report.summary.conventions + report.summary.trivialConventions).toBe(
      report.conventions.length
    )
    expect(report.summary.deviations).toBe(report.deviations.length)
    expect(report.summary.splits).toBe(report.splits.length)
    expect(report.summary.typesAnalyzed).toBe(report.profiles.length)
    // Every deviation is the exception list of exactly one notable convention,
    // so the tiles' overlap is a number the page can state rather than hide.
    expect(report.summary.conventionsWithExceptions).toBe(report.summary.deviations)
  })
})

describe('getInsightsReport memo', () => {
  it('returns the same object for identical references, recomputes on new ones', () => {
    const objects = pumpsWithSensors(10, [])
    const types = [type('pump')]
    const first = getInsightsReport(objects, types, 1)
    const second = getInsightsReport(objects, types, 1)
    expect(second).toBe(first)
    expect(second.stats.objects).toBe(objects.length)

    const third = getInsightsReport([...objects], types, 1)
    expect(third).not.toBe(first)
  })
})
