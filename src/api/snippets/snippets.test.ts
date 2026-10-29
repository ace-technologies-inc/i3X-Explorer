import { describe, expect, it } from 'vitest'
import { describeGetNamespaces, describeGetValue } from '../requestShape'
import { renderSnippet, resolveHeaders, SNIPPET_RENDERERS } from './index'
import { toPythonLiteral } from './types'

const CTX = {
  baseUrl: 'https://api.i3x.dev/v1',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': 'YOUR_API_KEY' },
}

const valueDescriptor = describeGetValue('eq-1', 1)

describe('renderSnippet', () => {
  it('renders every registered language without throwing', () => {
    for (const renderer of SNIPPET_RENDERERS) {
      const out = renderSnippet(valueDescriptor, renderer.id, CTX)
      expect(out.length).toBeGreaterThan(0)
      // The endpoint URL appears in every language's output.
      expect(out).toContain('https://api.i3x.dev/v1/objects/value')
    }
  })

  it('renders a raw HTTP request as method, URL, headers, blank line, then body', () => {
    const out = renderSnippet(valueDescriptor, 'http', CTX)
    const [firstLine] = out.split('\n')
    expect(firstLine).toBe('POST https://api.i3x.dev/v1/objects/value')
    expect(out).toContain('X-API-Key: YOUR_API_KEY')
    // Headers and body are separated by exactly one blank line.
    expect(out).toContain('\n\n{')
  })

  it('is the first (default) language in the registry', () => {
    expect(SNIPPET_RENDERERS[0].id).toBe('http')
  })

  it('produces a valid JSON body inside the fetch sample', () => {
    const out = renderSnippet(valueDescriptor, 'fetch', CTX)
    expect(out).toContain('method: "POST"')
    expect(out).toContain('JSON.stringify(')
    expect(out).toContain('"elementIds"')
  })

  it('uses Python keyword atoms, not JSON ones', () => {
    const d = describeGetNamespaces()
    // GET with no body: no json= argument, and no body keyword slips in.
    const out = renderSnippet(d, 'python', CTX)
    expect(out).toContain('requests.get(')
    expect(out).not.toContain('json=')
  })

  it('serializes booleans and null as Python literals', () => {
    expect(toPythonLiteral({ a: true, b: false, c: null })).toBe(
      '{\n    "a": True,\n    "b": False,\n    "c": None\n}'
    )
  })

  it('doubles quotes for the C# verbatim body string', () => {
    const out = renderSnippet(valueDescriptor, 'csharp', CTX)
    expect(out).toContain('new HttpRequestMessage(HttpMethod.Post')
    expect(out).toContain('@"')
    // The X-API-Key header is added, Content-Type is not (rides on the content).
    expect(out).toContain('request.Headers.Add("X-API-Key"')
    expect(out).not.toContain('request.Headers.Add("Content-Type"')
  })

  it('drops the body reader import for a bodyless Go request', () => {
    const get = renderSnippet(describeGetNamespaces(), 'go', CTX)
    expect(get).toContain('http.NewRequest("GET"')
    expect(get).toContain(', nil)')
    expect(get).not.toContain('strings')
  })
})

describe('resolveHeaders', () => {
  it('adds Content-Type only when there is a body', () => {
    const withBody = resolveHeaders(valueDescriptor, null, true)
    expect(withBody['Content-Type']).toBe('application/json')

    const noBody = resolveHeaders(describeGetNamespaces(), null, true)
    expect(noBody['Content-Type']).toBeUndefined()
    expect(noBody.Accept).toBe('application/json')
  })

  it('redacts a custom auth header value but keeps its name', () => {
    const creds = { type: 'header', headerName: 'X-API-Key', headerValue: 'secret-123' } as const
    const redacted = resolveHeaders(valueDescriptor, creds, true)
    expect(redacted['X-API-Key']).toBe('YOUR_API_KEY')

    const live = resolveHeaders(valueDescriptor, creds, false)
    expect(live['X-API-Key']).toBe('secret-123')
  })

  it('preserves the bearer scheme word when redacting', () => {
    const creds = { type: 'bearer', token: 'abc.def.ghi' } as const
    const redacted = resolveHeaders(valueDescriptor, creds, true)
    expect(redacted.Authorization).toBe('Bearer YOUR_TOKEN')
  })
})
