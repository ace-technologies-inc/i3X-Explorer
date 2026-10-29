// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createClient, destroyClient } from '../api/client'
import type { LastKnownValue, ObjectInstance } from '../api/types'
import { useEgoGraph } from '../components/graph/useEgoGraph'
import { clearServerQueries, queryClient, serverScope } from './queryClient'
import { useObjectValue } from './queries'
import { useObjectDetails } from './useObjectDetails'

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children)

const root: ObjectInstance = {
  elementId: 'site',
  displayName: 'Site',
  typeId: 'T',
  parentId: null,
  isComposition: false,
  namespaceUri: 'urn:x',
}

afterEach(() => {
  clearServerQueries()
  destroyClient()
  vi.restoreAllMocks()
})

describe('server read cache', () => {
  it('shows a revisited value at once while it revalidates', async () => {
    const client = createClient('http://server')
    const getValue = vi.spyOn(client, 'getValue').mockResolvedValue({ elementId: 'site', value: { value: 1 } } as unknown as LastKnownValue)

    const first = renderHook(() => useObjectValue('site', false), { wrapper })
    await waitFor(() => expect(first.result.current.data).toBeDefined())
    first.unmount()

    const second = renderHook(() => useObjectValue('site', false), { wrapper })
    expect(second.result.current.data).toEqual({ elementId: 'site', value: { value: 1 } })
    await waitFor(() => expect(getValue).toHaveBeenCalledTimes(2))
  })

  it('reuses a fresh relationship walk for the same root and depth', async () => {
    const client = createClient('http://server')
    const getRelated = vi.spyOn(client, 'getRelatedObjectsBatch').mockResolvedValue({ related: new Map(), failures: [] })

    const first = renderHook(() => useEgoGraph(root, 1), { wrapper })
    await waitFor(() => expect(first.result.current.graph).not.toBeNull())
    first.unmount()

    const second = renderHook(() => useEgoGraph(root, 1), { wrapper })
    expect(second.result.current.graph).not.toBeNull()
    expect(second.result.current.isLoading).toBe(false)
    expect(getRelated).toHaveBeenCalledTimes(1)
  })

  it('forgets cached reads when the connection changes', async () => {
    const client = createClient('http://server')
    vi.spyOn(client, 'getValue').mockResolvedValue({ elementId: 'site', value: { value: 1 } } as unknown as LastKnownValue)
    const first = renderHook(() => useObjectValue('site', false), { wrapper })
    await waitFor(() => expect(first.result.current.data).toBeDefined())
    first.unmount()

    clearServerQueries()

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })
})

describe('object details', () => {
  function v1Client() {
    const client = createClient('http://server')
    return client
  }

  it('reports a failed detail read and replaces the skeleton once a retry succeeds', async () => {
    const client = v1Client()
    const full = { ...root, description: 'The site', metadata: { owner: 'mes' } }
    const getObject = vi.spyOn(client, 'getObject').mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(full)

    const { result } = renderHook(() => useObjectDetails(root), { wrapper })
    await waitFor(() => expect(result.current.detailsError?.message).toBe('HTTP 503'))
    expect(result.current.object).toBe(root)
    expect(result.current.detailsPending).toBe(false)

    act(() => result.current.retryDetails())

    await waitFor(() => expect(result.current.object).toEqual(full))
    expect(result.current.detailsError).toBeNull()
    expect(getObject).toHaveBeenCalledTimes(2)
  })

  it('refetches open details when a catalog refresh invalidates them', async () => {
    const client = v1Client()
    const getObject = vi.spyOn(client, 'getObject')
      .mockResolvedValueOnce({ ...root, description: 'before', metadata: {} })
      .mockResolvedValueOnce({ ...root, description: 'after', metadata: {} })

    const { result } = renderHook(() => useObjectDetails(root), { wrapper })
    await waitFor(() => expect(result.current.object.description).toBe('before'))

    await act(() => queryClient.invalidateQueries({ queryKey: ['objectDetails', ...serverScope()] }))

    await waitFor(() => expect(result.current.object.description).toBe('after'))
    expect(getObject).toHaveBeenCalledTimes(2)
  })
})
