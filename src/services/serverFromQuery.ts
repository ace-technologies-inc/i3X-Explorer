import { useConnectionStore } from '../stores/connection'

// Matches ConnectionDialog's normalizeUrl: strip any trailing slashes so the
// deep-linked URL lands in the same shape the connect flow expects.
const normalizeUrl = (url: string) => url.replace(/\/+$/, '')

/**
 * Parse the optional `?server=` deep-link param. Accepts only an absolute
 * http/https URL and returns it normalized; returns null for an absent,
 * malformed, or non-http(s) value. Never throws.
 */
function parseServerParam(search: string): string | null {
  const raw = new URLSearchParams(search).get('server')
  if (!raw) return null

  try {
    const { protocol } = new URL(raw)
    if (protocol !== 'http:' && protocol !== 'https:') return null
  } catch {
    return null
  }

  return normalizeUrl(raw)
}

/**
 * Honour a `?server=<encoded url>` link so another app can open the Explorer
 * already pointed at a specific i3X server. The param wins over both the
 * config.json default and any persisted localStorage value, so it is applied
 * after the (async, encrypted) connection store finishes hydrating — otherwise
 * the rehydrated value would clobber it. It only pre-fills the Server
 * Connection field; it never auto-connects. Once applied it is stripped from
 * the address bar so a manual refresh doesn't keep force-overriding the field.
 */
export function applyServerFromQuery(): void {
  const serverUrl = parseServerParam(window.location.search)
  if (!serverUrl) return

  const apply = () => {
    const store = useConnectionStore.getState()
    // A deep link may override the compiled/config default, but never a server
    // the user explicitly chose in the dialog.
    if (store.serverUrlUserSet) return
    store.setServerUrl(serverUrl)
    store.addRecentUrl(serverUrl)
  }

  if (useConnectionStore.persist.hasHydrated()) {
    apply()
  } else {
    // Apply once, after the persisted state lands, then stop listening so a
    // later rehydrate can't re-override a URL the user has since edited.
    const unsubscribe = useConnectionStore.persist.onFinishHydration(() => {
      unsubscribe()
      apply()
    })
  }

  stripServerParam()
}

// Drop just the `server` param, preserving any other query params and the hash.
function stripServerParam(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('server')
  const query = url.searchParams.toString()
  const next = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
  window.history.replaceState(window.history.state, '', next)
}