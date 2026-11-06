// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConnectionDialog } from './ConnectionDialog'
import { useConnectionStore } from '../../stores/connection'
import { loadRuntimeConfig } from '../../config/runtimeConfig'
import { releaseSignInWindow } from '../../auth/popupSignIn'

const issuer = 'https://login.example.com/tenant/v2.0'

const profileEnv = {
  I3X_OAUTH_COMPANY_LABEL: 'Company account',
  I3X_OAUTH_COMPANY_ISSUER: issuer,
  I3X_OAUTH_COMPANY_CLIENT_ID: 'explorer',
  I3X_OAUTH_COMPANY_SCOPES: 'openid api://i3x/read',
  I3X_OAUTH_COMPANY_APPLIES_TO: 'https://server.example',
  I3X_OAUTH_PARTNER_LABEL: 'Partner account',
  I3X_OAUTH_PARTNER_ISSUER: 'https://idp.partner.example',
  I3X_OAUTH_PARTNER_CLIENT_ID: 'partner-app',
  I3X_OAUTH_PARTNER_SCOPES: 'openid read',
  I3X_OAUTH_PARTNER_APPLIES_TO: 'https://server.example',
}

async function loadProfiles() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === './config.json') {
      return new Response(JSON.stringify({ env: profileEnv }), { headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`offline: ${String(input)}`)
  }))
  await loadRuntimeConfig()
}

beforeEach(async () => {
  localStorage.clear()
  useConnectionStore.setState({ savedCredentials: {}, credentials: null, isConnected: false, isConnecting: false, error: null })
  await loadProfiles()
})

afterEach(() => {
  cleanup()
  releaseSignInWindow()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const save = () => fireEvent.click(screen.getByRole('button', { name: /^Save( & Reconnect)?$/ }))

describe('ConnectionDialog OAuth', () => {
  it('offers the configured profiles for the server and saves the chosen one by name, even the first', () => {
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1' })
    render(<ConnectionDialog />)

    const picker = screen.getByLabelText('Sign-in profile') as HTMLSelectElement
    expect([...picker.options].map(option => option.value)).toEqual(['company', 'partner'])
    save()

    expect(useConnectionStore.getState().getCredentialsForUrl('https://server.example/v1'))
      .toEqual({ type: 'oauth', profile: 'company' })
  })

  it('saves the profile picked in the list', () => {
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1' })
    render(<ConnectionDialog />)

    fireEvent.change(screen.getByLabelText('Sign-in profile'), { target: { value: 'partner' } })
    save()

    expect(useConnectionStore.getState().getCredentialsForUrl('https://server.example/v1'))
      .toEqual({ type: 'oauth', profile: 'partner' })
  })

  it('keeps a saved profile that is no longer configured unresolved until another is chosen', () => {
    useConnectionStore.setState({
      serverUrl: 'https://server.example/v1',
      savedCredentials: { 'https://server.example/v1': { type: 'oauth', profile: 'retired' } },
    })
    render(<ConnectionDialog />)

    expect(screen.getByRole('alert').textContent).toContain('“retired” is no longer configured for this server')
    const picker = screen.getByLabelText('Sign-in profile') as HTMLSelectElement
    expect(picker.value).toBe('')
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
    save()
    expect(useConnectionStore.getState().getCredentialsForUrl('https://server.example/v1'))
      .toEqual({ type: 'oauth', profile: 'retired' })

    fireEvent.change(picker, { target: { value: 'partner' } })
    expect(saveButton.disabled).toBe(false)
    save()
    expect(useConnectionStore.getState().getCredentialsForUrl('https://server.example/v1'))
      .toEqual({ type: 'oauth', profile: 'partner' })
  })

  it('lists each server once, configured first, and marks only the current one despite a trailing slash', () => {
    useConnectionStore.setState({
      serverUrl: 'https://server.example/',
      recentUrls: ['https://server.example/', 'https://api.i3x.dev/v1', 'https://other.example'],
    })
    render(<ConnectionDialog />)

    const entries = screen.getAllByRole('button', { name: /^https:\/\// })
    expect(entries.map(entry => entry.title)).toEqual(['https://api.i3x.dev/v1', 'https://server.example', 'https://other.example'])
    expect(entries[0].textContent).toContain('i3X demo server')
    expect(entries[1].textContent).toContain('Company account, Partner account')
    expect(entries.map(entry => entry.getAttribute('aria-current'))).toEqual([null, 'true', null])
  })

  it('saves and connects in one click when disconnected, opening the sign-in window within it', () => {
    const popup = { closed: false, close: vi.fn(), location: { href: 'about:blank' }, document: { title: '', body: { textContent: '' } } }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1', isConnected: false, showConnectionDialog: true })
    render(<ConnectionDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Save & Connect' }))

    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toBe('about:blank')
    expect(useConnectionStore.getState().showConnectionDialog).toBe(false)
  })

  it('removes a recent server and forgets its saved credentials', () => {
    useConnectionStore.setState({
      serverUrl: 'https://server.example/v1',
      recentUrls: ['https://other.example'],
      savedCredentials: { 'https://other.example': { type: 'bearer', token: 't' } },
    })
    render(<ConnectionDialog />)

    expect(screen.getByRole('button', { name: /^https:\/\/other\.example/ }).textContent).toContain('Bearer token')
    fireEvent.click(screen.getByRole('button', { name: 'Remove https://other.example from recent connections' }))

    expect(useConnectionStore.getState().recentUrls).toEqual([])
    expect(useConnectionStore.getState().getCredentialsForUrl('https://other.example')).toBeNull()
    expect(screen.queryByRole('button', { name: /^https:\/\/other\.example/ })).toBeNull()
  })

  it('explains a URL without a scheme and will not save it', () => {
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1' })
    render(<ConnectionDialog />)

    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'server.example' } })

    expect(screen.getByText('Enter a full URL starting with http:// or https://.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Save & Connect' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes on Escape without saving', () => {
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1', showConnectionDialog: true })
    render(<ConnectionDialog />)

    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://elsewhere.example' } })
    fireEvent.keyDown(screen.getByLabelText('Server URL'), { key: 'Escape' })

    expect(useConnectionStore.getState().showConnectionDialog).toBe(false)
    expect(useConnectionStore.getState().serverUrl).toBe('https://server.example/v1')
  })

  it('says a sign-in will be asked for when there is no session yet', () => {
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1' })
    render(<ConnectionDialog />)

    expect(screen.getByText('You will be asked to sign in when you connect.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('opens the sign-in window during the Save click, before any await, when saving starts a sign-in', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1', isConnected: true })
    render(<ConnectionDialog />)

    save()

    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toBe('about:blank')
  })

  it('opens no window when saving does not reconnect', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1', isConnected: false })
    render(<ConnectionDialog />)

    save()

    expect(open).not.toHaveBeenCalled()
  })
})
