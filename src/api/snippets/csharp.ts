import { buildUrl, toJson, type SnippetRenderer } from './types'

/** C# using HttpClient. The body is a raw JSON verbatim string so it survives
 * any payload shape without hand-mapping JSON onto anonymous types. */
export const csharpRenderer: SnippetRenderer = {
  id: 'csharp',
  label: 'C#',
  render(descriptor, ctx) {
    const url = buildUrl(descriptor, ctx.baseUrl)
    const lines: string[] = [
      `using var client = new HttpClient();`,
      `var request = new HttpRequestMessage(HttpMethod.${methodName(descriptor.method)}, "${url}");`,
    ]
    for (const [name, value] of Object.entries(ctx.headers)) {
      // Content-Type rides on the body content below, not the request headers.
      if (name.toLowerCase() === 'content-type') continue
      lines.push(`request.Headers.Add("${name}", "${escapeCs(value)}");`)
    }
    if (descriptor.body !== undefined) {
      // Verbatim string doubles embedded quotes; JSON is quote-heavy but correct.
      const json = toJson(descriptor.body).replace(/"/g, '""')
      lines.push(
        `request.Content = new StringContent(@"${json}", System.Text.Encoding.UTF8, "application/json");`
      )
    }
    lines.push(
      `var response = await client.SendAsync(request);`,
      `var data = await response.Content.ReadAsStringAsync();`
    )
    return lines.join('\n')
  },
}

function methodName(method: string): string {
  return method.charAt(0) + method.slice(1).toLowerCase()
}

function escapeCs(value: string): string {
  return value.replace(/"/g, '\\"')
}
