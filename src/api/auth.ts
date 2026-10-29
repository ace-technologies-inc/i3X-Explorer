import type { Credentials } from '../stores/connection'

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function buildAuthHeaders(credentials: Credentials | null | undefined): Record<string, string> {
  if (!credentials) return {}

  switch (credentials.type) {
    case 'bearer':
      return { Authorization: `Bearer ${credentials.token}` };
    case 'basic': {
      // btoa alone throws InvalidCharacterError on any character outside
      // Latin-1, taking down every request with an opaque error. Encode the
      // UTF-8 bytes instead (the RFC 7617 charset convention); pure-ASCII
      // credentials produce output identical to plain btoa.
      const bytes = new TextEncoder().encode(`${credentials.username}:${credentials.password}`)
      let binary = ''
      bytes.forEach(b => { binary += String.fromCharCode(b) })
      return { Authorization: `Basic ${btoa(binary)}` };
    }
    case 'header': {
      if (isNonEmpty(credentials.headerName) && isNonEmpty(credentials.headerValue)) {
        return { [credentials.headerName.trim()]: credentials.headerValue };
      }

      return {};
    }
    default:
      return {};
  }
}