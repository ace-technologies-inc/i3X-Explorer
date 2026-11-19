// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModelOverview } from './ModelOverview'
import { qualityBreakdown } from './ModelInsightsSummary'
import { getInsightsReport, type InsightsReport } from './insightsReport'
import type { ModelStats } from './modelStats'
import { useExplorerStore } from '../../stores/explorer'
import { installJsdomLayout } from '../../testing/jsdomLayout'
import type { Namespace, ObjectInstance, ObjectType } from '../../api/types'

// The list of every root is windowed, and a windowed list needs a layout to measure.
beforeAll(installJsdomLayout)
afterEach(() => {
  cleanup()
  useExplorerStore.getState().reset()
})

function object(elementId: string, over: Partial<ObjectInstance> = {}): ObjectInstance {
  return { elementId, displayName: elementId, typeId: 'thingT', parentId: null, isComposition: false, namespaceUri: 'urn:ns', ...over }
}

const NS: Namespace = { uri: 'urn:ns', displayName: 'Plant' }

const types: ObjectType[] = [
  { elementId: 'siteT', displayName: 'Site', namespaceUri: 'urn:ns', schema: {} },
  { elementId: 'folderT', displayName: 'Folder', namespaceUri: 'urn:ns', schema: {} },
  { elementId: 'pumpT', displayName: 'Pump', namespaceUri: 'urn:ns', schema: {} },
  { elementId: 'spareT', displayName: 'Spare', namespaceUri: 'urn:ns', schema: {} },
]

/** Two sites, each with a folder called "Assets": the same name twice, which a real model has plenty of. */
function buildCatalog(): ObjectInstance[] {
  const objects = [
    object('north', { typeId: 'siteT', displayName: 'North' }),
    object('south', { typeId: 'siteT', displayName: 'South' }),
    object('north/assets', { typeId: 'folderT', displayName: 'Assets', parentId: 'north' }),
    object('south/assets', { typeId: 'folderT', displayName: 'Assets', parentId: 'south' }),
    object('lonely', { typeId: 'pumpT', parentId: 'not-in-this-catalog' }),
  ]
  for (let i = 0; i < 30; i++) objects.push(object(`n${i}`, { typeId: 'pumpT', displayName: `PMP-${i}`, parentId: 'north/assets' }))
  for (let i = 0; i < 12; i++) objects.push(object(`s${i}`, { typeId: 'pumpT', displayName: `PMP-${100 + i}`, parentId: 'south/assets' }))
  return objects
}

function renderOverview(section: 'overview' | 'model') {
  const objects = buildCatalog()
  useExplorerStore.getState().setAllObjects(objects)
  useExplorerStore.setState({ objectTypes: types, namespaces: [] })
  // Primes the memo the component reads, so the first render already has the report.
  const result = getInsightsReport(objects, types, 1)
  render(<ModelOverview section={section} objects={objects} objectTypes={types} namespaces={[NS]} />)
  return result
}

/** The card, by the start of its heading: a heading may also carry its help marker. */
function card(name: string): HTMLElement {
  return screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('section') as HTMLElement
}

describe('ModelOverview, overview', () => {
  it('opens with how big the model is', () => {
    const { stats } = renderOverview('overview')
    expect(screen.getByText('Objects').nextElementSibling?.textContent).toBe(stats.objects.toLocaleString())
    expect(screen.getByText('of 4 declared')).toBeTruthy()
  })

  it('draws the objects by type as one bar, and a part opens its type', () => {
    renderOverview('overview')
    const made = card('Objects by type')
    expect(within(made).getByRole('group', { name: 'Objects by type' })).toBeTruthy()

    fireEvent.click(within(made).getByRole('button', { name: /^Pump: 43 objects \(91%\)/ }))
    expect(useExplorerStore.getState().selectedItem?.type).toBe('objectType')
  })

  it('leads from the type bar to the Model tab', () => {
    renderOverview('overview')
    fireEvent.click(screen.getByRole('button', { name: 'All types' }))
    expect(useExplorerStore.getState().homeTab).toBe('model')
  })

  it('lists the roots with their sizes, and a row opens the object it names', () => {
    renderOverview('overview')
    const roots = card('Root objects')
    // The orphan counts as a root: you cannot go up from it.
    expect(within(roots).getAllByRole('button')).toHaveLength(3)

    fireEvent.click(within(roots).getByRole('button', { name: /North/ }))
    expect(useExplorerStore.getState().selectedItem?.id).toContain('north')
  })

  it('draws the hierarchy level by level', () => {
    renderOverview('overview')
    expect(within(card('Hierarchy')).getByTitle('Level 2: 42 objects')).toBeTruthy()
    expect(within(card('Hierarchy')).getByTitle('Root: 3 objects')).toBeTruthy()
  })

  it('sums up the model insights and leads to their tab', () => {
    const { report } = renderOverview('overview')
    const insights = card('Model insights')
    expect(within(insights).getByText('Conventions').previousElementSibling?.textContent).toBe(
      report.summary.conventions.toLocaleString()
    )
    expect(within(insights).getByText('Objects to check').previousElementSibling?.textContent).toBe(
      report.summary.dataQualityIssues.toLocaleString()
    )

    // Its Summary view, whichever view the tab was left on.
    useExplorerStore.setState({ insightsSection: 'types' })
    fireEvent.click(within(insights).getByRole('button', { name: 'Open model insights' }))
    expect(useExplorerStore.getState().homeTab).toBe('insights')
    expect(useExplorerStore.getState().insightsSection).toBe('summary')
    // A tab of Home, not a page drawn over it.
    expect(useExplorerStore.getState().activePage).toBeNull()
  })
})

