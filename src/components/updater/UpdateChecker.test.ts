import { describe, expect, it } from 'vitest'
import { isNewerVersion, pickUpdate } from './UpdateChecker'

describe('isNewerVersion', () => {
  it('compares plain semver tags', () => {
    expect(isNewerVersion('1.0.0', 'v1.0.1')).toBe(true)
    expect(isNewerVersion('1.0.0', 'v1.1.0')).toBe(true)
    expect(isNewerVersion('1.2.0', 'v1.1.9')).toBe(false)
    expect(isNewerVersion('2.0.0', 'v1.9.9')).toBe(false)
  })

  it('is false for an equal version', () => {
    expect(isNewerVersion('1.0.0', 'v1.0.0')).toBe(false)
    expect(isNewerVersion('1.2.3-4', 'v1.2.3-4')).toBe(false)
  })

  it('treats a two-part tag as patch 0', () => {
    expect(isNewerVersion('1.0.0', 'v1.1')).toBe(true)
    expect(isNewerVersion('1.1.0', 'v1.1')).toBe(false)
  })

  it('a #.#.#-# build takes any higher version, suffixed or plain', () => {
    expect(isNewerVersion('1.2.3-4', 'v1.2.3-5')).toBe(true)
    expect(isNewerVersion('1.2.3-4', 'v1.2.4')).toBe(true)
    expect(isNewerVersion('1.2.3-4', 'v1.3.0-0')).toBe(true)
    expect(isNewerVersion('1.2.3-4', 'v1.2.3-3')).toBe(false)
    expect(isNewerVersion('1.2.3-4', 'v1.2.3')).toBe(false)
    expect(isNewerVersion('1.2.3-0', 'v1.2.3')).toBe(false)
    expect(isNewerVersion('1.2.3-10', 'v1.2.3-9')).toBe(false)
  })

  it('a #.#.# build ignores every suffixed tag', () => {
    expect(isNewerVersion('1.2.3', 'v1.2.3-1')).toBe(false)
    expect(isNewerVersion('1.2.3', 'v1.2.4-1')).toBe(false)
    expect(isNewerVersion('1.2.3', 'v2.0.0-0')).toBe(false)
    expect(isNewerVersion('1.2.3', 'v1.2.4')).toBe(true)
  })
})

describe('pickUpdate', () => {
  const rel = (tag_name: string, extra = {}) => ({ tag_name, ...extra })

  it('a plain build skips a newer suffixed release for the plain one below it', () => {
    expect(pickUpdate('1.2.3', [rel('v1.3.0-1'), rel('v1.2.4'), rel('v1.2.3')])).toBe('v1.2.4')
  })

  it('a suffixed build picks the highest of either shape', () => {
    expect(pickUpdate('1.2.3-4', [rel('v1.2.4'), rel('v1.2.4-2'), rel('v1.2.3-5')])).toBe('v1.2.4-2')
  })

  it('skips drafts and prereleases', () => {
    expect(pickUpdate('1.2.3', [rel('v9.0.0', { draft: true }), rel('v8.0.0', { prerelease: true })])).toBeNull()
  })

  it('is null when nothing is newer', () => {
    expect(pickUpdate('1.2.3-4', [rel('v1.2.3-4'), rel('v1.2.3')])).toBeNull()
  })
})
