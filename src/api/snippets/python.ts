import { buildUrl, toPythonLiteral, type SnippetRenderer } from './types'

/** Python using the requests library. */
export const pythonRenderer: SnippetRenderer = {
  id: 'python',
  label: 'Python',
  render(descriptor, ctx) {
    const url = buildUrl(descriptor, ctx.baseUrl)
    const method = descriptor.method.toLowerCase()

    const args: string[] = [`    ${JSON.stringify(url)}`]
    const headerEntries = Object.entries(ctx.headers)
    if (headerEntries.length > 0) {
      const headers = headerEntries
        .map(([name, value]) => `        ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
        .join(',\n')
      args.push(`    headers={\n${headers},\n    }`)
    }
    if (descriptor.body !== undefined) {
      args.push(`    json=${toPythonLiteral(descriptor.body, 1)}`)
    }

    return [
      `import requests`,
      ``,
      `response = requests.${method}(`,
      args.join(',\n'),
      `)`,
      `data = response.json()`,
    ].join('\n')
  },
}
