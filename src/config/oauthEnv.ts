/**
 * The OAuth profile fields an I3X_OAUTH_* variable may set. Shared by the app,
 * the Electron main process and the dev server; only these variables are
 * published in config.json.
 */
export const OAUTH_ENV_FIELDS: Record<string, string> = {
  ISSUER: 'issuer',
  CLIENT_ID: 'clientId',
  SCOPES: 'scopes',
  APPLIES_TO: 'appliesTo',
  SERVERS: 'servers',
  RESOURCE: 'resource',
  EXTRA_PARAMS: 'extraParams',
  REDIRECT_URI: 'redirectUri',
  LOOPBACK_REDIRECT_URI: 'loopbackRedirectUri',
  LABEL: 'label',
}

// I3X_OAUTH_<FIELD> or I3X_OAUTH_<NAME>_<FIELD>; a name has no underscore. Decides only whether a variable is passed through.
export const OAUTH_ENV_VARIABLE = new RegExp(`^I3X_OAUTH_(?:([A-Z0-9]+)_)?(${Object.keys(OAUTH_ENV_FIELDS).join('|')})$`)

/**
 * The profile (undefined for the unnamed one) and field a variable sets. A complete field name wins
 * over a profile name, since a field can end in another (LOOPBACK_REDIRECT_URI ends in REDIRECT_URI).
 */
export function parseOAuthEnvVariable(variable: string): { profile?: string; field: string } | null {
  if (!variable.startsWith('I3X_OAUTH_')) return null
  const rest = variable.slice('I3X_OAUTH_'.length)
  if (rest in OAUTH_ENV_FIELDS) return { field: OAUTH_ENV_FIELDS[rest] }
  const match = OAUTH_ENV_VARIABLE.exec(variable)
  return match?.[1] ? { profile: match[1], field: OAUTH_ENV_FIELDS[match[2]] } : null
}
