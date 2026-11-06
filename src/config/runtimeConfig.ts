/**
 * Settings an operator supplies when the app starts (config.json, plus I3X_OAUTH_*
 * environment variables passed through by the container, the desktop app or the
 * dev server), so a person can sign in without knowing any OAuth details.
 */

import { loopbackRedirect, RESERVED_AUTH_PARAMS } from '../auth/oauthProtocol'
import { parseOAuthEnvVariable } from './oauthEnv'

export interface OAuthProfile {
  /** Lower-case profile name: `default` for unnamed I3X_OAUTH_<FIELD> variables. */
  name: string
  label?: string
  issuer: string
  clientId: string
  scopes: string[]
  resource?: string
  extraParams: Record<string, string>
  redirectUri?: string
  /** Desktop callback; see OAuthSettings.loopbackRedirectUri. */
  loopbackRedirectUri?: string
  /** Server URLs (origin plus optional path prefix) this profile may be used for. */
  appliesTo: string[]
  /** Server URLs to offer as configured connections; each is covered by `appliesTo`. */
  servers: string[]
}

export interface ServerEntry {
  /** Origin plus optional path, without a trailing slash. */
  url: string
  label?: string
}

export interface RuntimeConfig {
  serverUrl?: string
  recentUrls?: string[]
  /** Servers to offer as configured connections; absent means DEFAULT_SERVERS. */
  servers?: ServerEntry[]
  oauthProfiles: OAuthProfile[]
}

/** Offered when the configuration lists no servers of its own; `"servers": []` hides it. */
export const DEFAULT_SERVERS: ServerEntry[] = [{ url: 'https://api.i3x.dev/v1', label: 'i3X demo server' }]

/** A server offered in the connection dialog, from whichever configuration named it. */
export interface ConfiguredServer {
  url: string
  label?: string
  /** The sign-in profiles that apply to it, most specific first. */
  profiles: OAuthProfile[]
}

export interface ParsedRuntimeConfig {
  config: RuntimeConfig
  warnings: string[]
}

export const DEFAULT_PROFILE = 'default'

const PROFILE_NAME = /^[a-z0-9]+$/i

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** A list given either as an array or as one string split on `separator`. */
function list(value: unknown, separator: RegExp): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(separator) : []
  return items.map(text).filter((item): item is string => item !== undefined)
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function httpUrl(value: string): URL | null {
  const url = parseUrl(value)
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url : null
}

