import { buildUrl, toJson, type SnippetRenderer } from './types'

/** JavaScript using the built-in fetch API (browser and Node 18+). */
export const fetchRenderer: SnippetRenderer = {
  id: 'fetch',
  label: 'JavaScript',
  render(descriptor, ctx) {
    const url = buildUrl(descriptor, ctx.baseUrl)
    const headerLines = Object.entries(ctx.headers)
      .map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
      .join(',\n')

    const init: string[] = [`  method: ${JSON.stringify(descriptor.method)}`]
    if (headerLines) init.push(`  headers: {\n${headerLines}\n  }`)
    // JSON is valid JS, so the pretty body drops straight into JSON.stringify.
    if (descriptor.body !== undefined) {
      init.push(`  body: JSON.stringify(${toJson(descriptor.body)})`)
    }

    return [
      `const response = await fetch(${JSON.stringify(url)}, {`,
      init.join(',\n'),
      `})`,
      `const data = await response.json()`,
    ].join('\n')
  },
}
