// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { fanGraph, installFixedPane } from '../../testing/graphFixtures'
import { RadialGraph } from './RadialGraph'

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
    <RadialGraph
      root={root}
      graph={graph}
      isLoading={false}
      error={null}
      depth={1}
      onRootElement={() => {}}
      onSelectElement={() => {}}
    />
  )
}

describe('RadialGraph at scale', () => {
  it('draws a sparse ring as one interactive element per object', () => {
    const { container } = draw(fanGraph(5))

    expect(container.querySelectorAll('[data-node]')).toHaveLength(6)
  })

  it('draws a dense ring as shared dot paths, with elements only for what can be labeled', () => {
    const { container } = draw(fanGraph(3000))

    expect(container.querySelectorAll('[data-node]').length).toBeLessThan(100)
    expect(container.querySelectorAll('path').length).toBeLessThan(10)
  })
})
