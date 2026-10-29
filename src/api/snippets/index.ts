import type { Credentials } from '../../stores/connection'
import { buildAuthHeaders } from '../auth'
import type { RequestDescriptor } from '../requestShape'
import { curlRenderer } from './curl'
import { csharpRenderer } from './csharp'
import { fetchRenderer } from './fetch'
import { goRenderer } from './go'
import { httpRenderer } from './http'
import { pythonRenderer } from './python'
import type { SnippetContext, SnippetRenderer, SnippetTarget } from './types'

export type { SnippetContext, SnippetRenderer, SnippetTarget } from './types'

/**
 * The ordered set of languages the panel offers. HTTP is first so it is the
 * default: method + URL + JSON body is the request shape at its plainest.
 * Adding a language is one import plus one entry here — no call site changes,
 * because every renderer consumes the same RequestDescriptor.
 */
export const SNIPPET_RENDERERS: SnippetRenderer[] = [
  httpRenderer,
  curlRenderer,
  fetchRenderer,
  pythonRenderer,
  csharpRenderer,
  goRenderer,
]

const RENDERER_BY_ID = new Map<SnippetTarget, SnippetRenderer>(
  SNIPPET_RENDERERS.map(r => [r.id, r])
)

/** Render a descriptor to source in one target language. */
export function renderSnippet(
  descriptor: RequestDescriptor,
  target: SnippetTarget,
  ctx: SnippetContext
): string {
  const renderer = RENDERER_BY_ID.get(target)
  if (!renderer) return ''
  return renderer.render(descriptor, ctx)
}

/**
 * Resolve the header map a sample should show: the standard content/accept
 * headers plus whatever auth the connection carries. With `redact`, secret
 * values are replaced by named placeholders so a copied sample never leaks a
 * live key while still showing exactly which header to set.
 */
export function resolveHeaders(
  descriptor: RequestDescriptor,
  credentials: Credentials | null,
  redact: boolean
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (descriptor.body !== undefined) headers['Content-Type'] = 'application/json'

  const auth = buildAuthHeaders(credentials)
  for (const [name, value] of Object.entries(auth)) {
    headers[name] = redact ? redactValue(name, value) : value
  }
  return headers
}

function redactValue(headerName: string, value: string): string {
  // Preserve the scheme word (Bearer/Basic) so the shape stays instructive.
  const [scheme] = value.split(' ')
  if (headerName.toLowerCase() === 'authorization' && (scheme === 'Bearer' || scheme === 'Basic')) {
    return `${scheme} YOUR_${scheme === 'Bearer' ? 'TOKEN' : 'CREDENTIALS'}`
  }
  return 'YOUR_API_KEY'
}
