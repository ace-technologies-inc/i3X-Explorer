// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useConnectionStore } from './connection'

afterEach(() => localStorage.clear())

async function rehydrateFrom(state: Record<string, unknown>, version: number) {
  localStorage.setItem('i3x-connection', JSON.stringify({ state, version }))
  await useConnectionStore.persist.rehydrate()
  return useConnectionStore.getState()
}

describe('connection store migration to v2', () => {
  it('drops the recent servers earlier versions seeded, keeping the ones the person chose', async () => {
    const state = await rehydrateFrom({
      serverUrl: 'https://plant.example.com',
      recentUrls: ['https://plant.example.com', 'https://api.i3x.dev/v1', 'http://localhost:8080'],
      savedCredentials: {},
    }, 1)

    expect(state.recentUrls).toEqual(['https://plant.example.com'])
  })

  it('keeps a seeded server the person is connected to or saved credentials for', async () => {
    const state = await rehydrateFrom({
      serverUrl: 'https://api.i3x.dev/v1',
      recentUrls: ['https://api.i3x.dev/v1', 'http://localhost:8080'],
      savedCredentials: { 'http://localhost:8080': { type: 'bearer', token: 't' } },
    }, 1)

    expect(state.recentUrls).toEqual(['https://api.i3x.dev/v1', 'http://localhost:8080'])
  })

  it('leaves a v2 list alone', async () => {
    const state = await rehydrateFrom({ recentUrls: ['http://localhost:8080'], savedCredentials: {} }, 2)

    expect(state.recentUrls).toEqual(['http://localhost:8080'])
  })
})
