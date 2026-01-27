import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ConnectionState {
  serverUrl: string
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  showConnectionDialog: boolean
  recentUrls: string[]

  setServerUrl: (url: string) => void
  setConnected: (connected: boolean) => void
  setConnecting: (connecting: boolean) => void
  setError: (error: string | null) => void
  setShowConnectionDialog: (show: boolean) => void
  addRecentUrl: (url: string) => void
  disconnect: () => void
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      serverUrl: 'https://i3x.cesmii.net',
      isConnected: false,
      isConnecting: false,
      error: null,
      showConnectionDialog: false,
      recentUrls: ['https://i3x.cesmii.net', 'http://localhost:8080'],

      setServerUrl: (url) => set({ serverUrl: url }),
      setConnected: (connected) => set({ isConnected: connected, isConnecting: false }),
      setConnecting: (connecting) => set({ isConnecting: connecting, error: null }),
      setError: (error) => set({ error, isConnecting: false }),
      setShowConnectionDialog: (show) => set({ showConnectionDialog: show }),

      addRecentUrl: (url) => {
        const { recentUrls } = get()
        if (!recentUrls.includes(url)) {
          set({ recentUrls: [url, ...recentUrls].slice(0, 10) })
        }
      },

      disconnect: () => set({
        isConnected: false,
        isConnecting: false,
        error: null
      })
    }),
    {
      name: 'i3x-connection',
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        recentUrls: state.recentUrls
      })
    }
  )
)
