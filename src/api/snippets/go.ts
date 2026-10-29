import { buildUrl, toJson, type SnippetRenderer } from './types'

/** Go using net/http. The body is a raw backtick string, so JSON needs no
 * escaping (payloads never contain a backtick). */
export const goRenderer: SnippetRenderer = {
  id: 'go',
  label: 'Go',
  render(descriptor, ctx) {
    const url = buildUrl(descriptor, ctx.baseUrl)
    const hasBody = descriptor.body !== undefined
    const imports = ['"net/http"', '"io"']
    if (hasBody) imports.unshift('"strings"')

    const lines: string[] = [
      `package main`,
      ``,
      `import (`,
      ...imports.map(i => `\t${i}`),
      `)`,
      ``,
      `func main() {`,
    ]
    if (hasBody) {
      lines.push(`\tbody := strings.NewReader(\`${toJson(descriptor.body)}\`)`)
      lines.push(`\treq, _ := http.NewRequest("${descriptor.method}", "${url}", body)`)
    } else {
      lines.push(`\treq, _ := http.NewRequest("${descriptor.method}", "${url}", nil)`)
    }
    for (const [name, value] of Object.entries(ctx.headers)) {
      lines.push(`\treq.Header.Set("${name}", "${escapeGo(value)}")`)
    }
    lines.push(
      `\tresp, _ := http.DefaultClient.Do(req)`,
      `\tdefer resp.Body.Close()`,
      `\tdata, _ := io.ReadAll(resp.Body)`,
      `\t_ = data`,
      `}`
    )
    return lines.join('\n')
  },
}

function escapeGo(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
