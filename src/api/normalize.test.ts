import { describe, expect, it } from 'vitest'
import {
  bulkOutcome,
  bulkRejection,
  compositionDepth,
  extractV1BulkResults,
  failureMessage,
  failureStatus,
  isFailedEnvelope,
  normalizeV1Object,
  readInfoResponse,
  singleBulkResult,
  subscriptionUpdateItems,
  AuthRequiredError,
  UnsupportedServerError,
} from './normalize'

describe('bulkOutcome', () => {
  it('accepts every element for an empty body or one without per-item results', () => {
    expect(bulkOutcome(['a', 'b'], undefined)).toEqual({ accepted: ['a', 'b'], rejected: [] })
    expect(bulkOutcome(['a'], { success: true })).toEqual({ accepted: ['a'], rejected: [] })
  })

  it('rejects every element when the body reports failure', () => {
    const outcome = bulkOutcome(['a', 'b'], { success: false, responseDetail: { title: 'Not Found', detail: 'no such subscription' } })
    expect(outcome.accepted).toEqual([])
    expect(outcome.rejected).toEqual([
      { elementId: 'a', message: 'no such subscription' },
      { elementId: 'b', message: 'no such subscription' },
    ])
  })

  it('splits mixed per-item results', () => {
    const outcome = bulkOutcome(['a', 'b'], {
      success: true,
      results: [
        { success: true, elementId: 'a' },
        { success: false, elementId: 'b', responseDetail: { title: 'Not Found', detail: 'b not found' } },
      ],
    })
    expect(outcome).toEqual({ accepted: ['a'], rejected: [{ elementId: 'b', message: 'b not found' }] })
    expect(bulkRejection(outcome)?.message).toBe('b: b not found')
    expect(bulkRejection({ accepted: ['a'], rejected: [] })).toBeNull()
  })
})

describe('compositionDepth', () => {
  it('reads a composition with its whole component tree and anything else alone', () => {
    expect(compositionDepth(true)).toBe(0)
    expect(compositionDepth(false)).toBe(1)
  })
})

describe('subscriptionUpdateItems', () => {
  it('unfolds a composition update\'s components, inheriting the root VQT where a component omits it', () => {
    const items = subscriptionUpdateItems([
      {
        elementId: 'line',
        value: null,
        quality: 'Good',
        timestamp: '2026-10-12T13:00:00Z',
        components: { 'line:count': { value: 7 }, 'line:state': { value: 'Run', quality: 'Bad' } },
      },
    ])
    expect(items).toEqual([
      { elementId: 'line', value: null, quality: 'Good', timestamp: '2026-10-12T13:00:00Z' },
      { elementId: 'line:count', value: 7, quality: 'Good', timestamp: '2026-10-12T13:00:00Z' },
      { elementId: 'line:state', value: 'Run', quality: 'Bad', timestamp: '2026-10-12T13:00:00Z' },
    ])
  })

  it('keeps a component\'s own update over its copy in the root, and skips malformed entries', () => {
    const items = subscriptionUpdateItems([
      { elementId: 'line', value: 1, components: { 'line:count': { value: 7 } } },
      { elementId: 'line:count', value: 8 },
      { value: 'no id' },
      'junk',
    ])
    expect(items.map(item => [item.elementId, item.value])).toEqual([
      ['line', 1],
      ['line:count', 8],
    ])
  })
})

describe('readInfoResponse', () => {
  const unsupported = (input: { ok: boolean; status?: number; body: unknown }) => {
    try {
      readInfoResponse({ status: 200, ...input })
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedServerError)
      return err as UnsupportedServerError
    }
    throw new Error('expected readInfoResponse to throw')
  }

  it('names a 401 or 403 as an authentication problem, not an unsupported server', () => {
    for (const status of [401, 403]) {
      let thrown: unknown
      try {
        readInfoResponse({ ok: false, status, body: undefined })
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(AuthRequiredError)
      expect((thrown as AuthRequiredError).status).toBe(status)
    }
    expect(new AuthRequiredError(401).message).toContain('requires authentication (HTTP 401)')
    expect(new AuthRequiredError(403).message).toContain('denied access (HTTP 403)')
  })

  it('accepts specVersion >= 1.0 and returns the capabilities matrix', () => {
    expect(
      readInfoResponse({ ok: true, status: 200, body: { specVersion: '1.0', capabilities: { subscribe: { stream: true } } } })
    ).toEqual({ subscribe: { stream: true } })
  })

  it('returns null capabilities when the server sent none', () => {
    expect(readInfoResponse({ ok: true, status: 200, body: { specVersion: '1.0' } })).toBeNull()
  })

  it('unwraps the {success, result} envelope', () => {
    expect(
      readInfoResponse({ ok: true, status: 200, body: { success: true, result: { specVersion: '1.2', capabilities: { query: { history: true } } } } })
    ).toEqual({ query: { history: true } })
  })

  it('accepts version and apiVersion as fallback field names', () => {
    expect(() => readInfoResponse({ ok: true, status: 200, body: { version: '1.0' } })).not.toThrow()
    expect(() => readInfoResponse({ ok: true, status: 200, body: { apiVersion: '1.1' } })).not.toThrow()
  })

  it('rejects a non-OK /info probe, naming the status', () => {
    const err = unsupported({ ok: false, status: 404, body: undefined })
    expect(err.found).toBe('GET /info answered HTTP 404')
    expect(err.message).toBe(
      'This server does not implement i3X 1.0 (found: GET /info answered HTTP 404). i3X Explorer 1.1 supports 1.0 servers only.'
    )
  })

  it('rejects a spec version below 1.0', () => {
    expect(unsupported({ ok: true, body: { specVersion: '0.9' } }).found).toBe('spec version 0.9')
  })

  it('rejects a beta serverVersion even with specVersion 1.0', () => {
    expect(unsupported({ ok: true, body: { specVersion: '1.0', serverVersion: '1.0.0-BETA' } }).found)
      .toBe('spec version 1.0, server 1.0.0-beta')
  })

  it('rejects an OK response with an unusable body', () => {
    expect(unsupported({ ok: true, body: undefined }).found).toBe('an unreadable /info response')
    expect(unsupported({ ok: true, body: null }).found).toBe('an unreadable /info response')
    expect(unsupported({ ok: true, body: [] }).found).toBe('an unreadable /info response')
    expect(unsupported({ ok: true, body: {} }).found).toBe('no spec version in /info')
    expect(unsupported({ ok: true, body: { specVersion: 'wat' } }).found).toBe('no spec version in /info')
  })
})

