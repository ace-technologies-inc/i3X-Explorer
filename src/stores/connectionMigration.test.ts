// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { connectionKey, useConnectionStore } from './connection'

afterEach(() => localStorage.clear())

async function rehydrateFrom(state: Record<string, unknown>, version: number) {
  localStorage.setItem('i3x-connection', JSON.stringify({ state, version }))
  await useConnectionStore.persist.rehydrate()
  return useConnectionStore.getState()
}

describe('connection store migrations', () => {
  it('drops the recent servers earlier versions seeded, keeping the ones the person chose', async () => {
    const state = await rehydrateFrom({
      serverUrl: 'https://plant.example.com',
      recentUrls: ['https://plant.example.com', 'https://api.i3x.dev/v1', 'http://localhost:8080'],
      savedCredentials: {},
    }, 1)

    expect(state.recentConnections).toEqual([{ url: 'https://plant.example.com', auth: 'none' }])
  })

  it('keeps a seeded server the person is connected to or saved credentials for', async () => {
    const state = await rehydrateFrom({
      serverUrl: 'https://api.i3x.dev/v1',
      recentUrls: ['https://api.i3x.dev/v1', 'http://localhost:8080'],
      savedCredentials: { 'http://localhost:8080': { type: 'bearer', token: 't' } },
    }, 1)

    expect(state.recentConnections).toEqual([
      { url: 'https://api.i3x.dev/v1', auth: 'none' },
      { url: 'http://localhost:8080', auth: 'bearer' },
    ])
  })

  it('keys a v2 state by URL and method: credentials, recent entries, and the current server\'s method', async () => {
    const header = { type: 'header', headerName: 'X-API-Key', headerValue: 'k' }
    const state = await rehydrateFrom({
      serverUrl: 'https://plant.example.com/',
      recentUrls: ['https://plant.example.com/', 'https://plant.example.com', 'http://localhost:8080'],
      savedCredentials: { 'https://plant.example.com/': header },
    }, 2)

    expect(state.recentConnections).toEqual([
      { url: 'https://plant.example.com', auth: 'header' },
      { url: 'https://plant.example.com', auth: 'none' },
      { url: 'http://localhost:8080', auth: 'none' },
    ])
    expect(state.serverAuth).toBe('header')
    expect(state.getCredentials('https://plant.example.com', 'header')).toEqual(header)
    expect(state.savedCredentials).toEqual({ [connectionKey('https://plant.example.com', 'header')]: header })
  })

  it('keeps the current server\'s credentials when two URLs normalize to one, in either order', async () => {
    const active = { type: 'bearer', token: 'active' }
    const obsolete = { type: 'bearer', token: 'obsolete' }
    for (const savedCredentials of [
      { 'https://plant.example/v1': active, 'https://plant.example/v1/': obsolete },
      { 'https://plant.example/v1/': obsolete, 'https://plant.example/v1': active },
    ]) {
      const state = await rehydrateFrom({ serverUrl: 'https://plant.example/v1', recentUrls: [], savedCredentials }, 2)

      expect(state.getCredentials('https://plant.example/v1', 'bearer')).toEqual(active)
    }
  })

  it('leaves a v3 state alone', async () => {
    const state = await rehydrateFrom({ recentConnections: [{ url: 'http://localhost:8080', auth: 'none' }], savedCredentials: {} }, 3)

    expect(state.recentConnections).toEqual([{ url: 'http://localhost:8080', auth: 'none' }])
  })
})
