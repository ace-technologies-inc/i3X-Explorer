// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizePollIntervalMs, useExplorerStore } from './explorer'

beforeEach(() => {
  localStorage.clear()
  useExplorerStore.getState().setPollIntervalMs(30_000)
  localStorage.clear()
})

afterEach(() => localStorage.clear())

describe('automatic refresh preference', () => {
  it('persists the selected interval in localStorage', () => {
    useExplorerStore.getState().setPollIntervalMs(60_000)

    expect(localStorage.getItem('i3x-poll-interval-ms')).toBe('60000')
  })

  it('rejects stored values that are not represented by a settings option', () => {
    expect(normalizePollIntervalMs('1')).toBe(30_000)
    expect(normalizePollIntervalMs('')).toBe(30_000)
    expect(normalizePollIntervalMs('60000')).toBe(60_000)
    expect(normalizePollIntervalMs('0')).toBe(0)
  })
})