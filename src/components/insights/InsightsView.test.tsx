// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { InsightsView } from './InsightsView'
import { useExplorerStore, type InsightsSection } from '../../stores/explorer'
import { getInsightsReport } from '../main/insightsReport'
import { installJsdomLayout } from '../../testing/jsdomLayout'
import type { ObjectInstance, ObjectType } from '../../api/types'

/**
 * The guard for Home's Model insights tab. WindowedList.test.tsx proves the
 * list component draws; this proves the views built on it do, card by card,
 * because the failure that prompted the first of these tests was four of six
 * sections rendering completely empty on a real catalog while the engine
 * computed them correctly.
 *
 * It also guards the rule the tab was rebuilt around: nothing is counted
 * without a way to see it. Every "N more" here is a button, and every one is
 * pressed.
 *
 * The catalog below is synthetic but engineered to produce every card, and the
 * first test checks the engine's output, so a fixture that stops exercising a
 * card fails loudly instead of passing on an empty list.
 */

beforeAll(installJsdomLayout)
afterEach(() => {
  cleanup()
  useExplorerStore.getState().reset()
})

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
 * containment norm with three, a naming norm with four, a two-population split,
 * a norm the whole model shares (so it is folded away), objects breaking
 * several norms at once, and one of each data-quality problem.
 */