describe('ModelOverview, model', () => {
  it('breaks the model down by type and level', () => {
    renderOverview('model')
    expect(within(card('Objects by type')).getByTitle('Pump: 43 objects (91%) · click to open')).toBeTruthy()
    expect(within(card('Hierarchy')).getByTitle('Level 1: 2 objects')).toBeTruthy()
  })

  it('opens a type from its bar', () => {
    renderOverview('model')
    fireEvent.click(within(card('Objects by type')).getByRole('button', { name: /Pump/ }))
    expect(useExplorerStore.getState().selectedItem?.type).toBe('objectType')
  })

  it('tells same-named objects apart by their parent', () => {
    renderOverview('model')
    const rows = within(card('Objects with the most children')).getAllByRole('button')
    expect(rows[0].textContent).toContain('Assets')
    expect(rows[0].textContent).toContain('Folder in North')
    expect(rows[0].textContent).toContain('30')
    expect(rows[1].textContent).toContain('Folder in South')
  })
})

describe('ModelOverview, a model with more types than fit', () => {
  /** Twenty types, type N holding N+1 objects, so both tabs fold a tail into "Other". */
  function renderManyTypes(section: 'overview' | 'model') {
    const manyTypes: ObjectType[] = Array.from({ length: 20 }, (_, n) => ({
      elementId: `t${n}`,
      displayName: `Type ${String(n).padStart(2, '0')}`,
      namespaceUri: 'urn:ns',
      schema: {},
    }))
    const objects = manyTypes.flatMap((type, n) =>
      Array.from({ length: n + 1 }, (_, i) => object(`${type.elementId}-${i}`, { typeId: type.elementId }))
    )
    useExplorerStore.getState().setAllObjects(objects)
    useExplorerStore.setState({ objectTypes: manyTypes, namespaces: [] })
    getInsightsReport(objects, manyTypes, 1)
    render(<ModelOverview section={section} objects={objects} objectTypes={manyTypes} namespaces={[NS]} />)
  }

  it('lets "Other" be expanded on the Overview bar, and a type inside it opens', () => {
    renderManyTypes('overview')
    const types = card('Objects by type')
    // The five largest are named; the other fifteen are folded.
    expect(within(types).queryByText('Type 03')).toBeNull()

    fireEvent.click(within(types).getByRole('button', { name: /^Other \(15\)\s*120$/ }))
    fireEvent.click(within(types).getByRole('button', { name: /Type 03/ }))
    expect(useExplorerStore.getState().selectedItem?.id).toBe('type:t3')
  })

  it('lets "Other" be expanded in the Model tab’s ranked bars', () => {
    renderManyTypes('model')
    const types = card('Objects by type')
    // Twelve bars, then the folded eight.
    expect(within(types).queryByText('Type 00')).toBeNull()

    fireEvent.click(within(types).getByRole('button', { name: /^Other \(8\)/, expanded: false }))
    expect(within(types).getByText('Type 00')).toBeTruthy()
    // Opened, the "Other" row is gone: its eight types stand in its place.
    expect(within(types).queryByText('Other (8)')).toBeNull()
    fireEvent.click(within(types).getByRole('button', { name: /Type 07/ }))
    expect(useExplorerStore.getState().selectedItem?.id).toBe('type:t7')
  })
})

