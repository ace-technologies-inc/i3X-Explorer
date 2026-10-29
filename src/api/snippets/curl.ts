import { buildUrl, toJson, type SnippetRenderer } from './types'

/** cURL: a copy-paste terminal command. */
export const curlRenderer: SnippetRenderer = {
  id: 'curl',
  label: 'cURL',
  render(descriptor, ctx) {
    const url = buildUrl(descriptor, ctx.baseUrl)
    const lines: string[] = []
    // GET is curl's default verb, so only spell out the others.
    const verb = descriptor.method === 'GET' ? '' : `-X ${descriptor.method} `
    lines.push(`curl ${verb}'${url}'`)
    for (const [name, value] of Object.entries(ctx.headers)) {
      lines.push(`  -H '${name}: ${value}'`)
    }
    if (descriptor.body !== undefined) {
      lines.push(`  -d '${toJson(descriptor.body)}'`)
    }
    return lines.join(' \\\n')
  },
}
