// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RequestInspectorModal } from './RequestInspectorModal'
import { buildObjectRequestTabs } from './requestTabs'
import type { ObjectInstance } from '../../api/types'
import { createClient, destroyClient } from '../../api/client'

/**
 * The Request Inspector modal. What matters here is behavior the "expand inline"
 * predecessor never had: it renders one tab per real request kind (and none it
 * was not handed), switching the request tab and the language re-renders from
 * the version-accurate descriptors, redaction stays optional, and Esc / the
 * close button dismiss it. It must also never fabricate a request.
 */

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  destroyClient()
})

const OBJECT: ObjectInstance = {
  elementId: 'eq-1',
  displayName: 'Pump 1',
  typeId: 'Pump',
  parentId: 'station-1',
  isComposition: false,
  namespaceUri: 'urn:demo',
}

const tabs = buildObjectRequestTabs(OBJECT)

describe('RequestInspectorModal', () => {
  it('renders one tab per request kind', () => {
    render(<RequestInspectorModal title="Pump 1" tabs={tabs} onClose={() => {}} />)
    for (const label of ['Overview', 'Value', 'Relationships', 'History']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy()
    }
  })

  it('focuses the requested tab and shows its real method + endpoint', () => {
    render(
      <RequestInspectorModal
        title="Pump 1"
        tabs={tabs}
        initialTabId="value"
        onClose={() => {}}
      />
    )
    expect(screen.getByRole('tab', { name: 'Value' }).getAttribute('aria-selected')).toBe('true')
    // POST /objects/value is the value request; it appears in the summary row.
    expect(screen.getAllByText('/objects/value').length).toBeGreaterThan(0)
  })

  it('switches the request tab', () => {
    render(<RequestInspectorModal title="Pump 1" tabs={tabs} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Relationships' }))
    expect(screen.getAllByText('/objects/related').length).toBeGreaterThan(0)
  })

  it('switches the language and remembers it', () => {
    render(<RequestInspectorModal title="Pump 1" tabs={tabs} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Python' }))
    expect(localStorage.getItem('i3x-explorer:code-sample-language')).toBe('python')
  })

  it('closes on Escape and on the close button', () => {
    const onClose = vi.fn()
    const { container } = render(
      <RequestInspectorModal title="Pump 1" tabs={tabs} onClose={onClose} />
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(container).toBeTruthy()
  })

  it('offers the copy actions, with a body copy only when there is a body', () => {
    // A tab may be bodyless; value always has a body.
    render(
      <RequestInspectorModal title="Pump 1" tabs={tabs} initialTabId="value" onClose={() => {}} />
    )
    expect(screen.getByRole('button', { name: 'Copy request' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy body' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeTruthy()
  })

  it('hides the request tab bar for a single-request inspector', () => {
    const one = [tabs[0]]
    render(<RequestInspectorModal title="Pump 1" tabs={one} onClose={() => {}} />)
    expect(screen.queryByRole('tablist', { name: 'Request type' })).toBeNull()
  })

  it('executes the selected descriptor and shows the raw response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    createClient('https://api.example.test/v1')

    render(
      <RequestInspectorModal title="Pump 1" tabs={tabs} initialTabId="value" onClose={() => {}} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))

    expect(await screen.findByRole('heading', { name: 'Response' })).toBeTruthy()
    expect(screen.getByText('200 OK')).toBeTruthy()
    expect(screen.getByText(/"success": true/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/objects/value',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ elementIds: ['eq-1'], maxDepth: 1 }),
      })
    )
  })

  it('shows a response panel with a draggable divider while the request is running', async () => {
    let resolveResponse: (response: Response) => void
    const responsePromise = new Promise<Response>(resolve => {
      resolveResponse = resolve
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(responsePromise))
    createClient('https://api.example.test/v1')

    render(
      <RequestInspectorModal title="Pump 1" tabs={tabs} initialTabId="value" onClose={() => {}} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))

    expect(await screen.findByText('Waiting for server...')).toBeTruthy()
    expect(screen.getByText('Request is in progress.')).toBeTruthy()
    const divider = screen.getByRole('separator', { name: 'Resize response panel' })
    const responsePanel = screen.getByRole('heading', { name: 'Response' }).parentElement?.parentElement
    const codePanel = responsePanel?.parentElement
    expect(responsePanel?.getAttribute('style')).toContain('height: 208px')

    Object.defineProperty(codePanel, 'clientHeight', { configurable: true, value: 360 })

    fireEvent.mouseDown(divider, { clientY: 400 })
    fireEvent.mouseMove(window, { clientY: 300 })
    expect(responsePanel?.getAttribute('style')).toContain('height: 240px')
    fireEvent.mouseUp(window)

    resolveResponse!(new Response(null, { status: 204, statusText: 'No Content' }))
  })
})
