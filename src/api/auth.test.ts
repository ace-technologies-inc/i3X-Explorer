import { describe, expect, it } from 'vitest'
import { buildAuthHeaders } from './auth'

describe('buildAuthHeaders', () => {
  it('returns {} for missing credentials', () => {
    expect(buildAuthHeaders(null)).toEqual({})
    expect(buildAuthHeaders(undefined)).toEqual({})
  })

  it('builds a bearer header', () => {
    expect(buildAuthHeaders({ type: 'bearer', token: 'tok' })).toEqual({
      Authorization: 'Bearer tok',
    })
  })

  it('base64-encodes basic credentials (ASCII unchanged from plain btoa)', () => {
    expect(buildAuthHeaders({ type: 'basic', username: 'user', password: 'pass' })).toEqual({
      Authorization: `Basic ${btoa('user:pass')}`,
    })
  })

  it('does not throw on non-Latin-1 passwords and encodes them as UTF-8', () => {
    const headers = buildAuthHeaders({ type: 'basic', username: 'ü', password: 'п€😀' })
    const encoded = headers.Authorization.replace(/^Basic /, '')
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
    )
    expect(decoded).toBe('ü:п€😀')
  })

  it('builds a custom header and trims the name', () => {
    expect(
      buildAuthHeaders({ type: 'header', headerName: ' X-API-Key ', headerValue: 'secret' })
    ).toEqual({ 'X-API-Key': 'secret' })
  })

  it('returns {} for blank custom header name or value', () => {
    expect(buildAuthHeaders({ type: 'header', headerName: '  ', headerValue: 'v' })).toEqual({})
    expect(buildAuthHeaders({ type: 'header', headerName: 'X', headerValue: '' })).toEqual({})
  })
})
