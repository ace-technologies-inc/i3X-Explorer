import { createClient, destroyClient, getClient } from '../api/client'
import type { AuthProvider } from '../api/authProvider'
import { UnsupportedServerError } from '../api/normalize'
import { HttpStatusError } from '../api/subscription'
import { cancelOAuthSignIn, openOAuthSession } from '../auth/oauthSession'
import type { OAuthSettings } from '../auth/oauthProtocol'
import { getRuntimeConfig, oauthProfilesFor, type OAuthProfile } from '../config/runtimeConfig'
import { useConnectionStore, type Credentials } from '../stores/connection'
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
    const client = createClient(serverUrl, activeCredentials, await authProviderFor(activeCredentials, serverUrl))
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
    console.error('Connect failed:', err)
    connection.setError(connectErrorMessage(err))
    // setError only clears isConnecting. Without this, a failed initial load
    // left the UI green-"Connected" over a destroyed client.
    connection.setConnected(false)
    destroyClient()
  }
}

/** The OAuth settings a connection uses: its own, else its named profile, else the best profile for this server. */
export function oauthSettingsFor(credentials: Credentials | null, serverUrl: string): OAuthSettings | null {
  if (credentials?.type !== 'oauth') return null
  if (credentials.settings) return credentials.settings
  const profiles = oauthProfilesFor(getRuntimeConfig().oauthProfiles, serverUrl)
  // A named profile that no longer applies is not swapped for another: that could sign in to a different tenant.
  if (credentials.profile) return profiles.find(profile => profile.name === credentials.profile) ?? null
  return profiles[0] ?? null
}

/**
 * Where a connection's OAuth tokens may go: wherever its profile still applies, or, for settings typed
 * in for one server, that server's origin or its upgrade to https on the default port; never a downgrade.
 */
function oauthScope(credentials: Credentials & { type: 'oauth' }, serverUrl: string, settings: OAuthSettings) {
  const originOf = (url: string) => {
    try {
      return new URL(url).origin
    } catch {
      return null
    }
  }
  if (credentials.settings) {
    const origins = new Set<string>()
    try {
      const server = new URL(serverUrl)
      origins.add(server.origin)
      if (server.protocol === 'http:' && !server.port) origins.add(`https://${server.hostname}`)
    } catch {
      // An unparseable server URL permits nothing.
    }
    return (baseUrl: string) => {
      const origin = originOf(baseUrl)
      return origin !== null && origins.has(origin)
    }
  }
  return (baseUrl: string) => oauthProfilesFor(getRuntimeConfig().oauthProfiles, baseUrl).includes(settings as OAuthProfile)
}

async function authProviderFor(credentials: Credentials | null, serverUrl: string): Promise<AuthProvider | undefined> {
  useConnectionStore.getState().setAccountName(null)
  if (credentials?.type !== 'oauth') return undefined
  const settings = oauthSettingsFor(credentials, serverUrl)
  if (!settings) {
    throw new Error(credentials.profile
      ? `The sign-in profile "${credentials.profile}" is not configured for this server. Choose another in the connection dialog.`
      : 'No OAuth sign-in settings apply to this server. Enter them in the connection dialog.')
  }
  const connection = useConnectionStore.getState()
  connection.setSignInPending(true)
  try {
    const session = await openOAuthSession(settings)
    connection.setAccountName(session.accountName ?? null)
    const provider = session.provider
    return {
      getHeaders: () => provider.getHeaders(),
      handleUnauthorized: sent => provider.handleUnauthorized(sent),
      permits: oauthScope(credentials, serverUrl, settings),
    }
  } finally {
    connection.setSignInPending(false)
  }
}

/** A connect failure as the person should read it: a refused credential is not a network problem. */
export function connectErrorMessage(err: unknown): string {
  if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) {
    const detail = err.message.replace(/^HTTP \d+:\s*/, '').trim()
    const reason = err.status === 401
      ? 'The server requires sign-in, or it rejected the credentials (HTTP 401).'
      : 'The server accepted the credentials, but this account is not allowed to use it (HTTP 403).'
    return detail ? `${reason} ${detail}` : reason
  }
  return err instanceof Error ? err.message : 'Connection failed'
}

export async function performDisconnect(): Promise<void> {
  if (useConnectionStore.getState().signInPending) cancelOAuthSignIn()
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
