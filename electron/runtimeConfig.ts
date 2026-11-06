import fs from 'fs'
import path from 'path'
import { OAUTH_ENV_VARIABLE } from '../src/config/oauthEnv'

export const RUNTIME_CONFIG_FILE = 'i3x-explorer.config.json'

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * The non-empty I3X_OAUTH_* variables naming a profile field; the renderer turns them into
 * profiles. Others are left out, since config.json is public, and reported by name only.
 */
export function oauthEnvironment(
  env: Record<string, string | undefined>,
  warn: (message: string) => void = console.warn
): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('I3X_OAUTH_') || !value?.trim()) continue
    if (OAUTH_ENV_VARIABLE.test(name)) picked[name] = value
    else warn(`[config] ${name} is not an OAuth profile field and was not passed on.`)
  }
  return picked
}

/** The config file's settings plus the environment's I3X_OAUTH_* variables, which override its profiles field by field. */
export function mergeRuntimeConfig(
  file: unknown,
  env: Record<string, string | undefined>,
  warn: (message: string) => void = console.warn
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...asObject(file) }
  const oauthEnv = oauthEnvironment(env, warn)
  if (Object.keys(oauthEnv).length > 0) merged.env = oauthEnv
  else delete merged.env
  return merged
}

/** The first readable config file in `dirs`, else `{}`; a malformed file is reported and skipped. */
export function readRuntimeConfigFile(dirs: string[]): unknown {
  for (const dir of dirs) {
    const file = path.join(dir, RUNTIME_CONFIG_FILE)
    if (!fs.existsSync(file)) continue
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      console.warn(`Ignoring ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return {}
}
