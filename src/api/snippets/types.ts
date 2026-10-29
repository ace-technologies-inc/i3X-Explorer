import type { RequestDescriptor } from '../requestShape'

/** Languages the code-sample panel can render a request as. */
export type SnippetTarget = 'http' | 'curl' | 'fetch' | 'python' | 'csharp' | 'go'

/**
 * Everything a renderer needs beyond the descriptor: where the server lives and
 * which headers to send. Headers are resolved (and optionally redacted) by the
 * caller so a renderer only serializes them into its language's syntax.
 */
export interface SnippetContext {
  /** Base URL with no trailing slash, e.g. 'https://api.i3x.dev/v1'. */
  baseUrl: string
  /** Header name → value, already including any auth (redacted if requested). */
  headers: Record<string, string>
}

export interface SnippetRenderer {
  id: SnippetTarget
  /** Picker label, e.g. 'cURL', 'C#'. */
  label: string
  render(descriptor: RequestDescriptor, ctx: SnippetContext): string
}

/** Full request URL: base + path + serialized query string. */
export function buildUrl(descriptor: RequestDescriptor, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '')
  let url = `${base}${descriptor.path}`
  const query = descriptor.query
  if (query && Object.keys(query).length > 0) {
    const qs = new URLSearchParams(query).toString()
    url += `?${qs}`
  }
  return url
}

/** Pretty JSON, valid as-is in JavaScript, C#, and Go string literals. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/**
 * Render a value as a Python literal: JSON is almost Python already, but the
 * three keyword atoms differ (true/false/null → True/False/None), so a naive
 * string replace on JSON text would corrupt any string containing them.
 */
export function toPythonLiteral(value: unknown, indent = 0): string {
  const pad = '    '.repeat(indent)
  const padInner = '    '.repeat(indent + 1)
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map(v => `${padInner}${toPythonLiteral(v, indent + 1)}`)
    return `[\n${items.join(',\n')}\n${pad}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const items = entries.map(
      ([k, v]) => `${padInner}${JSON.stringify(k)}: ${toPythonLiteral(v, indent + 1)}`
    )
    return `{\n${items.join(',\n')}\n${pad}}`
  }
  return 'None'
}
