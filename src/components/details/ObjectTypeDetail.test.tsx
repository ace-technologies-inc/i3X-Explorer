// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ObjectTypeDetail } from './ObjectTypeDetail'
import { destroyClient } from '../../api/client'
import type { ObjectType } from '../../api/types'

afterEach(() => {
  cleanup()
  destroyClient()
})

const OBJECT_TYPE: ObjectType = {
  elementId: 'urn:example:Pump',
  displayName: 'Pump',
  namespaceUri: 'urn:example',
  schema: { type: 'object' },
}

describe('ObjectTypeDetail', () => {
  it('opens the object-types request with metadata enabled by default', () => {
    render(<ObjectTypeDetail objectType={OBJECT_TYPE} />)

    fireEvent.click(screen.getByRole('button', { name: 'View request' }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getAllByText('/objecttypes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('urn:example').length).toBeGreaterThan(0)
    expect(screen.getAllByText('true').length).toBeGreaterThan(0)
  })
})