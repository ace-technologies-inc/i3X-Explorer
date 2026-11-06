// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConnectionDialog } from './ConnectionDialog'
import { connectionKey, useConnectionStore } from '../../stores/connection'
import { getRuntimeConfig, loadRuntimeConfig, SITE_CONFIG_URL } from '../../config/runtimeConfig'
import { releaseSignInWindow } from '../../auth/popupSignIn'
import { openOAuthSession, signOutOAuth } from '../../auth/oauthSession'

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
    if (String(input) === SITE_CONFIG_URL) {
      return new Response(JSON.stringify({ env: profileEnv }), { headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`offline: ${String(input)}`)
  }))
  await loadRuntimeConfig()
}

beforeEach(async () => {
  localStorage.clear()
  useConnectionStore.setState({
    savedCredentials: {}, recentConnections: [], serverAuth: null, credentials: null, isConnected: false, isConnecting: false, error: null,
  })
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

    expect(useConnectionStore.getState().getCredentials('https://server.example/v1', 'oauth'))
      .toEqual({ type: 'oauth', profile: 'company' })
  })

  it('saves the profile picked in the list', () => {
    useConnectionStore.setState({ serverUrl: 'https://server.example/v1' })
    render(<ConnectionDialog />)

    fireEvent.change(screen.getByLabelText('Sign-in profile'), { target: { value: 'partner' } })
    save()

    expect(useConnectionStore.getState().getCredentials('https://server.example/v1', 'oauth'))
      .toEqual({ type: 'oauth', profile: 'partner' })
  })

  it('keeps a saved profile that is no longer configured unresolved until another is chosen', () => {
    useConnectionStore.setState({
      serverUrl: 'https://server.example/v1',
      serverAuth: 'oauth',
      savedCredentials: { [connectionKey('https://server.example/v1', 'oauth')]: { type: 'oauth', profile: 'retired' } },
    })
    render(<ConnectionDialog />)

    expect(screen.getByRole('alert').textContent).toContain('“retired” is no longer configured for this server')
    const picker = screen.getByLabelText('Sign-in profile') as HTMLSelectElement
    expect(picker.value).toBe('')
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
    save()
    expect(useConnectionStore.getState().getCredentials('https://server.example/v1', 'oauth'))
      .toEqual({ type: 'oauth', profile: 'retired' })

    fireEvent.change(picker, { target: { value: 'partner' } })
    expect(saveButton.disabled).toBe(false)
    save()
    expect(useConnectionStore.getState().getCredentials('https://server.example/v1', 'oauth'))
      .toEqual({ type: 'oauth', profile: 'partner' })
  })

  it('lists each server once, configured first, and marks only the current one despite a trailing slash', () => {
    useConnectionStore.setState({
      serverUrl: 'https://server.example/',
      recentConnections: [
        { url: 'https://server.example', auth: 'oauth' },
        { url: 'https://api.i3x.dev/v1', auth: 'none' },
        { url: 'https://other.example', auth: 'none' },
      ],
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

  it('removes a recent connection and forgets its saved credentials', () => {
    useConnectionStore.setState({
      serverUrl: 'https://server.example/v1',
      recentConnections: [{ url: 'https://other.example', auth: 'bearer' }],
      savedCredentials: { [connectionKey('https://other.example', 'bearer')]: { type: 'bearer', token: 't' } },
    })
    render(<ConnectionDialog />)

    expect(screen.getByRole('button', { name: /^https:\/\/other\.example/ }).textContent).toContain('Bearer token')
    fireEvent.click(screen.getByRole('button', { name: 'Remove https://other.example (Bearer token) from recent connections' }))

    expect(useConnectionStore.getState().recentConnections).toEqual([])
    expect(useConnectionStore.getState().getCredentials('https://other.example', 'bearer')).toBeNull()
    expect(screen.queryByRole('button', { name: /^https:\/\/other\.example/ })).toBeNull()
  })

  it('keeps a configured server\'s sign-in and an API key used with it as two connections', () => {
    const header = { type: 'header' as const, headerName: 'X-API-Key', headerValue: 'key-1' }
    useConnectionStore.setState({
      serverUrl: 'https://server.example',
      serverAuth: 'oauth',
      recentConnections: [{ url: 'https://server.example', auth: 'header' }, { url: 'https://server.example', auth: 'oauth' }],
      savedCredentials: {
        [connectionKey('https://server.example', 'header')]: header,
        [connectionKey('https://server.example', 'oauth')]: { type: 'oauth', profile: 'partner' },
      },
    })
    render(<ConnectionDialog />)

    const rows = screen.getAllByRole('button', { name: /^https:\/\/server\.example/ })
    expect(rows.map(row => row.textContent)).toEqual([
      'https://server.exampleCompany account, Partner account',
      'https://server.exampleCustom header',
    ])
    expect(rows.map(row => row.getAttribute('aria-current'))).toEqual(['true', null])
    expect((screen.getByLabelText('Sign-in profile') as HTMLSelectElement).value).toBe('partner')

    fireEvent.click(rows[1])
    expect((screen.getByLabelText('Authentication') as HTMLSelectElement).value).toBe('header')
    expect((screen.getByLabelText('Header Value') as HTMLInputElement).value).toBe('key-1')
    expect(rows.map(row => row.getAttribute('aria-current'))).toEqual([null, 'true'])

    fireEvent.change(screen.getByLabelText('Header Value'), { target: { value: 'key-2' } })
    save()

    const state = useConnectionStore.getState()
    expect(state.serverAuth).toBe('header')
    expect(state.getCredentials('https://server.example', 'header')).toEqual({ ...header, headerValue: 'key-2' })
    expect(state.getCredentials('https://server.example', 'oauth')).toEqual({ type: 'oauth', profile: 'partner' })
  })

  it('loads what was saved for a method when the method is switched back to', () => {
    useConnectionStore.setState({
      serverUrl: 'https://other.example',
      serverAuth: 'none',
      savedCredentials: { [connectionKey('https://other.example', 'bearer')]: { type: 'bearer', token: 'saved-token' } },
    })
    render(<ConnectionDialog />)

    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'bearer' } })

    expect((screen.getByLabelText('Token') as HTMLInputElement).value).toBe('saved-token')
  })

  it('keeps each method\'s draft when switching to a method with saved credentials and back', () => {
    useConnectionStore.setState({
      serverUrl: 'https://other.example',
      serverAuth: 'none',
      savedCredentials: {
        [connectionKey('https://other.example', 'bearer')]: { type: 'bearer', token: 'saved-token' },
        [connectionKey('https://other.example', 'basic')]: { type: 'basic', username: 'saved-user', password: 'saved-pass' },
      },
    })
    render(<ConnectionDialog />)
    const method = screen.getByLabelText('Authentication')

    fireEvent.change(method, { target: { value: 'basic' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'typed-user' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-pass' } })
    fireEvent.change(method, { target: { value: 'bearer' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'typed-token' } })
    fireEvent.change(method, { target: { value: 'basic' } })

    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('typed-user')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('typed-pass')
    fireEvent.change(method, { target: { value: 'bearer' } })
    expect((screen.getByLabelText('Token') as HTMLInputElement).value).toBe('typed-token')
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

  it('names the signed-in account for every server that shares the session, not only the connected one', async () => {
    const company = getRuntimeConfig().oauthProfiles.find(profile => profile.name === 'company')!
    const transport = {
      prepareSignIn: vi.fn(),
      releaseSignIn: vi.fn(),
      signIn: vi.fn(async () => ({ accessToken: 'at', accountName: 'Pat Doe' })),
      refresh: vi.fn(),
      signOut: vi.fn(async () => ({ revoked: false, endedSession: false })),
      cancel: vi.fn(),
    }
    await openOAuthSession(company, transport)
    try {
      useConnectionStore.setState({
        serverUrl: 'https://server.example/v1',
        isConnected: true,
        credentials: { type: 'oauth', profile: 'company' },
      })
      render(<ConnectionDialog />)
      expect(screen.getByText('Signed in as Pat Doe')).toBeTruthy()

      fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://server.example/other' } })

      expect(screen.getByText('Signed in as Pat Doe')).toBeTruthy()
    } finally {
      await signOutOAuth(company, {}, transport)
    }
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