function buildCatalog(): { objects: ObjectInstance[]; types: ObjectType[] } {
  const objects: ObjectInstance[] = [
    object('siteA', { typeId: 'siteT', displayName: 'Site A' }),
    object('stationA', { typeId: 'stationT', displayName: 'Station A', parentId: 'siteA' }),
    object('bin', { typeId: 'binT', displayName: 'Spare Bin', parentId: 'siteA' }),
  ]

  // Pumps: 38 under a Station, 2 in the Bin. 37 hold a sensor. 4 named oddly.
  for (let i = 0; i < 40; i++) {
    const strays = i >= 38
    objects.push(
      object(`pump${i}`, {
        typeId: 'pumpT',
        parentId: strays ? 'bin' : 'stationA',
        displayName: i >= 36 ? `Spare Pump ${i}` : `PMP-${i}`,
      })
    )
    // The two strays are also among those missing a sensor: several broken
    // norms on one object is what the anomaly list ranks.
    if (i < 37) {
      objects.push(object(`sensor${i}`, { typeId: 'sensorT', parentId: `pump${i}`, displayName: `Vibration ${i}` }))
    }
  }

  // Valves: a genuine two-population split, 60 under a Station, 40 under a Site.
  for (let i = 0; i < 60; i++) objects.push(object(`valveA${i}`, { typeId: 'valveT', parentId: 'stationA' }))
  for (let i = 0; i < 40; i++) objects.push(object(`valveB${i}`, { typeId: 'valveT', parentId: 'siteA' }))

  // Filler that also sits under the Site, so "widgets sit under a Site" is
  // true but unremarkable: a convention the rest of the model keeps too.
  for (let i = 0; i < 300; i++) objects.push(object(`thing${i}`, { typeId: 'thingT', parentId: 'siteA' }))
  for (let i = 0; i < 20; i++) objects.push(object(`widget${i}`, { typeId: 'widgetT', parentId: 'siteA' }))

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

function renderView(section: InsightsSection = 'summary', catalog = { objects, types }) {
  useExplorerStore.getState().setAllObjects(catalog.objects)
  // Through the setter, which indexes the types: a type's name is a button only when the server declares it.
  useExplorerStore.getState().setObjectTypes(catalog.types)
  useExplorerStore.setState({ namespaces: [], insightsSection: section })
  // Primes the memo the view reads, so the first render already has the report.
  const { report } = getInsightsReport(catalog.objects, catalog.types, 0)
  render(<InsightsView />)
  return report
}

/** The card whose title starts with this: a title may also carry its help marker. */
function card(name: string): HTMLElement {
  return screen.getByRole('heading', { name: new RegExp(`^${name}`), level: 3 }).closest('section') as HTMLElement
}

/** A headline figure, by its label. */
function figure(label: string): string | null | undefined {
  return screen
    .getAllByText(label)
    .find(element => element.tagName === 'DIV' && element.nextElementSibling !== null)
    ?.nextElementSibling?.textContent
}

const selected = () => useExplorerStore.getState().selectedItem

describe('the fixture', () => {
  it('exercises every card', () => {
    const { report } = getInsightsReport(objects, types, 0)
    expect(report.profiles.length).toBeGreaterThan(0)
    expect(report.summary.conventions).toBeGreaterThan(0)
    expect(report.conventions.some(convention => !convention.notable)).toBe(true)
    expect(report.deviations).toHaveLength(5)
    expect(report.splits).toHaveLength(1)
    expect(report.anomalies).toHaveLength(4)
    expect(report.dataQuality.orphans).toHaveLength(1)
    expect(report.dataQuality.untyped).toHaveLength(1)
    expect(report.dataQuality.duplicateElementIds).toHaveLength(1)
    expect(report.dataQuality.unusedTypes).toHaveLength(2)
  })
})

describe('InsightsView', () => {
  it('is a tab of Home, not a page to close: three views and no Close button', () => {
    renderView()
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()

    const views = screen.getByRole('group', { name: 'Model insights view' })
    expect(within(views).getAllByRole('button').map(button => button.textContent)).toEqual(['Summary', 'Conventions', 'Types'])
    expect(within(views).getByRole('button', { name: 'Summary', pressed: true })).toBeTruthy()

    fireEvent.click(within(views).getByRole('button', { name: 'Types' }))
    expect(useExplorerStore.getState().insightsSection).toBe('types')
    expect(card('Types')).toBeTruthy()

    fireEvent.click(within(views).getByRole('button', { name: 'Conventions' }))
    expect(card('Conventions')).toBeTruthy()
  })

  it('says so when there is no model, and while one is on its way', () => {
    render(<InsightsView />)
    expect(screen.getByText('No model loaded')).toBeTruthy()
    cleanup()

    useExplorerStore.setState({ isLoading: true })
    render(<InsightsView />)
    expect(screen.getByRole('status').textContent).toContain('Analyzing the model')
  })
})

describe('Model insights, summary', () => {
  it('opens with the four figures that sum the model up', () => {
    const report = renderView()
    expect(figure('Conventions')).toBe(report.summary.conventions.toLocaleString())
    // Pumps: 2 off the placement, 3 without a sensor, 4 named differently. Things: 1 and 2.
    expect(figure('Exceptions')).toBe('12')
    expect(screen.getByText('to 5 conventions')).toBeTruthy()
    expect(figure('Types in two places')).toBe('1')
    // The two unused types are not among the objects to check.
    expect(figure('Objects to check')).toBe('3')
    expect(screen.getByText('1 orphaned, 1 untyped, 1 duplicate ID')).toBeTruthy()
  })

  it('draws each convention with exceptions as a meter, and opens it onto the objects', () => {
    renderView()
    const conventions = card('Conventions with exceptions')
    expect(within(conventions).getByText('Pump sits under a Station')).toBeTruthy()
    expect(within(conventions).getByText('Pump contains exactly 1 Vibration Sensor')).toBeTruthy()
    // A naming convention is stated with a real name; the pattern is printed beside it.
    expect(within(conventions).getByText('Pump names look like PMP-0')).toBeTruthy()
    expect(within(conventions).getByText('pattern A-9')).toBeTruthy()
    expect(within(conventions).getByRole('img', { name: 'Pump sits under a Station: 38 of 40 do' })).toBeTruthy()

    fireEvent.click(within(conventions).getByRole('button', { name: 'Show exceptions to Pump sits under a Station' }))
    expect(within(conventions).getByText('Where the 2 exceptions are')).toBeTruthy()
    // Grouped by where they sit; one group, so its objects are listed at once.
    expect(within(conventions).getByText('Under a Bin instead, all within Site A')).toBeTruthy()

    fireEvent.click(within(conventions).getByRole('button', { name: /Spare Pump 38/ }))
    expect(selected()?.id).toBe('hier:pump38')
  })

  it('names a group of differently named objects by one of them', () => {
    renderView()
    const conventions = card('Conventions with exceptions')
    fireEvent.click(within(conventions).getByRole('button', { name: 'Show exceptions to Pump names look like PMP-0' }))
    expect(within(conventions).getByText('Named like Spare Pump 36')).toBeTruthy()
    expect(within(conventions).getByText('pattern A A 9')).toBeTruthy()
  })

  it('leads from the card to every convention', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: 'All conventions' }))
    expect(useExplorerStore.getState().insightsSection).toBe('conventions')
  })

  it('draws a type kept in two places as one bar, every part named', () => {
    renderView()
    const splits = card('Types in two places')
    const bar = within(splits).getByRole('group', { name: 'Where Valve instances sit' })
    expect(within(bar).getByRole('button', { name: 'Under a Station: 60 instances (60%)' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'Under a Site: 40 instances (40%)' })).toBeTruthy()
    // No part that names nothing.
    expect(within(splits).queryByText(/elsewhere/i)).toBeNull()

    // Examples are filed under the place they sit in, since the same names turn up in both.
    expect(within(splits).getByText('For example under a Site')).toBeTruthy()
    fireEvent.click(within(splits).getByRole('button', { name: 'valveB0' }))
    expect(selected()?.id).toBe('hier:valveB0')
  })

  it('lists every object breaking several conventions, each reason in words', () => {
    const report = renderView()
    const anomalies = card('Objects breaking several conventions')
    expect(within(anomalies).getByText('4 objects, the most conventions broken first')).toBeTruthy()

    const rows = within(anomalies).getAllByRole('list', { name: /breaks \d conventions/ })
    expect(rows).toHaveLength(report.anomalies.length)
    expect(within(rows[0]).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Sits under a Bin, not a Station',
      'Contains no Vibration Sensor',
      'Name does not look like PMP-0',
    ])
    // A place that is not a type is still said as a place.
    expect(within(anomalies).getByText('Sits under a parent the catalog does not hold, not under a Site')).toBeTruthy()

    // Names repeat on a real model, so a row also carries where it sits and its id.
    const text = rows.map(row => row.parentElement?.textContent)
    expect(new Set(text).size).toBe(text.length)

    fireEvent.click(within(anomalies).getByRole('button', { name: 'Spare Pump 38' }))
    expect(selected()?.id).toBe('hier:pump38')
  })

  it('opens each kind of object to check onto the objects themselves', () => {
    renderView()
    const quality = card('Objects to check')

    fireEvent.click(within(quality).getByRole('button', { name: 'Show orphaned objects' }))
    expect(within(quality).getByRole('button', { name: /^lonely/ })).toBeTruthy()

    fireEvent.click(within(quality).getByRole('button', { name: 'Show duplicate ids' }))
    expect(within(quality).getByText('used 2 times')).toBeTruthy()

    // Declared types with no instances are listed, and said not to be a problem.
    expect(within(quality).getByText('not an issue')).toBeTruthy()
    fireEvent.click(within(quality).getByRole('button', { name: 'Show declared types with no instances' }))
    fireEvent.click(within(quality).getByRole('button', { name: 'Legacy Drive' }))
    expect(selected()?.id).toBe('type:unusedA')
  })
})

