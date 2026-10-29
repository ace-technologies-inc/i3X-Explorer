// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  it('renders Markdown as semantic elements', () => {
    const { container } = render(
      <MarkdownContent>{'**Bold**\n\n- Item'}</MarkdownContent>
    )

    expect(screen.getByText('Bold').tagName).toBe('STRONG')
    expect(screen.getByText('Item').tagName).toBe('LI')
    expect(container.querySelector('ul')).not.toBeNull()
  })

  it('does not render raw HTML', () => {
    const { container } = render(
      <MarkdownContent>{'<script>alert(1)</script>'}</MarkdownContent>
    )

    expect(container.querySelector('script')).toBeNull()
  })

  it('renders GitHub-Flavored Markdown tables', () => {
    const { container } = render(
      <MarkdownContent>{'| Term | Meaning |\n| --- | --- |\n| **Object** | An addressable thing |'}</MarkdownContent>
    )

    expect(container.querySelector('table')).not.toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Term' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'An addressable thing' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Object' }).querySelector('strong')).not.toBeNull()
  })

})