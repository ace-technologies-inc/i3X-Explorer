// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormattedText } from './FormattedText'

describe('FormattedText', () => {
  it('renders text as plain content unless its MIME type is Markdown', () => {
    const { container } = render(<FormattedText mimeType="text/plain">{'**Bold**'}</FormattedText>)

    expect(container.querySelector('strong')).toBeNull()
    expect(screen.getByText('**Bold**')).toBeTruthy()
  })

  it('accepts Markdown MIME parameters', () => {
    const { container } = render(
      <FormattedText mimeType="text/markdown; charset=utf-8">{'**Bold**'}</FormattedText>
    )

    expect(container.querySelector('strong')).not.toBeNull()
  })
})