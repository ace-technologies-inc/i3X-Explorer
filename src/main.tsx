import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { useConnectionStore } from './stores/connection'

interface SiteConfig {
  serverUrl?: string
  recentUrls?: string[]
}

async function init() {
  // Fetch runtime config — lets server operators override defaults without rebuilding.
  // Only applied on first visit; localStorage values take priority for returning users.
  try {
    const res = await fetch('/config.json')
    if (res.ok) {
      const config: SiteConfig = await res.json()
      const hasExistingState = !!localStorage.getItem('i3x-connection')
      if (!hasExistingState) {
        const store = useConnectionStore.getState()
        if (config.serverUrl) store.setServerUrl(config.serverUrl)
        if (config.recentUrls?.length) {
          config.recentUrls.forEach(url => store.addRecentUrl(url))
        }
      }
    }
  } catch {
    // No config.json or fetch failed — use compiled defaults
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

init()
