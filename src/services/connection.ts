import { createClient, destroyClient, getClient } from '../api/client'
import { UnsupportedServerError } from '../api/normalize'
import { useConnectionStore } from '../stores/connection'
import { useExplorerStore } from '../stores/explorer'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { catalogAvailable, ensureAllObjectsLoaded, loadHierarchicalRoots } from './catalog'
import { clearServerQueries } from '../data/queryClient'

/**
 * The connect/disconnect flows, extracted from the Toolbar so the connection
 * dialog can re-run them when Save changes the URL or credentials while
 * connected. All state goes through getState(), no hooks, callable anywhere.
 * Modal outcomes (redirect notice, unsupported server) are store fields the Toolbar
 * renders.
 */
export async function performConnect(): Promise<void> {
  const connection = useConnectionStore.getState()
  if (connection.isConnecting) return
  const { serverUrl } = connection

  connection.setConnecting(true)
  connection.setError(null)
  connection.setRedirectNotice(null)
  connection.setUnsupportedServer(null)

  // Use saved credentials if none are currently set
  const activeCredentials = connection.credentials ?? connection.getCredentialsForUrl(serverUrl)
  if (activeCredentials && !connection.credentials) {
    connection.setCredentials(activeCredentials)
  }

  const explorer = useExplorerStore.getState()

  try {
    const client = createClient(serverUrl, activeCredentials)
    clearServerQueries()
    const success = await client.testConnection()

    if (success) {
      // Flips true before the initial namespace/type load on purpose: the
      // sidebar checks isConnected before isLoading, so flipping it later
      // would show "Connect to a server to browse" instead of the loading
      // skeleton during a normal connect. The catch below un-flips it on
      // failure.
      connection.setConnected(true)

      // The server may have redirected during version detection (e.g. http → https);
      // the client adopted the final URL. Sync it back to the store so the toolbar
      // shows the real URL, future connects skip the redirect, and saved credentials
      // follow the new URL. Compare against the trailing-slash-stripped input since
      // the client constructor strips it too.
      const finalUrl = client.getBaseUrl()
      if (finalUrl !== serverUrl.replace(/\/$/, '')) {
        connection.setServerUrl(finalUrl)
        if (activeCredentials) {
          connection.saveCredentialsForUrl(finalUrl, activeCredentials)
        }
        connection.setRedirectNotice({ from: serverUrl, to: finalUrl })
      }
      connection.addRecentUrl(finalUrl)

      // Load initial data
      explorer.setLoading(true)
      const catalogLoad = ensureAllObjectsLoaded(client, { force: true, invalidateCurrent: true })
        .catch(err => {
          console.warn('Object list prefetch failed:', err)
          if (getClient() === client) {
            useConnectionStore.getState().setError(
              `Connected, but loading the object list failed: ${err instanceof Error ? err.message : String(err)}`
            )
          }
        })

      // Fire-and-forget: the server's root=true query decides the Hierarchy folder's roots.
      loadHierarchicalRoots(client).catch(err => {
        // Redundant with expansion-time refetch, so a log is enough.
        console.warn('Hierarchy roots prefetch failed:', err)
      })

      // A failure here goes straight to the catch below without waiting for the catalog.
      const [namespaces, objectTypes, relationshipTypes] = await Promise.all([
        client.getNamespaces(),
        client.getObjectTypes(),
        client.getRelationshipTypes()
      ])
      explorer.setNamespaces(namespaces)
      explorer.setObjectTypes(objectTypes)
      explorer.setRelationshipTypes(relationshipTypes)

      // Skeletons key off isLoading: it stays set until a catalog is on screen (cache or server).
      await catalogAvailable(catalogLoad)
      explorer.setLoading(false)
    } else {
      connection.setError('Failed to connect to server')
      destroyClient()
    }
  } catch (err) {
    explorer.setLoading(false)
    if (err instanceof UnsupportedServerError) connection.setUnsupportedServer(err.found)
    connection.setError(err instanceof Error ? err.message : 'Connection failed')
    // setError only clears isConnecting. Without this, a failed initial load
    // left the UI green-"Connected" over a destroyed client.
    connection.setConnected(false)
    destroyClient()
  }
}

export async function performDisconnect(): Promise<void> {
  const client = getClient()
  if (client) {
    const ids = Array.from(useSubscriptionsStore.getState().subscriptions.keys())
    await Promise.allSettled(ids.map(id => client.deleteSubscription(id)))
  }

  destroyClient()
  clearServerQueries()
  useConnectionStore.getState().disconnect()
  useExplorerStore.getState().reset()
  useSubscriptionsStore.getState().clearAll()
  useConnectionStore.getState().setRedirectNotice(null)
}
