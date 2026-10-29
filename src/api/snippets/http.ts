import { buildUrl, toJson, type SnippetRenderer } from './types'

/**
 * A raw HTTP request: method + URL, headers, then the JSON body. No client
 * library, so it reads as the request shape itself, and it is valid `.http`
 * (VS Code REST Client / JetBrains HTTP client) syntax you can run as-is.
 */
export const httpRenderer: SnippetRenderer = {
  id: 'http',
  label: 'HTTP',
  render(descriptor, ctx) {
    const url = buildUrl(descriptor, ctx.baseUrl)
    const lines: string[] = [`${descriptor.method} ${url}`]
    for (const [name, value] of Object.entries(ctx.headers)) {
      lines.push(`${name}: ${value}`)
    }
    if (descriptor.body !== undefined) {
      // A blank line separates headers from the body, per the HTTP message format.
      lines.push('', toJson(descriptor.body))
    }
    return lines.join('\n')
  },
}
