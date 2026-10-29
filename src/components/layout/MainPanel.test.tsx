// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MainPanel } from './MainPanel'
import { useExplorerStore } from '../../stores/explorer'
import type { RelationshipType } from '../../api/types'

vi.mock('../diff/DiffView', () => ({
  DiffView: () => null,
}))

vi.mock('../insights/InsightsView', () => ({
  InsightsView: () => null,
}))

vi.mock('../main/HomeView', () => ({
  HomeView: () => null,
}))

vi.mock('../main/ObjectDetailView', () => ({
  ObjectDetailView: () => null,
}))

vi.mock('../details/NamespaceDetail', () => ({
  NamespaceDetail: () => null,
}))

vi.mock('../details/ObjectTypeDetail', () => ({
  ObjectTypeDetail: () => null,
}))

describe('MainPanel relationship type details', () => {
  beforeEach(() => {
    useExplorerStore.getState().reset()
  })

  it('shows relationship type details when selected', () => {
    const relationship: RelationshipType = {
      elementId: 'demo:InZone',
      relationshipId: 'demo:InZone',
      displayName: 'In Zone',
      description: 'An area or piece of equipment belongs to a maintenance zone.',
      namespaceUri: 'demo',
      reverseOf: 'demo:ZoneContains',
    }

    useExplorerStore.getState().selectItem({
      type: 'relationshipType',
      id: 'reltype:demo:InZone',
      data: relationship,
    })

    const { container } = render(<MainPanel />)
    const text = container.textContent ?? ''

    expect(text).toContain('In Zone')
    expect(text).toContain('Relationship Type')
    expect(text).toContain(
      'An area or piece of equipment belongs to a maintenance zone.'
    )
    expect(text).toContain('demo:InZone')
    expect(text).toContain('demo:ZoneContains')
  })
})