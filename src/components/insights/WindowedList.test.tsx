// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { WindowedList } from './WindowedList'
import {
  installJsdomLayout,
  TEST_MAX_HEIGHT as MAX_HEIGHT,
  TEST_ROW_HEIGHT as ROW_HEIGHT,
} from '../../testing/jsdomLayout'

/**
 * This test exists for one reason: every section of the Model Insights page
 * draws through WindowedList, and WindowedList once shipped rendering zero
 * rows on every catalog. See the height contract in WindowedList.tsx.
 *
 * The layout stub (testing/jsdomLayout.ts) emulates just enough CSS to
 * reproduce the original fixed point, so this fails against the pre-fix
 * component instead of passing vacuously.
 */

beforeAll(installJsdomLayout)
afterEach(cleanup)

function renderList(count: number) {
  const items = Array.from({ length: count }, (_, i) => `row-${i}`)
  const view = render(
    <WindowedList
      items={items}
      estimateHeight={ROW_HEIGHT}
      className="max-h-80"
      getKey={item => item}
      renderRow={item => <div>{item}</div>}
    />
  )
  const container = view.container.querySelector('[data-windowed-list]') as HTMLElement
  return { container, items }
}

describe('WindowedList', () => {
  it('renders rows when the container is bounded only by max-height', () => {
    renderList(500)
    // The regression: zero rows on first paint, forever.
    expect(screen.getByText('row-0')).toBeDefined()
    expect(screen.queryAllByText(/^row-\d+$/).length).toBeGreaterThan(1)
  })

  it('windows the list rather than mounting every row', () => {
    const { container } = renderList(500)
    const rendered = container.querySelectorAll('[data-index]').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)
  })

  it('reserves the full virtual height so the container can be measured', () => {
    const { container } = renderList(500)
    const spacer = container.firstElementChild as HTMLElement
    expect(parseFloat(spacer.style.minHeight)).toBe(500 * ROW_HEIGHT)
    expect(container.offsetHeight).toBe(MAX_HEIGHT)
  })

  it('shrinks to fit a short list instead of leaving an empty box', () => {
    const { container } = renderList(3)
    expect(container.offsetHeight).toBe(3 * ROW_HEIGHT)
    expect(screen.getByText('row-2')).toBeDefined()
  })

  it('renders nothing for an empty list', () => {
    const { container } = renderList(0)
    expect(container.querySelectorAll('[data-index]').length).toBe(0)
    expect(container.offsetHeight).toBe(0)
  })
})
