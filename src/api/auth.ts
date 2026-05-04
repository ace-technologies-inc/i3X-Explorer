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
      const encoded = btoa(`${credentials.username}:${credentials.password}`)
      return { Authorization: `Basic ${encoded}` };
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