/** Origin plus path without a trailing slash; null for anything that is not a plain server URL. */
function serverPrefix(value: string): string | null {
  const url = httpUrl(value)
  if (!url || url.username || url.password || url.search || url.hash) return null
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parseExtraParams(name: string, value: unknown, warnings: string[]): Record<string, string> {
  let entries: [string, string][] = []
  if (typeof value === 'string') {
    entries = [...new URLSearchParams(value.trim().replace(/^\?/, '')).entries()]
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  }
  const params: Record<string, string> = {}
  for (const [key, paramValue] of entries) {
    if (RESERVED_AUTH_PARAMS.has(key.toLowerCase())) {
      warnings.push(`OAuth profile "${name}": extra parameter "${key}" is set by the sign-in flow and was ignored.`)
    } else if (key) {
      params[key] = paramValue
    }
  }
  return params
}

function parseProfile(name: string, source: Record<string, unknown>, warnings: string[]): OAuthProfile | undefined {
  const issuer = text(source.issuer)
  const clientId = text(source.clientId)
  const scopes = list(source.scopes, /[\s,]+/)
  const appliesToRaw = list(source.appliesTo, /[\s,]+/)
  const resource = text(source.resource)
  const redirectUri = text(source.redirectUri)
  const loopbackRedirectUri = text(source.loopbackRedirectUri)

  const anySet = issuer || clientId || scopes.length || appliesToRaw.length || resource || redirectUri
    || loopbackRedirectUri || text(source.label) || text(source.extraParams)
  if (!anySet) return undefined

  const problems: string[] = []
  if (!issuer) {
    problems.push('issuer is missing')
  } else {
    const url = httpUrl(issuer)
    if (!url || (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname))) {
      problems.push('issuer must be an https URL (http only for localhost)')
    }
  }
  if (!clientId) problems.push('clientId is missing')
  if (scopes.length === 0) problems.push('scopes are missing')

  const appliesTo: string[] = []
  for (const entry of appliesToRaw) {
    const prefix = serverPrefix(entry)
    if (prefix) appliesTo.push(prefix)
    else warnings.push(`OAuth profile "${name}": appliesTo entry "${entry}" is not a plain http(s) server URL and was ignored.`)
  }
  if (appliesTo.length === 0) problems.push('appliesTo names no server')

  if (resource && !parseUrl(resource)) problems.push('resource must be an absolute URI')
  if (redirectUri && !httpUrl(redirectUri)) problems.push('redirectUri must be an http(s) URL')
  if (loopbackRedirectUri) {
    try {
      loopbackRedirect({ loopbackRedirectUri })
    } catch {
      problems.push('loopbackRedirectUri must be http://localhost, http://127.0.0.1 or http://[::1], with an optional port and path')
    }
  }

  if (problems.length > 0) {
    warnings.push(`OAuth profile "${name}" was ignored: ${problems.join('; ')}.`)
    return undefined
  }

  const profile: OAuthProfile = {
    name,
    label: text(source.label),
    issuer: issuer!,
    clientId: clientId!,
    scopes,
    resource,
    extraParams: parseExtraParams(name, source.extraParams, warnings),
    redirectUri,
    loopbackRedirectUri,
    appliesTo,
    servers: [],
  }
  const serversRaw = list(source.servers, /[\s,]+/)
  for (const entry of serversRaw) {
    const server = serverPrefix(entry)
    if (server && coverage(profile, new URL(server)) >= 0) profile.servers.push(server)
    else warnings.push(`OAuth profile "${name}": server "${entry}" is not a plain http(s) URL under its appliesTo and was ignored.`)
  }
  // Without SERVERS, the appliesTo entries stand in: they are usually the servers' own URLs.
  if (serversRaw.length === 0) profile.servers = [...appliesTo]
  return profile
}

/** Profile fields from `oauthProfiles` in a config file, then from I3X_OAUTH_* variables, field by field. */
function collectProfiles(source: Record<string, unknown>, warnings: string[]): Map<string, Record<string, unknown>> {
  const profiles = new Map<string, Record<string, unknown>>()
  const fieldsOf = (name: string) => {
    let fields = profiles.get(name)
    if (!fields) profiles.set(name, (fields = {}))
    return fields
  }

  for (const [key, value] of Object.entries(asObject(source.oauthProfiles))) {
    if (PROFILE_NAME.test(key)) Object.assign(fieldsOf(key.toLowerCase()), asObject(value))
    else warnings.push(`OAuth profile name "${key}" may only use letters and digits; the profile was ignored.`)
  }

  for (const [variable, value] of Object.entries(asObject(source.env))) {
    if (!variable.startsWith('I3X_OAUTH_') || typeof value !== 'string' || !value.trim()) continue
    const parsed = parseOAuthEnvVariable(variable)
    if (!parsed) {
      warnings.push(`Environment variable ${variable} is not a recognized I3X_OAUTH_ setting and was ignored.`)
      continue
    }
    fieldsOf(parsed.profile?.toLowerCase() ?? DEFAULT_PROFILE)[parsed.field] = value
  }
  return profiles
}