describe('Model insights, a list longer than its first page', () => {
  /** Seven kinds of object, each kept under its own kind of home but for one stray: seven conventions with exceptions. */
  function manyConventions(): { objects: ObjectInstance[]; types: ObjectType[] } {
    const catalogObjects: ObjectInstance[] = [object('site', { typeId: 'siteT' }), object('bin', { typeId: 'binT', parentId: 'site' })]
    const catalogTypes: ObjectType[] = [objectType('siteT', 'Site'), objectType('binT', 'Bin')]
    for (let kind = 0; kind < 7; kind++) {
      catalogTypes.push(objectType(`homeT${kind}`, `Home ${kind}`), objectType(`kindT${kind}`, `Kind ${kind}`))
      catalogObjects.push(object(`home${kind}`, { typeId: `homeT${kind}`, parentId: 'site' }))
      for (let i = 0; i < 20; i++) {
        catalogObjects.push(object(`kind${kind}-${i}`, { typeId: `kindT${kind}`, parentId: i === 0 ? 'bin' : `home${kind}` }))
      }
    }
    return { objects: catalogObjects, types: catalogTypes }
  }

  it('says how many more there are, and shows them', () => {
    const report = renderView('summary', manyConventions())
    expect(report.deviations).toHaveLength(7)

    const conventions = card('Conventions with exceptions')
    expect(within(conventions).getAllByRole('button', { name: /^Show exceptions to/ })).toHaveLength(5)
    expect(within(conventions).getByText('2 more conventions with exceptions')).toBeTruthy()

    fireEvent.click(within(conventions).getByRole('button', { name: 'Show them' }))
    expect(within(conventions).getAllByRole('button', { name: /^Show exceptions to/ })).toHaveLength(7)
    expect(within(conventions).queryByText(/more conventions with exceptions/)).toBeNull()
  })
})

