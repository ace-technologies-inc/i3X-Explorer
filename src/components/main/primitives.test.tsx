// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Card } from './primitives'

/**
 * The full-screen toggle on the relationship panels.
 *
 * The contract worth guarding is not the CSS, it is that expanding **keeps the
 * children mounted**: the map's pan/zoom, its focused branch and the list's
 * expansion state all live in component state, so a toggle that remounted them
 * would throw away exactly what you went full screen to look at more closely.
 */

afterEach(cleanup)

const overlayOf = (element: HTMLElement) => element.parentElement

describe('Card, expandable', () => {
  it('offers no toggle unless asked', () => {
    render(<Card title="Plain">body</Card>)
    expect(screen.queryByRole('button', { name: /full screen/i })).toBeNull()
  })

  it('keeps the same DOM nodes across expand and collapse', () => {
    render(
      <Card title="Relationships" expandable>
        <div data-testid="drawing">map</div>
      </Card>
    )
    const before = screen.getByTestId('drawing')

    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    const expanded = screen.getByTestId('drawing')
    expect(expanded).toBe(before)

    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }))
    expect(screen.getByTestId('drawing')).toBe(before)
  })

  it('takes over the window while expanded, and adds no box otherwise', () => {
    render(
      <Card title="Relationships" className="flex" expandable>
        body
      </Card>
    )
    const section = screen.getByRole('button', { name: 'Full screen' }).closest('section')!

    // Collapsed: the wrapper is display:contents, so the card lays out exactly
    // where it did before this feature existed.
    expect(overlayOf(section)?.className).toBe('contents')

    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(overlayOf(section)?.className).toContain('fixed inset-0')
    expect(section.className).toContain('h-full')
  })

  it('collapses on Escape, but not while a field or menu owns the key', () => {
    render(
      <Card title="Relationships" expandable>
        <input aria-label="search" />
      </Card>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))

    // Esc in the header search clears the search, it does not exit full screen.
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Exit full screen' })).not.toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Exit full screen' })).toBeNull()
  })
})