/** Validates operator-supplied settings; anything invalid is dropped with a warning, never half-applied. */
export function parseRuntimeConfig(raw: unknown): ParsedRuntimeConfig {
  const warnings: string[] = []
  const config: RuntimeConfig = { oauthProfiles: [] }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { config, warnings }
  const source = raw as Record<string, unknown>

  const serverUrl = text(source.serverUrl)
  if (serverUrl) {
    if (httpUrl(serverUrl)) config.serverUrl = serverUrl
    else warnings.push(`Default server URL "${serverUrl}" is not an http(s) URL and was ignored.`)
  }

  const recentUrls = list(source.recentUrls, /[\s,]+/).filter(url => httpUrl(url))
  if (recentUrls.length > 0) config.recentUrls = recentUrls

  if (source.servers !== undefined) {
    config.servers = []
    const entries: unknown[] = Array.isArray(source.servers) ? source.servers : list(source.servers, /[\s,]+/)
    for (const entry of entries) {
      const fields = typeof entry === 'string' ? { url: entry } : asObject(entry)
      const raw = text(fields.url) ?? ''
      const url = serverPrefix(raw)
      const label = text(fields.label)
      if (url) config.servers.push(label ? { url, label } : { url })
      else warnings.push(`Server "${raw}" is not a plain http(s) server URL and was ignored.`)
    }
  }

  const profiles = collectProfiles(source, warnings)
  for (const name of [...profiles.keys()].sort()) {
    const profile = parseProfile(name, profiles.get(name)!, warnings)
    if (profile) config.oauthProfiles.push(profile)
  }

  return { config, warnings }
}

/** Length of the longest `appliesTo` prefix covering `url`, or -1 when none does. */
function coverage(profile: OAuthProfile, url: URL): number {
  const path = url.pathname.replace(/\/+$/, '')
  let best = -1
  for (const prefix of profile.appliesTo) {
    const allowed = new URL(prefix)
    if (allowed.origin !== url.origin) continue
    const allowedPath = allowed.pathname.replace(/\/+$/, '')
    if (allowedPath === '' || path === allowedPath || path.startsWith(`${allowedPath}/`)) {
      best = Math.max(best, prefix.length)
    }
  }
  return best
}

/** The profiles that may be used for `serverUrl`, the most specific `appliesTo` match first, then by name. */
export function oauthProfilesFor(profiles: OAuthProfile[], serverUrl: string): OAuthProfile[] {
  const url = httpUrl(serverUrl.trim())
  if (!url || url.username || url.password) return []
  return profiles
    .map(profile => ({ profile, score: coverage(profile, url) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.profile.name.localeCompare(b.profile.name))
    .map(entry => entry.profile)
}

/** The servers to offer as configured connections, in profile order, without duplicates. */
export function profileServerUrls(profiles: OAuthProfile[]): string[] {
  return [...new Set(profiles.flatMap(profile => profile.servers))]
}

/** Every server the configuration offers, from any source: listed servers first, then sign-in profiles' servers. */
export function configuredServers(config: RuntimeConfig): ConfiguredServer[] {
  const servers = new Map<string, ConfiguredServer>()
  const add = (url: string, label?: string) => {
    const key = url.replace(/\/+$/, '')
    const existing = servers.get(key)
    if (!existing) servers.set(key, { url, label, profiles: oauthProfilesFor(config.oauthProfiles, url) })
    else if (!existing.label) existing.label = label
  }
  for (const server of config.servers ?? DEFAULT_SERVERS) add(server.url, server.label)
  for (const url of profileServerUrls(config.oauthProfiles)) add(url)
  return [...servers.values()]
}

let current: RuntimeConfig = { oauthProfiles: [] }

export function getRuntimeConfig(): RuntimeConfig {
  return current
}

async function fetchSiteConfig(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch('./config.json', { cache: 'no-store' })
    if (!response.ok) return {}
    const body: unknown = await response.json().catch(() => {
      console.warn(`[config] ${response.url} is not JSON (${response.headers.get('content-type')}); no sign-in profiles were loaded.`)
    })
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Reads config.json, overlaid in the desktop app by its environment, and keeps the result for the session. */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const site = await fetchSiteConfig()
  const desktop = (await window.electronAPI?.getRuntimeConfig?.().catch(() => undefined)) ?? {}
  const { config, warnings } = parseRuntimeConfig({ ...site, ...(desktop as Record<string, unknown>) })
  for (const warning of warnings) console.warn(`[config] ${warning}`)
  current = config
  return config
}
