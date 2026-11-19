import { create } from 'zustand'
import { getClient } from '../api/client'
import { copyText } from '../components/common/clipboard'
import { openElement } from '../components/main/navigation'
import { getRuntimeConfig } from '../config/runtimeConfig'
import { normalizeServerUrl, useConnectionStore } from '../stores/connection'
import { useExplorerStore, type DetailTab } from '../stores/explorer'
import { parseServerParam } from './serverFromQuery'

/**
 * Shareable links to one object: `<explorer>?server=<url>&element=<id>&tab=<tab>`.
 *
 * A link names a server, an element and a detail tab, and nothing else: never
 * credentials. Whoever opens it connects with their own. Opening one does not
 * connect either (see serverFromQuery): the link waits, and is followed once a
 * catalog from the server it names is on screen.
 */
export interface ElementLink {
  /** Null when the link names no (valid) server: it then follows on whichever server is connected. */
  serverUrl: string | null
  elementId: string
  tab: DetailTab
}

const TABS: readonly DetailTab[] = ['overview', 'relationships', 'history', 'subtree']

export function parseElementLink(search: string): ElementLink | null {
  const params = new URLSearchParams(search)
  const elementId = params.get('element')
  if (!elementId) return null
  const tab = params.get('tab') as DetailTab | null
  return {
    serverUrl: parseServerParam(search),
    elementId,
    tab: tab && TABS.includes(tab) ? tab : 'overview',
  }
}

/** `base` is the explorer's own address; any query or fragment on it is dropped. */
export function buildElementLink(base: string, serverUrl: string, elementId: string, tab: DetailTab = 'overview'): string {
  const url = new URL(base)
  url.search = ''
  url.hash = ''
  url.searchParams.set('server', normalizeServerUrl(serverUrl))
  url.searchParams.set('element', elementId)
  if (tab !== 'overview') url.searchParams.set('tab', tab)
  return url.toString()
}

/**
 * The explorer address links are built on. The web build is its own address; the
 * desktop app has none, so it links to the hosted explorer its configuration names
 * (`explorerUrl`), and offers no links without one.
 */
function linkBase(): string | null {
  const configured = getRuntimeConfig().explorerUrl
  if (configured) return configured
  if (window.electronAPI) return null
  return `${window.location.origin}${window.location.pathname}`
}

/** Whether "Copy link" can be offered: connected, and there is an explorer address to link to. */
export function canLinkElements(): boolean {
  return getClient() !== null && linkBase() !== null
}

/** A link to an element on the connected server, or null when none can be built. */
export function elementLinkFor(elementId: string, tab?: DetailTab): string | null {
  const client = getClient()
  const base = linkBase()
  if (!client || !base) return null
  return buildElementLink(base, client.getBaseUrl(), elementId, tab)
}

/** Puts a link to the element on the clipboard; answers whether there was one to copy. */
export function copyElementLink(elementId: string, tab?: DetailTab): boolean {
  const link = elementLinkFor(elementId, tab)
  if (link) copyText(link)
  return link !== null
}

interface ElementLinkState {
  /** Why an opened link could not be followed, for the person who opened it. */
  notice: string | null
  dismissNotice: () => void
}

export const useElementLinkStore = create<ElementLinkState>(set => ({
  notice: null,
  dismissNotice: () => set({ notice: null }),
}))

let pending: ElementLink | null = null
let mismatchReportedFor: string | null = null

const sameServer = (a: string, b: string) => normalizeServerUrl(a) === normalizeServerUrl(b)

function followPending(): void {
  let link = pending
  if (!link) return
  const { isConnected, redirectNotice } = useConnectionStore.getState()
  // The server redirected the connection (http → https): the link named the old address.
  if (link.serverUrl && redirectNotice && sameServer(redirectNotice.from, link.serverUrl)) {
    link = pending = { ...link, serverUrl: redirectNotice.to }
  }
  const connected = getClient()?.getBaseUrl()
  if (!isConnected || !connected) return
  const { allObjectsLoaded, catalogOrigin } = useExplorerStore.getState()
  if (!allObjectsLoaded) return

  if (link.serverUrl && !sameServer(link.serverUrl, connected)) {
    // Kept pending: connecting to the link's server later still follows it.
    if (mismatchReportedFor !== link.serverUrl) {
      mismatchReportedFor = link.serverUrl
      useElementLinkStore.setState({
        notice: `The link you opened points to an object on ${link.serverUrl}. Connect to that server to open it.`,
      })
    }
    return
  }

  // Cleared before navigating: the navigation writes the store this runs from.
  pending = null
  if (openElement(link.elementId, link.tab)) {
    useElementLinkStore.setState({ notice: null })
    return
  }
  // A cached catalog may predate the object; only the server's copy can say it isn't there.
  if (catalogOrigin?.kind !== 'network') {
    pending = link
    return
  }
  useElementLinkStore.setState({
    notice: `The link you opened points to "${link.elementId}", which this server's catalog does not contain.`,
  })
}

let watching = false

/** The link waiting to be followed, if any. */
export function pendingElementLink(): ElementLink | null {
  return pending
}

/** Holds a link until a catalog from its server is on screen, then opens it. */
export function setPendingElementLink(link: ElementLink | null): void {
  pending = link
  mismatchReportedFor = null
  if (link && !watching) {
    watching = true
    useConnectionStore.subscribe(followPending)
    useExplorerStore.subscribe(followPending)
  }
  followPending()
}

/**
 * Picks an element link off the address bar, to be followed once its server's
 * catalog is loaded. Call before `applyServerFromQuery`, which consumes `server`.
 */
export function applyElementLinkFromQuery(): void {
  const link = parseElementLink(window.location.search)
  if (!link) return

  const url = new URL(window.location.href)
  url.searchParams.delete('element')
  url.searchParams.delete('tab')
  const query = url.searchParams.toString()
  window.history.replaceState(window.history.state, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`)

  setPendingElementLink(link)
}
