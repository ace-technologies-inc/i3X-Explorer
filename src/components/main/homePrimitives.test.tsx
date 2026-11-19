// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TabStrip, Toggle } from './homePrimitives'

afterEach(cleanup)

type Tab = 'overview' | 'model' | 'insights'
const TABS: { id: Tab; label: string; count?: number }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'model', label: 'Model', count: 1234 },
  { id: 'insights', label: 'Model insights' },
]

function Strip({ onChange }: { onChange?: (tab: Tab) => void }) {
  const [active, setActive] = useState<Tab>('overview')
  return (
    <TabStrip
      tabs={TABS}
      active={active}
      onChange={tab => {
        setActive(tab)
        onChange?.(tab)
      }}
      label="Home"
      idPrefix="home"
    />
  )
}

describe('TabStrip', () => {
  it('is a tab list whose tabs name the panels they control', () => {
    render(<Strip />)
    expect(screen.getByRole('tablist', { name: 'Home' })).toBeTruthy()

    const model = screen.getByRole('tab', { name: /^Model\s*1,234$/, selected: false })
    expect(model.id).toBe('home-tab-model')
    expect(model.getAttribute('aria-controls')).toBe('home-panel-model')
    // How many things a tab holds is printed beside its name.
    expect(model.textContent).toBe('Model1,234')
  })

  it('keeps only the selected tab in the tab order', () => {
    render(<Strip />)
    expect(screen.getAllByRole('tab').map(tab => tab.tabIndex)).toEqual([0, -1, -1])

    fireEvent.click(screen.getByRole('tab', { name: 'Model insights' }))
    expect(screen.getAllByRole('tab').map(tab => tab.tabIndex)).toEqual([-1, -1, 0])
  })

  it('moves with the arrow keys, Home and End, wrapping at both ends, and takes focus along', () => {
    const onChange = vi.fn()
    render(<Strip onChange={onChange} />)
    const strip = screen.getByRole('tablist')

    fireEvent.keyDown(strip, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('insights')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Model insights' }))

    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('overview')
    fireEvent.keyDown(strip, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('insights')
    fireEvent.keyDown(strip, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('overview')

    // Any other key is left to the page.
    fireEvent.keyDown(strip, { key: 'a' })
    expect(onChange).toHaveBeenCalledTimes(4)
  })
})

describe('Toggle', () => {
  it('says in a word what it will do, and names what it shows or hides', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <Toggle open={false} onToggle={onToggle} label="exceptions to Station sits under a Line">
        <span>46 exceptions</span>
      </Toggle>
    )
    const closed = screen.getByRole('button', { name: 'Show exceptions to Station sits under a Line', expanded: false })
    // The count it opens is part of the same button, then the word.
    expect(closed.textContent).toBe('46 exceptionsShow')
    fireEvent.click(closed)
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(
      <Toggle open onToggle={onToggle} label="exceptions to Station sits under a Line">
        <span>46 exceptions</span>
      </Toggle>
    )
    expect(screen.getByRole('button', { name: 'Hide exceptions to Station sits under a Line', expanded: true }).textContent).toBe(
      '46 exceptionsHide'
    )
  })
})
