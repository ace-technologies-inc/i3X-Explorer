// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ValueDisplay } from './ValueDisplay'
import { CHILD_PAGE_SIZE, CHILD_PAGE_SLACK } from '../../stores/explorer'
import type { LastKnownValue } from '../../api/types'

function valueWith(componentCount: number): LastKnownValue {
  const components: LastKnownValue['components'] = {}
  for (let i = 0; i < componentCount; i++) components[`component-${i}`] = { value: i }
  return { elementId: 'root', value: {}, parentId: null, namespaceUri: 'ns', components }
}

const componentRows = () =>
  screen.getAllByRole('button').filter(button => button.hasAttribute('aria-expanded'))

describe('ValueDisplay component paging', () => {
  afterEach(cleanup)

  it('shows a small component list in full', () => {
    render(<ValueDisplay value={valueWith(CHILD_PAGE_SIZE + CHILD_PAGE_SLACK)} />)
    expect(componentRows()).toHaveLength(CHILD_PAGE_SIZE + CHILD_PAGE_SLACK)
    expect(screen.queryByText(/hidden/)).toBeNull()
  })

  it('pages a large component list', () => {
    render(<ValueDisplay value={valueWith(500)} />)
    expect(componentRows()).toHaveLength(CHILD_PAGE_SIZE)

    fireEvent.click(screen.getByText(`Show ${CHILD_PAGE_SIZE} more`))
    expect(componentRows()).toHaveLength(CHILD_PAGE_SIZE * 2)

    fireEvent.click(screen.getByText('Show all'))
    expect(componentRows()).toHaveLength(500)
    expect(screen.queryByText(/hidden/)).toBeNull()
  })
})
