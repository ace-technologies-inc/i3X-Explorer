import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I3XClient } from './client'
import { CredentialRedirectError, CredentialScopeError, type AuthProvider } from './authProvider'
import { SSESubscription } from './subscription'

// A real server and real fetch: the browser keeps Authorization on a same-origin redirect, which a stub cannot show.
type Route = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let origin: string
let routes: Record<string, Route>
let seen: { path: string; authorization: string | undefined }[]

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const redirect = (to: string): Route => (_req, res) => {
  res.writeHead(302, { Location: to })
  res.end()
}
const ok: Route = (_req, res) => json(res, { success: true, result: [] })
const info: Route = (_req, res) => json(res, { specVersion: '1.0' })

beforeEach(async () => {
  routes = {}
  seen = []
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    seen.push({ path, authorization: req.headers.authorization })
    ;(routes[path] ?? ((_q, r) => json(r, {}, 404)))(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise(resolve => server.close(resolve))
})

/** Credentials scoped to `/allowed`, like a profile whose APPLIES_TO names a path. */
const scopedToAllowed = (): AuthProvider => ({
  getHeaders: async () => ({ Authorization: 'Bearer scoped-token' }),
  handleUnauthorized: async () => false,
  permits: baseUrl => baseUrl.startsWith(`${origin}/allowed/`),
})

const sentTo = (path: string) => seen.filter(request => request.path === path)

describe('scoped credentials and same-origin redirects', () => {
  it('learns where /info redirects without sending the credentials, and refuses an out-of-scope target', async () => {
    routes['/allowed/v1/info'] = redirect('/outside/v1/info')
    routes['/outside/v1/info'] = info
    const client = new I3XClient(`${origin}/allowed/v1`, null, scopedToAllowed())

    await expect(client.testConnection()).rejects.toBeInstanceOf(CredentialScopeError)
    expect(seen.map(request => request.path)).toEqual(['/allowed/v1/info', '/outside/v1/info'])
    expect(seen.map(request => request.authorization)).toEqual([undefined, undefined])
  })

  it('does not follow a redirect on a signed-in request, so the token never reaches its target', async () => {
    routes['/allowed/v1/info'] = info
    routes['/allowed/v1/namespaces'] = redirect('/outside/v1/namespaces')
    routes['/outside/v1/namespaces'] = ok
    const client = new I3XClient(`${origin}/allowed/v1`, null, scopedToAllowed())

    await expect(client.testConnection()).rejects.toBeInstanceOf(CredentialRedirectError)
    expect(sentTo('/allowed/v1/namespaces').map(request => request.authorization)).toEqual(['Bearer scoped-token'])
    expect(sentTo('/outside/v1/namespaces')).toEqual([])
  })

  it('asks /info again with the sign-in when it requires one, at the base it checked', async () => {
    routes['/allowed/v1/info'] = (req, res) =>
      req.headers.authorization ? json(res, { specVersion: '1.0' }) : json(res, { title: 'sign in' }, 401)
    routes['/allowed/v1/namespaces'] = ok
    const client = new I3XClient(`${origin}/allowed/v1`, null, scopedToAllowed())

    expect(await client.testConnection()).toBe(true)
    expect(sentTo('/allowed/v1/info').map(request => request.authorization)).toEqual([undefined, 'Bearer scoped-token'])
  })

  it('stops the event stream at a redirect instead of following it', async () => {
    routes['/allowed/v1/stream'] = redirect('/outside/v1/stream')
    routes['/outside/v1/stream'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end()
    }
    const onError = vi.fn()
    const stream = new SSESubscription(`${origin}/allowed/v1/stream`, vi.fn(), onError, scopedToAllowed())

    stream.connect()
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    stream.disconnect()

    expect(onError.mock.calls[0][0]).toBeInstanceOf(CredentialRedirectError)
    expect(sentTo('/outside/v1/stream')).toEqual([])
  })
})
