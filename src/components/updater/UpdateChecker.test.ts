import { describe, expect, it } from 'vitest'
import { isNewerVersion } from './UpdateChecker'

describe('isNewerVersion', () => {
  it('compares plain semver tags', () => {
    expect(isNewerVersion('1.0.0', 'v1.0.1')).toBe(true)
    expect(isNewerVersion('1.0.0', 'v1.1.0')).toBe(true)
    expect(isNewerVersion('1.2.0', 'v1.1.9')).toBe(false)
    expect(isNewerVersion('2.0.0', 'v1.9.9')).toBe(false)
  })

  it('is false for an equal version', () => {
    expect(isNewerVersion('1.0.0', 'v1.0.0')).toBe(false)
  })

  it('treats a two-part tag as patch 0 (previously NaN → never offered)', () => {
    expect(isNewerVersion('1.0.0', 'v1.1')).toBe(true)
    expect(isNewerVersion('1.1.0', 'v1.1')).toBe(false)
  })

  it('strips prerelease suffixes instead of NaN-comparing them', () => {
    expect(isNewerVersion('1.0.0', 'v1.1.0-rc1')).toBe(true)
    expect(isNewerVersion('1.1.0', 'v1.1.0-rc1')).toBe(false)
  })
})
