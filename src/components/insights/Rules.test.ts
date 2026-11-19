import { describe, expect, it } from 'vitest'
import { computeInsightsReport } from '../main/insightsReport'
import { buildRules, rulePredicate, ruleStatement } from './Rules'
import type { ObjectInstance, ObjectType } from '../../api/types'

function object(elementId: string, over: Partial<ObjectInstance> = {}): ObjectInstance {
  return { elementId, displayName: elementId, typeId: 'thingT', parentId: null, isComposition: false, namespaceUri: 'urn:ns', ...over }
}

const types: ObjectType[] = [
  { elementId: 'siteT', displayName: 'Site', namespaceUri: 'urn:ns', schema: {} },
  { elementId: 'stationT', displayName: 'Station', namespaceUri: 'urn:ns', schema: {} },
  { elementId: 'pumpT', displayName: 'Pump', namespaceUri: 'urn:ns', schema: {} },
  { elementId: 'sensorT', displayName: 'Sensor', namespaceUri: 'urn:ns', schema: {} },
  { elementId: 'widgetT', displayName: 'Widget', namespaceUri: 'urn:ns', schema: {} },
]

/**
 * Pumps under a station, each with a sensor, named "PMP-n": three conventions.
 * One pump is named differently and one has no sensor, so two have exceptions.
 * Widgets and filler sit under the site, which is the shape of the model and
 * not a convention about widgets.
 */
function catalog(): ObjectInstance[] {
  const objects = [object('site', { typeId: 'siteT' }), object('station', { typeId: 'stationT', parentId: 'site' })]
  for (let i = 0; i < 30; i++) {
    objects.push(object(`pump${i}`, { typeId: 'pumpT', parentId: 'station', displayName: i === 4 ? 'Spare pump' : `PMP-${i}` }))
    if (i !== 9) objects.push(object(`sensor${i}`, { typeId: 'sensorT', parentId: `pump${i}`, displayName: `Vibration ${i}` }))
  }
  for (let i = 0; i < 20; i++) objects.push(object(`widget${i}`, { typeId: 'widgetT', parentId: 'site', displayName: 'Widget' }))
  for (let i = 0; i < 200; i++) objects.push(object(`thing${i}`, { parentId: 'site', displayName: 'Thing' }))
  return objects
}

const report = computeInsightsReport(catalog(), types)
const rules = buildRules(report)
const pumpRule = (kind: string) => rules.notable.find(rule => rule.convention.typeId === 'pumpT' && rule.convention.kind === kind)!

describe('buildRules', () => {
  it('is one list where the report has two: every convention, with its exceptions attached', () => {
    expect(rules.notable.length + rules.shared.length).toBe(report.conventions.length)
    expect(rules.notable).toHaveLength(report.summary.conventions)

    // Kept by every pump: no exceptions to attach.
    expect(pumpRule('unusual-parent').deviation).toBeNull()
    // Broken by one: the deviation that lists it.
    expect(pumpRule('missing-child').deviation?.outlierCount).toBe(1)
    expect(pumpRule('missing-child').deviation?.groups[0].members[0].elementId).toBe('pump9')
  })

  it('keeps what the whole model does apart from what a type does', () => {
    const shared = rules.shared.map(ruleStatement)
    expect(shared).toContain('Widget sits under a Site')
    expect(rules.notable.map(ruleStatement)).not.toContain('Widget sits under a Site')
    // Nothing the model shares has exceptions to show: only a notable convention raises any.
    expect(rules.shared.every(rule => rule.deviation === null)).toBe(true)
  })

  it('lists the conventions with exceptions in the report’s own order, the most widely kept first', () => {
    expect(report.deviations.length).toBe(2)
    expect(rules.broken.map(rule => rule.deviation)).toEqual(report.deviations)
    expect(rules.broken.every(rule => rule.convention.notable)).toBe(true)
  })
})

describe('a rule in words', () => {
  it('says what the type does, without the type', () => {
    expect(rulePredicate(pumpRule('unusual-parent'))).toBe('sits under a Station')
    expect(rulePredicate(pumpRule('missing-child'))).toBe('contains exactly 1 Sensor')
  })

  it('states a naming convention with a real name, which reads where a pattern has to be decoded', () => {
    const naming = pumpRule('naming')
    expect(naming.example).toBe('PMP-0')
    expect(naming.convention.signature).toBe('A-9')
    expect(rulePredicate(naming)).toBe('names look like PMP-0')
  })

  it('adds the subject for a list that is not grouped by type', () => {
    expect(ruleStatement(pumpRule('unusual-parent'))).toBe('Pump sits under a Station')
  })
})
