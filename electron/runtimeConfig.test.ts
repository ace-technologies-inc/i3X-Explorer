import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_CONFIG_FILE, mergeRuntimeConfig, oauthEnvironment, readRuntimeConfigFile } from './runtimeConfig'

describe('oauthEnvironment', () => {
  it('passes through the non-empty I3X_OAUTH_ variables that name a profile field', () => {
    expect(oauthEnvironment({
      I3X_OAUTH_CORP_CLIENT_ID: 'app',
      I3X_OAUTH_ISSUER: 'https://login.example.com',
      I3X_OAUTH_CORP_SERVERS: 'https://i3x.example.com/v1',
      I3X_OAUTH_SCOPES: '  ',
      I3X_SERVER_URL: 'https://i3x.example.com',
      PATH: '/usr/bin',
    }, () => undefined)).toEqual({
      I3X_OAUTH_CORP_CLIENT_ID: 'app',
      I3X_OAUTH_ISSUER: 'https://login.example.com',
      I3X_OAUTH_CORP_SERVERS: 'https://i3x.example.com/v1',
    })
  })

  it('never passes on a variable that is not a profile field, such as a secret, and names it without its value', () => {
    const warn = vi.fn()
    const picked = oauthEnvironment({
      I3X_OAUTH_CORP_CLIENT_SECRET: 'do-not-publish',
      I3X_OAUTH_CORP_CLIENTID: 'misspelt',
      I3X_OAUTH_CORP_CLIENT_ID: 'app',
    }, warn)

    expect(picked).toEqual({ I3X_OAUTH_CORP_CLIENT_ID: 'app' })
    expect(warn.mock.calls.map(call => call[0])).toEqual([
      '[config] I3X_OAUTH_CORP_CLIENT_SECRET is not an OAuth profile field and was not passed on.',
      '[config] I3X_OAUTH_CORP_CLIENTID is not an OAuth profile field and was not passed on.',
    ])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('do-not-publish')
  })
})

describe('mergeRuntimeConfig', () => {
  it('keeps the file settings and adds the environment for the renderer to merge into its profiles', () => {
    const file = { oauthProfiles: { corp: { clientId: 'file-app' } } }
    expect(mergeRuntimeConfig(file, { I3X_OAUTH_CORP_CLIENT_ID: 'env-app' })).toEqual({
      oauthProfiles: { corp: { clientId: 'file-app' } },
      env: { I3X_OAUTH_CORP_CLIENT_ID: 'env-app' },
    })
  })

  it('never passes on an env block the file itself carried', () => {
    expect(mergeRuntimeConfig({ env: { I3X_OAUTH_CLIENT_ID: 'from-file' } }, {})).toEqual({})
  })

  it('returns {} for a file that is not an object and an empty environment', () => {
    expect(mergeRuntimeConfig(['not an object'], {})).toEqual({})
  })
})

describe('readRuntimeConfigFile', () => {
  const dirs: string[] = []
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i3x-config-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('reads the first directory that has the file', () => {
    const empty = tempDir()
    const admin = tempDir()
    const user = tempDir()
    fs.writeFileSync(path.join(admin, RUNTIME_CONFIG_FILE), '{"serverUrl":"https://admin.example.com"}')
    fs.writeFileSync(path.join(user, RUNTIME_CONFIG_FILE), '{"serverUrl":"https://user.example.com"}')

    expect(readRuntimeConfigFile([empty, admin, user])).toEqual({ serverUrl: 'https://admin.example.com' })
  })

  it('skips a malformed file with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = tempDir()
    const good = tempDir()
    fs.writeFileSync(path.join(broken, RUNTIME_CONFIG_FILE), '{ not json')
    fs.writeFileSync(path.join(good, RUNTIME_CONFIG_FILE), '{"serverUrl":"https://good.example.com"}')

    expect(readRuntimeConfigFile([broken, good])).toEqual({ serverUrl: 'https://good.example.com' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('returns {} when no directory has the file', () => {
    expect(readRuntimeConfigFile([tempDir()])).toEqual({})
  })
})
