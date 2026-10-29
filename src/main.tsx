import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { useConnectionStore } from './stores/connection'
import { applyServerFromQuery } from './services/serverFromQuery'

interface SiteConfig {
  serverUrl?: string
  recentUrls?: string[]
}

async function init() {
  // Fetch runtime config, lets server operators override defaults without rebuilding.
  // Only applied on first visit; localStorage values take priority for returning users.
  try {
    const res = await fetch('./config.json')
    if (res.ok) {
      const config: SiteConfig = await res.json()
      const hasExistingState = !!localStorage.getItem('i3x-connection')
      if (!hasExistingState) {
        const store = useConnectionStore.getState()
        if (config.serverUrl) store.setServerUrl(config.serverUrl)
        if (config.recentUrls?.length) {
          useConnectionStore.setState({ recentUrls: config.recentUrls })
        }
      }
    }
  } catch {
    // No config.json or fetch failed, use compiled defaults
  }

  // A `?server=` deep-link overrides both the config.json default and any
  // persisted value, so apply it last (it waits for store hydration itself).
  applyServerFromQuery()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

init()
