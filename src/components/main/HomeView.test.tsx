// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useConnectionStore } from '../../stores/connection'
import { useExplorerStore } from '../../stores/explorer'

const performConnect = vi.fn()
vi.mock('../../services/connection', () => ({ performConnect: () => performConnect() }))

const { HomeView } = await import('./HomeView')

beforeEach(() => {
  performConnect.mockClear()
  // Back to Home's first tab too: the tab is part of the navigation stop a reset reseeds.
  useExplorerStore.getState().reset()
  useConnectionStore.setState({
    serverUrl: 'https://api.example.com/v1',
    isConnected: false,
    isConnecting: false,
    error: null,
    showConnectionDialog: false,
  })
})
afterEach(cleanup)

describe('HomeView, not connected', () => {
  it('is the way in: connect to the saved server, or choose another', () => {
    render(<HomeView />)
    expect(screen.getByRole('heading', { name: 'Connect to an i3X server' })).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Connect to api.example.com' }))
    expect(performConnect).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Choose another server' }))
    expect(useConnectionStore.getState().showConnectionDialog).toBe(true)
  })

  it('shows why the last attempt failed', () => {
    useConnectionStore.setState({ error: 'The server requires sign-in (HTTP 401).' })
    render(<HomeView />)
    expect(screen.getByRole('alert').textContent).toContain('HTTP 401')
  })

  it('offers only the server choice when none is saved', () => {
    useConnectionStore.setState({ serverUrl: '' })
    render(<HomeView />)
    expect(screen.queryByRole('button', { name: /^Connect to/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose a server' })).toBeTruthy()
  })
})

describe('HomeView, connected', () => {
  beforeEach(() => useConnectionStore.setState({ isConnected: true }))

  it('has three tabs and does not repeat the toolbar', () => {
    const { container } = render(<HomeView />)
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Overview', 'Model', 'Model insights'])
    // The server address and the search live in the toolbar, not here.
    expect(container.textContent).not.toContain('api.example.com')
    expect(screen.queryByRole('button', { name: /search/i })).toBeNull()
  })

  it('says so while there is no model to show', () => {
    render(<HomeView />)
    expect(screen.getByText('No model loaded')).toBeTruthy()
  })

  it('switches tabs on click and with the arrow keys', () => {
    render(<HomeView />)
    fireEvent.click(screen.getByRole('tab', { name: 'Model' }))
    expect(useExplorerStore.getState().homeTab).toBe('model')
    expect(screen.getByRole('tab', { name: 'Model', selected: true })).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(useExplorerStore.getState().homeTab).toBe('insights')
    // Past the last tab, the strip wraps to the first.
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(useExplorerStore.getState().homeTab).toBe('overview')
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' })
    expect(useExplorerStore.getState().homeTab).toBe('insights')
  })

  it('holds Model insights as a tab of its own, with nothing to close', () => {
    render(<HomeView />)
    fireEvent.click(screen.getByRole('tab', { name: 'Model insights' }))

    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe('home-tab-insights')
    expect(screen.getByRole('tab', { name: 'Model insights', selected: true })).toBeTruthy()
    // Not a page drawn over Home: the tab strip is still there, and no page is open.
    expect(useExplorerStore.getState().activePage).toBeNull()
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
  })

  it('makes each tab a stop that Back returns to', () => {
    render(<HomeView />)
    fireEvent.click(screen.getByRole('tab', { name: 'Model insights' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Model' }))

    act(() => useExplorerStore.getState().goBack())
    expect(screen.getByRole('tab', { name: 'Model insights', selected: true })).toBeTruthy()
  })
})
