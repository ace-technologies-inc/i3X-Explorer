// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createClient, destroyClient } from '../api/client'
import type { ObjectInstance } from '../api/types'
import { useConnectionStore } from '../stores/connection'
import { useExplorerStore } from '../stores/explorer'
import {
  buildElementLink,
  elementLinkFor,
  parseElementLink,
  pendingElementLink,
  setPendingElementLink,
  useElementLinkStore,
} from './elementLink'

const SERVER = 'https://i3x.example.com/v1'

const object = (elementId: string, parentId: string | null = null): ObjectInstance => ({
  elementId,
  displayName: elementId,
  typeId: 'T',
  parentId,
  isComposition: false,
  namespaceUri: 'urn:test',
})

function connect(serverUrl: string, objects: ObjectInstance[], origin: 'network' | 'cache' = 'network') {
  createClient(serverUrl)
  useConnectionStore.getState().setConnected(true)
  useExplorerStore.getState().setAllObjects(objects)
  useExplorerStore.setState({ catalogOrigin: { kind: origin, at: new Date().toISOString() } })
}

afterEach(() => {
  setPendingElementLink(null)
  useElementLinkStore.setState({ notice: null })
  useConnectionStore.getState().setConnected(false)
  useConnectionStore.getState().setRedirectNotice(null)
  useExplorerStore.getState().reset()
  destroyClient()
})

describe('buildElementLink / parseElementLink', () => {
  it('round-trips server, element and tab', () => {
    const link = buildElementLink('https://explorer.example.com/explorer/', `${SERVER}/`, 'line 1/pump&a=b', 'subtree')
    expect(new URL(link).origin + new URL(link).pathname).toBe('https://explorer.example.com/explorer/')
    expect(parseElementLink(new URL(link).search)).toEqual({
      serverUrl: SERVER,
      elementId: 'line 1/pump&a=b',
      tab: 'subtree',
    })
  })

  it('leaves the default tab out and drops the base address\'s own query and fragment', () => {
    const link = buildElementLink('https://explorer.example.com/?server=https://other.example.com#x', SERVER, 'pump')
    expect(link).toBe(`https://explorer.example.com/?server=${encodeURIComponent(SERVER)}&element=pump`)
    expect(parseElementLink(new URL(link).search)?.tab).toBe('overview')
  })

  it('is not a link without an element, and ignores an unknown tab or a non-http server', () => {
    expect(parseElementLink(`?server=${encodeURIComponent(SERVER)}`)).toBeNull()
    expect(parseElementLink('?element=pump&tab=nope&server=javascript:alert(1)')).toEqual({
      serverUrl: null,
      elementId: 'pump',
      tab: 'overview',
    })
  })
})

describe('elementLinkFor', () => {
  it('links to the connected server from the page\'s own address, and to nothing while disconnected', () => {
    expect(elementLinkFor('pump')).toBeNull()
    createClient(`${SERVER}/`)
    const link = elementLinkFor('pump', 'history')!
    expect(link.startsWith(window.location.origin)).toBe(true)
    expect(parseElementLink(new URL(link).search)).toEqual({ serverUrl: SERVER, elementId: 'pump', tab: 'history' })
  })
})

describe('following an opened link', () => {
  it('waits for the catalog, then opens the element on its tab with its ancestors expanded', () => {
    setPendingElementLink({ serverUrl: SERVER, elementId: 'pump', tab: 'relationships' })
    expect(useExplorerStore.getState().selectedItem).toBeNull()

    connect(SERVER, [object('line'), object('pump', 'line')])

    const state = useExplorerStore.getState()
    expect(state.selectedItem?.id).toBe('hier:pump')
    expect(state.detailTab).toBe('relationships')
    expect(state.expandedNodes.has('hier:line')).toBe(true)
    expect(pendingElementLink()).toBeNull()
    expect(useElementLinkStore.getState().notice).toBeNull()
  })

  it('says so when the server\'s catalog does not contain the element', () => {
    setPendingElementLink({ serverUrl: SERVER, elementId: 'gone', tab: 'overview' })
    connect(SERVER, [object('line')])

    expect(useExplorerStore.getState().selectedItem).toBeNull()
    expect(useElementLinkStore.getState().notice).toContain('"gone"')
    expect(pendingElementLink()).toBeNull()
  })

  it('keeps waiting on a cached catalog that lacks the element, and opens it from the server\'s copy', () => {
    setPendingElementLink({ serverUrl: SERVER, elementId: 'new', tab: 'overview' })
    connect(SERVER, [object('line')], 'cache')
    expect(useElementLinkStore.getState().notice).toBeNull()
    expect(pendingElementLink()).not.toBeNull()

    useExplorerStore.getState().setAllObjects([object('line'), object('new', 'line')])
    expect(useExplorerStore.getState().selectedItem?.id).toBe('hier:new')
  })

  it('does not open a same-named element on another server, and follows once the right one is connected', () => {
    setPendingElementLink({ serverUrl: SERVER, elementId: 'pump', tab: 'overview' })
    connect('https://other.example.com/v1', [object('pump')])

    expect(useExplorerStore.getState().selectedItem).toBeNull()
    expect(useElementLinkStore.getState().notice).toContain(SERVER)

    useExplorerStore.getState().reset()
    connect(SERVER, [object('pump')])
    expect(useExplorerStore.getState().selectedItem?.id).toBe('hier:pump')
    expect(useElementLinkStore.getState().notice).toBeNull()
  })

  it('follows a link to the address the server redirected from', () => {
    setPendingElementLink({ serverUrl: 'http://i3x.example.com/v1', elementId: 'pump', tab: 'overview' })
    useConnectionStore.getState().setRedirectNotice({ from: 'http://i3x.example.com/v1', to: SERVER })
    useConnectionStore.getState().setRedirectNotice(null)
    connect(SERVER, [object('pump')])
    expect(useExplorerStore.getState().selectedItem?.id).toBe('hier:pump')
  })
})