describe('Model insights, conventions', () => {
  it('groups every convention under its type, each a meter', () => {
    const report = renderView('conventions')
    const pump = screen.getByRole('region', { name: 'Pump' })
    expect(within(pump).getByText('40 instances')).toBeTruthy()
    // Under its type the subject is not repeated.
    expect(within(pump).getByText('sits under a Station')).toBeTruthy()
    expect(within(pump).getAllByRole('img')).toHaveLength(3)

    const notable = report.conventions.filter(convention => convention.notable).length
    expect(within(card('Conventions')).getAllByRole('img')).toHaveLength(notable)
  })

  it('filters to the conventions with exceptions, or to the ones fully kept', () => {
    const report = renderView('conventions')
    const conventions = card('Conventions')
    const notable = report.conventions.filter(convention => convention.notable).length

    fireEvent.click(within(conventions).getByRole('button', { name: 'With exceptions 5' }))
    expect(within(conventions).getAllByRole('img')).toHaveLength(5)

    fireEvent.click(within(conventions).getByRole('button', { name: `Fully kept ${notable - 5}` }))
    expect(within(conventions).getAllByRole('img')).toHaveLength(notable - 5)
    expect(within(conventions).queryByRole('button', { name: /^Show exceptions to/ })).toBeNull()
  })

  it('keeps what the whole model does out of the way, and one press away', () => {
    const report = renderView('conventions')
    const conventions = card('Conventions')
    const shared = report.conventions.filter(convention => !convention.notable).length
    expect(within(conventions).getByText(new RegExp(`^${shared} more conventions? the rest of the model keeps too$`))).toBeTruthy()
    expect(within(conventions).queryByText('Widget sits under a Site')).toBeNull()

    fireEvent.click(within(conventions).getByRole('button', { name: 'Show the conventions the rest of the model keeps too' }))
    expect(within(conventions).getByText('Widget sits under a Site')).toBeTruthy()
  })
})

describe('Model insights, types', () => {
  it('draws a row for every type in use', () => {
    const report = renderView('types')
    const table = card('Types')
    expect(within(table).getAllByRole('button', { name: /^Show details of / })).toHaveLength(report.profiles.length)
    expect(within(table).getByRole('img', { name: 'Sits under: Station 95% · Bin 5%' })).toBeTruthy()
  })

  it('opens a row onto where its instances sit, what they contain and how they are named', () => {
    renderView('types')
    const table = card('Types')
    fireEvent.click(within(table).getByRole('button', { name: 'Show details of Pump' }))

    expect(within(table).getByText('Where they sit')).toBeTruthy()
    fireEvent.click(within(table).getByTitle('Station: 38 instances (95%) · click to open'))
    expect(selected()?.id).toBe('type:stationT')

    expect(within(table).getByRole('img', { name: '93% of Pump instances contain a Vibration Sensor' })).toBeTruthy()
    // A real name, with the pattern it stands for beside it.
    expect(within(table).getByText('Names look like').nextElementSibling?.textContent).toBe('PMP-0 pattern A-9, 90% of names')
  })

  it('counts what does not fit in a row as a button that opens the row', () => {
    renderView('types')
    const table = card('Types')
    // A Site holds five kinds of thing; the row names two.
    expect(within(table).queryByText('What they contain')).toBeNull()
    fireEvent.click(within(table).getByRole('button', { name: 'Show everything Site instances contain' }))

    expect(within(table).getByText('What they contain')).toBeTruthy()
    expect(within(table).getByRole('button', { name: 'Hide details of Site' })).toBeTruthy()
  })
})
