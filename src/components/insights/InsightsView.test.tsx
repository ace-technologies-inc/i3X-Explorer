// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { InsightsView } from './InsightsView'
import { useExplorerStore } from '../../stores/explorer'
import { getInsightsReport } from '../main/insightsReport'
import { installJsdomLayout } from '../../testing/jsdomLayout'
import type { ObjectInstance, ObjectType } from '../../api/types'

/**
 * The page-level guard. WindowedList.test.tsx proves the list component draws;
 * this proves the page built on it does, section by section, because the
 * failure that prompted this work was four of six sections rendering
 * completely empty on a real catalog while the engine computed them correctly.
 *
 * The catalog below is synthetic but engineered to produce every section, and
 * each assertion checks the engine's output first, so a fixture that stops
 * exercising a section fails loudly instead of passing on an empty list.
 */

beforeAll(installJsdomLayout)
afterEach(cleanup)

function object(elementId: string, over: Partial<ObjectInstance> = {}): ObjectInstance {
  return {
    elementId,
    displayName: elementId,
    typeId: 'thingT',
    parentId: null,
    isComposition: false,
    namespaceUri: 'urn:ns',
    ...over,
  }
}

function objectType(elementId: string, displayName = elementId): ObjectType {
  return { elementId, displayName, namespaceUri: 'urn:ns', schema: {} }
}

/**
 * A catalog with, on purpose: a strong placement norm with two exceptions, a
 * containment norm with three, a naming norm with two, a two-population split,
 * a norm the whole model shares (so it lands in the "trivially true" fold),
 * objects breaking two norms at once, and one of each data-quality problem.
 */
function buildCatalog(): { objects: ObjectInstance[]; types: ObjectType[] } {
  const objects: ObjectInstance[] = [
    object('siteA', { typeId: 'siteT', displayName: 'Site A' }),
    object('stationA', { typeId: 'stationT', displayName: 'Station A', parentId: 'siteA' }),
    object('bin', { typeId: 'binT', displayName: 'Spare Bin', parentId: 'siteA' }),
  ]

  // Pumps: 38 under a Station, 2 in the Bin. 37 hold a sensor. 2 named oddly.
  for (let i = 0; i < 40; i++) {
    const strays = i >= 38
    objects.push(
      object(`pump${i}`, {
        typeId: 'pumpT',
        parentId: strays ? 'bin' : 'stationA',
        displayName: i >= 36 ? `Spare Pump ${i}` : `PMP-${i}`,
      })
    )
    // The two strays are also the ones missing a sensor: two broken norms on
    // one object is what the anomaly list ranks.
    if (i < 37) {
      objects.push(
        object(`sensor${i}`, {
          typeId: 'sensorT',
          parentId: `pump${i}`,
          displayName: `Vibration ${i}`,
        })
      )
    }
  }

  // Valves: a genuine two-population split, 60 under a Station, 40 under a Site.
  for (let i = 0; i < 60; i++) {
    objects.push(object(`valveA${i}`, { typeId: 'valveT', parentId: 'stationA' }))
  }
  for (let i = 0; i < 40; i++) {
    objects.push(object(`valveB${i}`, { typeId: 'valveT', parentId: 'siteA' }))
  }

  // Filler that also sits under the Site, so "widgets sit under a Site" is
  // true but unremarkable: a trivially-true convention.
  for (let i = 0; i < 300; i++) {
    objects.push(object(`thing${i}`, { typeId: 'thingT', parentId: 'siteA' }))
  }
  for (let i = 0; i < 20; i++) {
    objects.push(object(`widget${i}`, { typeId: 'widgetT', parentId: 'siteA' }))
  }

  // Data quality: an orphan, an untyped object, and a colliding elementId.
  objects.push(object('lonely', { parentId: 'a-parent-that-is-not-here' }))
  objects.push(object('shapeless', { typeId: '' }))
  objects.push(object('twin', { parentId: 'siteA' }))
  objects.push(object('twin', { parentId: 'siteA', displayName: 'twin (second)' }))

  const types = [
    objectType('siteT', 'Site'),
    objectType('stationT', 'Station'),
    objectType('binT', 'Bin'),
    objectType('pumpT', 'Pump'),
    objectType('sensorT', 'Vibration Sensor'),
    objectType('valveT', 'Valve'),
    objectType('widgetT', 'Widget'),
    objectType('thingT', 'Thing'),
    // Declared but never instantiated: informational, not an issue.
    objectType('unusedA', 'Legacy Drive'),
    objectType('unusedB', 'Legacy Meter'),
  ]

  return { objects, types }
}

