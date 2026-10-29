// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DescriptionCard } from './DescriptionCard'

afterEach(cleanup)

describe('DescriptionCard', () => {
  it('shows a failed detail read with a retry instead of an empty description', () => {
    const onRetry = vi.fn()
    render(<DescriptionCard error="HTTP 503" onRetry={onRetry} />)

    expect(screen.getByRole('alert').textContent).toContain('HTTP 503')
    expect(screen.queryByText('No description provided.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says there is no description only when the details loaded', () => {
    render(<DescriptionCard />)

    expect(screen.getByText('No description provided.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
