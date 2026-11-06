import { describe, expect, it } from 'vitest'
import { configuredServers, oauthProfilesFor, parseRuntimeConfig, profileServerUrls } from './runtimeConfig'

const issuer = 'https://login.example.com/tenant/v2.0'

const corpEnv = {
  I3X_OAUTH_CORP_LABEL: 'Company account',
  I3X_OAUTH_CORP_ISSUER: issuer,
  I3X_OAUTH_CORP_CLIENT_ID: 'explorer-app',
  I3X_OAUTH_CORP_SCOPES: 'openid profile api://i3x/read',
  I3X_OAUTH_CORP_APPLIES_TO: 'https://i3x.example.com/v1, https://i3x-qa.example.com',
  I3X_OAUTH_CORP_EXTRA_PARAMS: 'domain_hint=example.com&prompt=select_account',
}

const complete = {
  issuer,
  clientId: 'explorer-app',
  scopes: 'openid profile api://i3x/read',
  appliesTo: 'https://i3x.example.com/v1, https://i3x-qa.example.com',
}

const profilesOf = (raw: unknown) => parseRuntimeConfig(raw).config.oauthProfiles
const warningsOf = (raw: unknown) => parseRuntimeConfig(raw).warnings

describe('parseRuntimeConfig: profiles from the environment', () => {
  it('reads I3X_OAUTH_<NAME>_<FIELD> variables as a named profile, lists split on spaces or commas', () => {
    const { config, warnings } = parseRuntimeConfig({ env: corpEnv })

    expect(warnings).toEqual([])
    expect(config.oauthProfiles).toEqual([{
      name: 'corp',
      label: 'Company account',
      issuer,
      clientId: 'explorer-app',
      scopes: ['openid', 'profile', 'api://i3x/read'],
      resource: undefined,
      extraParams: { domain_hint: 'example.com', prompt: 'select_account' },
      redirectUri: undefined,
      appliesTo: ['https://i3x.example.com/v1', 'https://i3x-qa.example.com'],
      servers: ['https://i3x.example.com/v1', 'https://i3x-qa.example.com'],
    }])
  })

  it('reads unnamed I3X_OAUTH_<FIELD> variables as the "default" profile, without mistaking CLIENT_ID for a profile', () => {
    const profiles = profilesOf({
      env: {
        I3X_OAUTH_ISSUER: issuer,
        I3X_OAUTH_CLIENT_ID: 'app',
        I3X_OAUTH_SCOPES: 'openid',
        I3X_OAUTH_APPLIES_TO: 'https://i3x.example.com',
        I3X_OAUTH_REDIRECT_URI: 'https://explorer.example.com/explorer/oauth/callback.html',
      },
    })
    expect(profiles.map(profile => [profile.name, profile.clientId, profile.redirectUri])).toEqual([
      ['default', 'app', 'https://explorer.example.com/explorer/oauth/callback.html'],
    ])
  })

  it('reads LOOPBACK_REDIRECT_URI as the desktop callback, and drops a profile whose value is not a loopback http URL', () => {
    const { config, warnings } = parseRuntimeConfig({
      env: {
        ...corpEnv,
        I3X_OAUTH_CORP_LOOPBACK_REDIRECT_URI: 'http://127.0.0.1/callback',
        I3X_OAUTH_BAD_ISSUER: issuer,
        I3X_OAUTH_BAD_CLIENT_ID: 'app',
        I3X_OAUTH_BAD_SCOPES: 'openid',
        I3X_OAUTH_BAD_APPLIES_TO: 'https://i3x.example.com',
        I3X_OAUTH_BAD_LOOPBACK_REDIRECT_URI: 'http://example.com/callback',
      },
    })
    expect(config.oauthProfiles.map(profile => [profile.name, profile.loopbackRedirectUri])).toEqual([['corp', 'http://127.0.0.1/callback']])
    expect(warnings).toEqual([
      'OAuth profile "bad" was ignored: loopbackRedirectUri must be http://localhost, http://127.0.0.1 or http://[::1], with an optional port and path.',
    ])
  })

  it('reads unnamed I3X_OAUTH_LOOPBACK_REDIRECT_URI as the default profile\'s field, not REDIRECT_URI of a profile "loopback"', () => {
    const { config, warnings } = parseRuntimeConfig({
      env: {
        I3X_OAUTH_ISSUER: issuer,
        I3X_OAUTH_CLIENT_ID: 'app',
        I3X_OAUTH_SCOPES: 'openid',
        I3X_OAUTH_APPLIES_TO: 'https://i3x.example.com',
        I3X_OAUTH_LOOPBACK_REDIRECT_URI: 'http://127.0.0.1/callback',
      },
    })
    expect(warnings).toEqual([])
    expect(config.oauthProfiles.map(profile => [profile.name, profile.loopbackRedirectUri, profile.redirectUri]))
      .toEqual([['default', 'http://127.0.0.1/callback', undefined]])
  })

  it('keeps several profiles apart, in name order', () => {
    const profiles = profilesOf({
      env: {
        ...corpEnv,
        I3X_OAUTH_PARTNER_ISSUER: 'https://idp.partner.example',
        I3X_OAUTH_PARTNER_CLIENT_ID: 'partner-app',
        I3X_OAUTH_PARTNER_SCOPES: 'openid read',
        I3X_OAUTH_PARTNER_APPLIES_TO: 'https://i3x.example.com',
      },
    })
    expect(profiles.map(profile => [profile.name, profile.clientId])).toEqual([
      ['corp', 'explorer-app'],
      ['partner', 'partner-app'],
    ])
  })

  it('warns about an I3X_OAUTH_ variable it does not recognize, such as a misspelt field', () => {
    expect(warningsOf({ env: { ...corpEnv, I3X_OAUTH_CORP_CLIENTID: 'x', I3X_OAUTH_my_ISSUER: issuer } })).toEqual([
      'Environment variable I3X_OAUTH_CORP_CLIENTID is not a recognized I3X_OAUTH_ setting and was ignored.',
      'Environment variable I3X_OAUTH_my_ISSUER is not a recognized I3X_OAUTH_ setting and was ignored.',
    ])
  })

  it('ignores variables outside I3X_OAUTH_ and empty values, so an unconfigured container yields nothing', () => {
    const { config, warnings } = parseRuntimeConfig({ env: { PATH: '/usr/bin', I3X_OAUTH_ISSUER: '', I3X_OAUTH_CLIENT_ID: ' ' } })
    expect(config.oauthProfiles).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('parseRuntimeConfig: profiles from a config file', () => {
  it('reads oauthProfiles keyed by name, with JSON lists and parameters', () => {
    const profiles = profilesOf({
      oauthProfiles: {
        CORP: { ...complete, scopes: ['openid', 'api://i3x/read'], appliesTo: ['https://i3x.example.com/'], extraParams: { prompt: 'login' } },
      },
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      name: 'corp',
      scopes: ['openid', 'api://i3x/read'],
      appliesTo: ['https://i3x.example.com'],
      extraParams: { prompt: 'login' },
    })
  })

  it('lets an environment variable override one field of the file profile of the same name', () => {
    const profiles = profilesOf({
      oauthProfiles: { corp: { ...complete, label: 'From file' } },
      env: { I3X_OAUTH_CORP_CLIENT_ID: 'from-env' },
    })
    expect(profiles[0]).toMatchObject({ name: 'corp', label: 'From file', clientId: 'from-env', issuer })
  })

  it('refuses a profile name that is not letters and digits, since it could not round-trip through a variable name', () => {
    const { config, warnings } = parseRuntimeConfig({ oauthProfiles: { 'my-idp': complete } })
    expect(config.oauthProfiles).toEqual([])
    expect(warnings).toEqual(['OAuth profile name "my-idp" may only use letters and digits; the profile was ignored.'])
  })

  it('keeps reading serverUrl and recentUrls from the file', () => {
    expect(parseRuntimeConfig({ serverUrl: 'https://i3x.example.com/v1', recentUrls: ['https://a.example.com'] }).config).toEqual({
      serverUrl: 'https://i3x.example.com/v1',
      recentUrls: ['https://a.example.com'],
      oauthProfiles: [],
    })
  })

  it('ignores a server URL that is not http(s)', () => {
    const { config, warnings } = parseRuntimeConfig({ serverUrl: 'javascript:alert(1)' })
    expect(config.serverUrl).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it('returns no settings for a body that is not an object', () => {
    expect(parseRuntimeConfig(null)).toEqual({ config: { oauthProfiles: [] }, warnings: [] })
    expect(parseRuntimeConfig(['x'])).toEqual({ config: { oauthProfiles: [] }, warnings: [] })
  })
})

describe('parseRuntimeConfig: profile validation', () => {
  it('drops a partial profile whole, says what is missing, and keeps the others', () => {
    const { config, warnings } = parseRuntimeConfig({
      env: { ...corpEnv, I3X_OAUTH_BROKEN_ISSUER: issuer },
    })
    expect(config.oauthProfiles.map(profile => profile.name)).toEqual(['corp'])
    expect(warnings).toEqual(['OAuth profile "broken" was ignored: clientId is missing; scopes are missing; appliesTo names no server.'])
  })

  it('requires appliesTo, so a profile can never be sent to an arbitrary server', () => {
    const { config, warnings } = parseRuntimeConfig({ oauthProfiles: { a: { ...complete, appliesTo: '' } } })
    expect(config.oauthProfiles).toEqual([])
    expect(warnings[0]).toContain('appliesTo names no server')
  })

  it.each([
    ['http://login.example.com', 'a plain-http issuer'],
    ['login.example.com', 'an issuer that is not a URL'],
  ])('rejects %s (%s)', badIssuer => {
    const { config, warnings } = parseRuntimeConfig({ oauthProfiles: { a: { ...complete, issuer: badIssuer } } })
    expect(config.oauthProfiles).toEqual([])
    expect(warnings[0]).toContain('issuer must be an https URL')
  })

  it('allows a plain-http issuer on localhost for a local identity provider', () => {
    expect(profilesOf({ oauthProfiles: { a: { ...complete, issuer: 'http://localhost:8180/realms/i3x' } } })[0].issuer)
      .toBe('http://localhost:8180/realms/i3x')
  })

  it('ignores appliesTo entries that are not plain server URLs', () => {
    const { config, warnings } = parseRuntimeConfig({
      oauthProfiles: { a: { ...complete, appliesTo: 'https://ok.example.com https://user:pw@x.example.com https://q.example.com?x=1 ftp://f.example.com' } },
    })
    expect(config.oauthProfiles[0].appliesTo).toEqual(['https://ok.example.com'])
    expect(warnings).toHaveLength(3)
  })

  it('refuses extra parameters that would override the sign-in flow', () => {
    const { config, warnings } = parseRuntimeConfig({
      oauthProfiles: { a: { ...complete, extraParams: 'redirect_uri=https://evil.example.com&Client_Id=x&prompt=login' } },
    })
    expect(config.oauthProfiles[0].extraParams).toEqual({ prompt: 'login' })
    expect(warnings).toEqual([
      'OAuth profile "a": extra parameter "redirect_uri" is set by the sign-in flow and was ignored.',
      'OAuth profile "a": extra parameter "Client_Id" is set by the sign-in flow and was ignored.',
    ])
  })
})

describe('profileServerUrls', () => {
  it('lists the SERVERS a profile names, which may be more specific than its appliesTo', () => {
    const profiles = profilesOf({
      env: {
        ...corpEnv,
        I3X_OAUTH_CORP_APPLIES_TO: 'https://i3x.example.com',
        I3X_OAUTH_CORP_SERVERS: 'https://i3x.example.com/v1/',
      },
    })
    expect(profileServerUrls(profiles)).toEqual(['https://i3x.example.com/v1'])
  })

  it('drops a server outside the profile\'s appliesTo, since the profile would never be offered there', () => {
    const { config, warnings } = parseRuntimeConfig({
      oauthProfiles: { a: { ...complete, appliesTo: 'https://i3x.example.com/v1', servers: 'https://i3x.example.com/v1 https://other.example.com https://i3x.example.com' } },
    })
    expect(config.oauthProfiles[0].servers).toEqual(['https://i3x.example.com/v1'])
    expect(warnings).toEqual([
      'OAuth profile "a": server "https://other.example.com" is not a plain http(s) URL under its appliesTo and was ignored.',
      'OAuth profile "a": server "https://i3x.example.com" is not a plain http(s) URL under its appliesTo and was ignored.',
    ])
  })

  it('falls back to every appliesTo entry, once, in profile order, as normalized server URLs', () => {
    const profiles = profilesOf({
      oauthProfiles: {
        dev: { ...complete, appliesTo: 'https://dev.example.com/ http://localhost:5200' },
        test: { ...complete, appliesTo: 'https://test.example.com/v1 http://localhost:5200/' },
      },
    })
    expect(profileServerUrls(profiles)).toEqual([
      'https://dev.example.com',
      'http://localhost:5200',
      'https://test.example.com/v1',
    ])
  })

  it('lists nothing without profiles', () => {
    expect(profileServerUrls([])).toEqual([])
  })
})

describe('configuredServers', () => {
  it('offers the i3X demo server when the configuration lists no servers', () => {
    expect(configuredServers(parseRuntimeConfig({}).config)).toEqual([
      { url: 'https://api.i3x.dev/v1', label: 'i3X demo server', profiles: [] },
    ])
  })

  it('lists configured servers first, then sign-in profiles\' servers, once each, with the profiles that apply', () => {
    const { config, warnings } = parseRuntimeConfig({
      servers: [{ url: 'https://i3x.example.com/v1/', label: 'Plant' }, 'https://lab.example.com', { url: 'ftp://nope' }],
      oauthProfiles: { company: { ...complete, label: 'Company', appliesTo: 'https://i3x.example.com https://other.example.com' } },
    })

    expect(configuredServers(config).map(server => [server.url, server.label, server.profiles.map(profile => profile.name)])).toEqual([
      ['https://i3x.example.com/v1', 'Plant', ['company']],
      ['https://lab.example.com', undefined, []],
      ['https://i3x.example.com', undefined, ['company']],
      ['https://other.example.com', undefined, ['company']],
    ])
    expect(warnings).toEqual(['Server "ftp://nope" is not a plain http(s) server URL and was ignored.'])
  })

  it('hides the demo server when the configuration lists an empty set', () => {
    expect(configuredServers(parseRuntimeConfig({ servers: [] }).config)).toEqual([])
  })

  it('takes a profile\'s server once even when the server list names it too, keeping the list\'s label', () => {
    const { config } = parseRuntimeConfig({
      servers: [{ url: 'https://i3x.example.com', label: 'Plant' }],
      oauthProfiles: { company: { ...complete, appliesTo: 'https://i3x.example.com/' } },
    })
    expect(configuredServers(config).map(server => [server.url, server.label])).toEqual([['https://i3x.example.com', 'Plant']])
  })
})

describe('oauthProfilesFor', () => {
  const [corp] = profilesOf({ env: corpEnv })

  it.each([
    'https://i3x.example.com/v1',
    'https://i3x.example.com/v1/',
    'https://i3x.example.com/v1/sub',
    'https://i3x-qa.example.com',
    'https://i3x-qa.example.com/v1',
    'https://I3X-QA.example.com:443/v1',
  ])('offers the profile for %s', serverUrl => {
    expect(oauthProfilesFor([corp], serverUrl)).toEqual([corp])
  })

  it.each([
    ['https://i3x.example.com', 'the origin above the allowed path'],
    ['https://i3x.example.com/v10', 'a path that only shares a prefix string'],
    ['http://i3x.example.com/v1', 'another scheme'],
    ['https://i3x.example.com:8443/v1', 'another port'],
    ['https://i3x.example.com.evil.example/v1', 'a host that only ends with an allowed name'],
    ['https://evil.example/i3x.example.com/v1', 'a path naming an allowed host'],
    ['https://i3x.example.com@evil.example/v1', 'credentials hiding another host'],
    ['not a url', 'an unparseable URL'],
  ])('does not offer it for %s (%s)', serverUrl => {
    expect(oauthProfilesFor([corp], serverUrl)).toEqual([])
  })

  it('lists the profile with the most specific appliesTo match first, then by name', () => {
    const profiles = profilesOf({
      oauthProfiles: {
        wide: { ...complete, appliesTo: 'https://i3x.example.com' },
        narrow: { ...complete, appliesTo: 'https://i3x.example.com/v1' },
        alsowide: { ...complete, appliesTo: 'https://i3x.example.com' },
        elsewhere: { ...complete, appliesTo: 'https://other.example.com' },
      },
    })
    expect(oauthProfilesFor(profiles, 'https://i3x.example.com/v1').map(profile => profile.name))
      .toEqual(['narrow', 'alsowide', 'wide'])
  })
})