describe('failureMessage and failureStatus', () => {
  it('read a 1.0 responseDetail', () => {
    const body = { success: false, responseDetail: { title: 'Not Found', status: 404, detail: 'no such element' } }
    expect(failureMessage(body)).toBe('no such element')
    expect(failureStatus(body)).toBe(404)
    expect(failureMessage({ responseDetail: { title: 'Bad Request' } })).toBe('Bad Request')
  })

  it('do not read the bodies earlier builds also accepted', () => {
    expect(failureMessage({ problemDetail: { detail: 'beta' } })).toBeUndefined()
    expect(failureMessage({ error: { message: 'alpha' } })).toBeUndefined()
    expect(failureStatus({ problemDetail: { status: 500 } })).toBeUndefined()
  })
})

describe('normalizeV1Object', () => {
  it('maps typeElementId to typeId and metadata.typeNamespaceUri to namespaceUri', () => {
    const normalized = normalizeV1Object({
      elementId: 'e1',
      displayName: 'E1',
      typeElementId: 'T1',
      metadata: { typeNamespaceUri: 'urn:ns' },
    })
    expect(normalized.typeId).toBe('T1')
    expect(normalized.namespaceUri).toBe('urn:ns')
  })

  it('surfaces schemaExtensions from metadata or the object itself', () => {
    expect(
      normalizeV1Object({ elementId: 'e', displayName: 'E', metadata: { schemaExtensions: { b: 2 } } })
        .schemaExtensions
    ).toEqual({ b: 2 })
    expect(
      normalizeV1Object({ elementId: 'e', displayName: 'E', schemaExtensions: { c: 3 } }).schemaExtensions
    ).toEqual({ c: 3 })
    expect(normalizeV1Object({ elementId: 'e', displayName: 'E' }).schemaExtensions).toBeUndefined()
  })

  it('defaults the flags and parentId', () => {
    const normalized = normalizeV1Object({ elementId: 'e', displayName: 'E' })
    expect(normalized.parentId).toBeNull()
    expect(normalized.isComposition).toBe(false)
    expect(normalized.isExtended).toBe(false)
    expect(normalized.typeId).toBe('')
    expect(normalized.metadata).toBeUndefined()
  })
})

describe('extractV1BulkResults', () => {
  it('returns the results array', () => {
    expect(
      extractV1BulkResults({ success: true, results: [{ success: true, elementId: 'e', result: 1 }] })
    ).toEqual([{ success: true, elementId: 'e', result: 1 }])
  })

  it('returns [] for garbage shapes', () => {
    expect(extractV1BulkResults(undefined)).toEqual([])
    expect(extractV1BulkResults(null)).toEqual([])
    expect(extractV1BulkResults('nope')).toEqual([])
    expect(extractV1BulkResults({ success: true })).toEqual([])
    expect(extractV1BulkResults({ results: null })).toEqual([])
  })
})

describe('singleBulkResult', () => {
  const failed = { title: 'Error', status: 500, detail: 'backend down' }

  it('returns the matching successful result', () => {
    expect(singleBulkResult({ success: true, results: [{ success: true, elementId: 'e', result: 1 }] }, 'e')).toBe(1)
  })

  it('throws the responseDetail of a failed item, matched by id or as the lone unlabeled result', () => {
    const byId = { success: false, results: [{ success: false, elementId: 'e', result: null, responseDetail: failed }] }
    const unlabeled = { success: false, results: [{ success: false, elementId: null, result: null, responseDetail: failed }] }
    expect(() => singleBulkResult(byId, 'e')).toThrow('HTTP 500: backend down')
    expect(() => singleBulkResult(unlabeled, 'e')).toThrow('HTTP 500: backend down')
  })

  it('throws a top-level failure with no item, and returns undefined for a silent miss', () => {
    expect(() => singleBulkResult({ success: false, results: [], responseDetail: failed }, 'e')).toThrow('HTTP 500: backend down')
    expect(singleBulkResult({ success: true, results: [] }, 'e')).toBeUndefined()
  })
})

describe('isFailedEnvelope', () => {
  it('flags non-bulk failure bodies only', () => {
    expect(isFailedEnvelope({ success: false, result: null, responseDetail: {} })).toBe(true)
    expect(isFailedEnvelope({ success: false, results: [] })).toBe(false)
    expect(isFailedEnvelope({ success: true, result: [] })).toBe(false)
    expect(isFailedEnvelope([])).toBe(false)
  })
})
