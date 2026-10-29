// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { fanGraph, installFixedPane } from '../../testing/graphFixtures'
import { TreeGraph } from './TreeGraph'

// The loader imports a public asset by absolute URL, which only Vite resolves.
vi.mock('../common/I3xLoader', () => ({ I3xLoader: () => null }))

let restorePane: () => void
beforeAll(() => {
  restorePane = installFixedPane()
})
afterAll(() => restorePane())
afterEach(cleanup)

function draw({ root, graph }: ReturnType<typeof fanGraph>) {
  return render(
    <TreeGraph root={root} graph={graph} isLoading={false} error={null} depth={1} descendantsOnly onSelectElement={() => {}} />
  )
}

describe('TreeGraph at scale', () => {
  it('draws a small tree as one interactive element per object', () => {
    const { container } = draw(fanGraph(5))

    expect(container.querySelectorAll('[data-node]')).toHaveLength(6)
  })

  it('draws a tree too tall to read as an overview, not thousands of elements', () => {
    const { container, getByText } = draw(fanGraph(3000))

    // Only the root stays interactive; the rest are dots in a few shared paths.
    expect(container.querySelectorAll('[data-node]')).toHaveLength(1)
    expect(container.querySelectorAll('path').length).toBeLessThan(10)
    expect(getByText(/3,001 objects · zoom in to read names/)).toBeTruthy()
  })
})