describe('ModelOverview, nothing to show', () => {
  it('says there is no model', () => {
    render(<ModelOverview section="overview" objects={[]} objectTypes={[]} namespaces={[]} />)
    expect(screen.getByText('No model loaded')).toBeTruthy()
  })

  it('shows a loading state while the catalog is on its way', () => {
    render(<ModelOverview section="overview" objects={[]} objectTypes={[]} namespaces={[]} isLoading />)
    expect(screen.getByRole('status', { name: 'Loading the model' })).toBeTruthy()
    expect(screen.queryByText('No model loaded')).toBeNull()
  })
})

describe('ModelOverview, nothing cut short without a way to the rest', () => {
  /** Nine roots, root N holding N children, and three namespaces of which one holds nothing. */
  function renderWide(section: 'overview' | 'model') {
    const namespaces: Namespace[] = [
      { uri: 'urn:a', displayName: 'Assets' },
      { uri: 'urn:b', displayName: 'Batches' },
      { uri: 'urn:c', displayName: 'Calibration' },
    ]
    const objects: ObjectInstance[] = []
    for (let root = 0; root < 9; root++) {
      objects.push(object(`root${root}`, { typeId: 'siteT', displayName: `Root ${root}`, namespaceUri: 'urn:a' }))
      for (let child = 0; child < root; child++) {
        objects.push(object(`root${root}/${child}`, { typeId: 'pumpT', parentId: `root${root}`, namespaceUri: 'urn:b' }))
      }
    }
    useExplorerStore.getState().setAllObjects(objects)
    useExplorerStore.setState({ objectTypes: types, namespaces })
    getInsightsReport(objects, types, namespaces.length)
    render(<ModelOverview section={section} objects={objects} objectTypes={types} namespaces={namespaces} />)
  }

  it('shows the largest roots first, and all of them on request', () => {
    renderWide('overview')
    const roots = card('Root objects')
    expect(within(roots).getByText('The 6 largest of 9, by children')).toBeTruthy()
    expect(within(roots).queryByText('Root 0')).toBeNull()

    fireEvent.click(within(roots).getByRole('button', { name: 'Show all 9' }))
    expect(within(roots).getByText('All 9, the largest first')).toBeTruthy()
    // The smallest is there now, and opens like any other.
    fireEvent.click(within(roots).getByRole('button', { name: /Root 0/ }))
    expect(useExplorerStore.getState().selectedItem?.id).toBe('hier:root0')
  })

  it('folds the list of roots back', () => {
    renderWide('overview')
    const roots = card('Root objects')
    fireEvent.click(within(roots).getByRole('button', { name: 'Show all 9' }))
    fireEvent.click(within(roots).getByRole('button', { name: 'Show the 6 largest' }))
    expect(within(roots).queryByText('Root 0')).toBeNull()
  })

  it('opens a namespace from its bar', () => {
    renderWide('model')
    const namespaces = card('Objects by namespace')
    expect(within(namespaces).getByText('2 of 3 namespaces hold objects')).toBeTruthy()

    fireEvent.click(within(namespaces).getByRole('button', { name: /urn:b/ }))
    expect(useExplorerStore.getState().selectedItem?.id).toBe('ns:urn:b')
  })

  it('names the namespaces that hold nothing', () => {
    renderWide('model')
    const namespaces = card('Objects by namespace')
    expect(within(namespaces).getByText('1 namespace holds no objects')).toBeTruthy()
    expect(within(namespaces).queryByText('Calibration')).toBeNull()

    fireEvent.click(within(namespaces).getByRole('button', { name: 'Show the namespaces that hold no objects' }))
    fireEvent.click(within(namespaces).getByRole('button', { name: /Calibration/ }))
    expect(useExplorerStore.getState().selectedItem?.id).toBe('ns:urn:c')
  })
})

describe('the Model insights card’s wording', () => {
  it('says what is wrong with the objects that need a look', () => {
    const breakdown = (dataQualityIssues: number, stats: Partial<ModelStats>) =>
      qualityBreakdown({ summary: { dataQualityIssues } } as InsightsReport, { orphans: 0, untyped: 0, ...stats } as ModelStats)

    expect(breakdown(50, { orphans: 37, untyped: 12 })).toBe('37 orphaned, 12 untyped, 1 duplicate ID')
    expect(breakdown(2, { untyped: 2 })).toBe('2 untyped')
    expect(breakdown(0, {})).toBe('')
  })
})