const { objects, types } = buildCatalog()

function renderPage() {
  useExplorerStore.getState().setAllObjects(objects)
  useExplorerStore.setState({ objectTypes: types, namespaces: [] })
  return getInsightsReport(objects, types, 0).report
}

/** The card whose header matches, so each assertion is scoped to its section. */
function card(headingText: RegExp): HTMLElement {
  const heading = screen.getByRole('heading', { name: headingText })
  return heading.closest('section') as HTMLElement
}

describe('InsightsView', () => {
  it('the fixture exercises every section', () => {
    const report = renderPage()
    expect(report.profiles.length).toBeGreaterThan(0)
    expect(report.summary.conventions).toBeGreaterThan(0)
    expect(report.summary.trivialConventions).toBeGreaterThan(0)
    expect(report.deviations.length).toBeGreaterThan(0)
    expect(report.splits.length).toBeGreaterThan(0)
    expect(report.anomalies.length).toBeGreaterThan(0)
    expect(report.dataQuality.orphans.length).toBe(1)
    expect(report.dataQuality.untyped.length).toBe(1)
    expect(report.dataQuality.duplicateElementIds.length).toBe(1)
    expect(report.dataQuality.unusedTypes.length).toBe(2)
  })

  it('draws rows in the type atlas', () => {
    const report = renderPage()
    render(<InsightsView />)
    const atlas = card(/^Type atlas/)
    expect(within(atlas).getAllByRole('button', { name: /Expand /i }).length).toBeGreaterThan(0)
    expect(within(atlas).getByText(report.profiles[0].typeLabel)).toBeDefined()
  })

  it('draws conventions, with the unremarkable ones folded away', () => {
    const report = renderPage()
    render(<InsightsView />)
    const conventions = card(/^Conventions/)
    const notable = report.conventions.filter(c => c.notable)
    expect(within(conventions).getAllByRole('button').length).toBeGreaterThan(notable.length)
    expect(
      within(conventions).getByText(new RegExp(`${report.summary.trivialConventions} more hold`))
    ).toBeDefined()
  })

  it('draws deviations', () => {
    const report = renderPage()
    render(<InsightsView />)
    const deviations = card(/^Deviations/)
    expect(within(deviations).getAllByRole('button', { expanded: false }).length).toBeGreaterThan(0)
    expect(report.deviations.length).toBeGreaterThan(0)
  })

  it('draws splits with their populations', () => {
    renderPage()
    render(<InsightsView />)
    const splits = card(/^Splits/)
    expect(within(splits).getByText('Valve')).toBeDefined()
    expect(within(splits).getByText('Station')).toBeDefined()
    expect(within(splits).getByText('Site')).toBeDefined()
  })

  it('draws data-quality blocks and keeps unused types out of the issue count', () => {
    const report = renderPage()
    render(<InsightsView />)
    const quality = card(/^Data quality/)
    expect(within(quality).getByText('Orphaned objects')).toBeDefined()
    expect(within(quality).getByText('Untyped objects')).toBeDefined()
    expect(within(quality).getByText('Duplicate elementIds')).toBeDefined()
    expect(within(quality).getByText('Declared types with no instances')).toBeDefined()
    // 3 issues, and the 2 unused types are not among them.
    expect(report.summary.dataQualityIssues).toBe(3)
    expect(screen.getByRole('heading', { name: /^Data quality · 3 issues/ })).toBeDefined()
  })

  it('gives every anomaly row something that distinguishes it', () => {
    const report = renderPage()
    render(<InsightsView />)
    const anomalies = card(/^Most anomalous objects/)
    const rows = within(anomalies).getAllByRole('listitem')
    expect(rows.length).toBe(report.anomalies.length)
    const rendered = rows.map(row => row.textContent)
    expect(new Set(rendered).size).toBe(rendered.length)
  })

  it('states the overlap between the Conventions and Deviations tiles', () => {
    const report = renderPage()
    render(<InsightsView />)
    expect(report.summary.conventionsWithExceptions).toBe(report.summary.deviations)
    expect(
      screen.getByText(
        new RegExp(`${report.summary.conventionsWithExceptions} also under Deviations`)
      )
    ).toBeDefined()
  })
})
