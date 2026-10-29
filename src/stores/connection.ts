import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

// The compiled-in default server URL. A persisted serverUrl different from this
// can only have come from an explicit user choice (see the v1 migration below).
const DEFAULT_SERVER_URL = 'https://api.i3x.dev/v1'

// Custom storage that encrypts savedCredentials via Electron's safeStorage
const encryptedStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const raw = localStorage.getItem(name)
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw)
      const state = parsed?.state
      if (state?.savedCredentials && typeof state.savedCredentials === 'string' && window.electronAPI) {
        const decrypted = await window.electronAPI.decryptString(state.savedCredentials)
        if (decrypted) {
          state.savedCredentials = JSON.parse(decrypted)
        } else {
          state.savedCredentials = {}
        }
      }
      return JSON.stringify(parsed)
    } catch {
      return raw
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value)
      const state = parsed?.state
      if (state?.savedCredentials && typeof state.savedCredentials === 'object' && window.electronAPI) {
        const encrypted = await window.electronAPI.encryptString(JSON.stringify(state.savedCredentials))
        if (encrypted) {
          state.savedCredentials = encrypted
        }
      }
      localStorage.setItem(name, JSON.stringify(parsed))
    } catch {
      localStorage.setItem(name, value)
    }
  },

  removeItem: (name: string): void => {
    localStorage.removeItem(name)
  }
}

interface BasicCredentials {
  type: 'basic'
  username: string
  password: string
}

interface BearerCredentials {
  type: 'bearer'
  token: string
}

interface CustomHeaderCredentials {
  type: 'header'
  headerName: string
  headerValue: string
}

export type Credentials = BasicCredentials | BearerCredentials | CustomHeaderCredentials

interface ConnectionState {
  serverUrl: string
  // True once the user explicitly picked a server in the connection dialog, so
  // a ?server= deep link must not override their choice.
  serverUrlUserSet: boolean
  credentials: Credentials | null
  savedCredentials: Record<string, Credentials>
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  showConnectionDialog: boolean
  recentUrls: string[]
  ignoreCertErrors: boolean
  // Connect-flow modals (not persisted). They live here rather than in Toolbar
  // state so the connect flow itself (services/connection.ts) can raise them
  // from any call site, Toolbar's Connect button or the dialog's reconnect.
  redirectNotice: { from: string; to: string } | null
  // What a server that is not an i3X 1.0 release identified as (see UnsupportedServerError.found)
  unsupportedServer: string | null

  setServerUrl: (url: string) => void
  setServerUrlUserSet: (value: boolean) => void
  setCredentials: (credentials: Credentials | null) => void
  saveCredentialsForUrl: (url: string, credentials: Credentials | null) => void
  getCredentialsForUrl: (url: string) => Credentials | null
  setConnected: (connected: boolean) => void
  setConnecting: (connecting: boolean) => void
  setError: (error: string | null) => void
  setShowConnectionDialog: (show: boolean) => void
  addRecentUrl: (url: string) => void
  setIgnoreCertErrors: (ignore: boolean) => void
  setRedirectNotice: (notice: { from: string; to: string } | null) => void
  setUnsupportedServer: (found: string | null) => void
  disconnect: () => void
}

type PersistedConnectionState = Pick<
  ConnectionState,
  'serverUrl' | 'serverUrlUserSet' | 'recentUrls' | 'savedCredentials' | 'ignoreCertErrors'
>

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      serverUrl: DEFAULT_SERVER_URL,
      serverUrlUserSet: false,
      credentials: null,
      savedCredentials: {},
      isConnected: false,
      isConnecting: false,
      error: null,
      showConnectionDialog: false,
      recentUrls: [DEFAULT_SERVER_URL, 'http://localhost:8080'],
      ignoreCertErrors: false,
      redirectNotice: null,
      unsupportedServer: null,

      setServerUrl: (url) => set({ serverUrl: url }),
      setServerUrlUserSet: (value) => set({ serverUrlUserSet: value }),
      setCredentials: (credentials) => set({ credentials }),

      saveCredentialsForUrl: (url, credentials) => {
        const { savedCredentials } = get()
        if (credentials) {
          set({ savedCredentials: { ...savedCredentials, [url]: credentials } })
        } else {
          const { [url]: _, ...rest } = savedCredentials
          set({ savedCredentials: rest })
        }
      },

      getCredentialsForUrl: (url) => {
        const { savedCredentials } = get()
        return savedCredentials[url] || null
      },

      setConnected: (connected) => set({ isConnected: connected, isConnecting: false }),
      setConnecting: (connecting) => set({ isConnecting: connecting, error: null }),
      setError: (error) => set({ error, isConnecting: false }),
      setShowConnectionDialog: (show) => set({ showConnectionDialog: show }),
      setIgnoreCertErrors: (ignore) => set({ ignoreCertErrors: ignore }),
      setRedirectNotice: (redirectNotice) => set({ redirectNotice }),
      setUnsupportedServer: (unsupportedServer) => set({ unsupportedServer }),

      addRecentUrl: (url) => {
        const { recentUrls } = get()
        if (!recentUrls.includes(url)) {
          set({ recentUrls: [url, ...recentUrls].slice(0, 10) })
        }
      },

      disconnect: () => set({
        isConnected: false,
        isConnecting: false,
        error: null,
        credentials: null
      })
    }),
    {
      name: 'i3x-connection',
      storage: createJSONStorage(() => encryptedStorage),
      version: 1,
      // v0 -> v1 added serverUrlUserSet. A persisted serverUrl that isn't the
      // compiled default predates the flag and can only have come from an
      // explicit user choice, so preserve it as user-set; otherwise a ?server=
      // deep link would clobber it on the first run of this version.
      migrate: (persisted, from): PersistedConnectionState => {
        const state = { ...(persisted as Partial<PersistedConnectionState>) }
        if (from < 1) {
          state.serverUrlUserSet =
            state.serverUrl !== undefined && state.serverUrl !== DEFAULT_SERVER_URL
        }
        return state as PersistedConnectionState
      },
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        serverUrlUserSet: state.serverUrlUserSet,
        recentUrls: state.recentUrls,
        savedCredentials: state.savedCredentials,
        ignoreCertErrors: state.ignoreCertErrors
      })
    }
  )
)
