import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { normalizeServerUrl, useConnectionStore } from './stores/connection'
import { applyServerFromQuery } from './services/serverFromQuery'
import { loadRuntimeConfig } from './config/runtimeConfig'

async function init() {
  // nginx serves the app at /explorer too; without the slash, config.json and the OAuth callback resolve outside the app.
  const base = import.meta.env.BASE_URL
  if (base.startsWith('/') && window.location.pathname === base.replace(/\/$/, '')) {
    window.history.replaceState(window.history.state, '', `${base}${window.location.search}${window.location.hash}`)
  }

  // Runtime config lets operators override defaults without rebuilding. The server
  // URL and recent list apply only on a first visit (a returning user's choice wins);
  // OAuth defaults are read on every launch and never persisted.
  const config = await loadRuntimeConfig()
  const hasExistingState = !!localStorage.getItem('i3x-connection')
  if (!hasExistingState) {
    const store = useConnectionStore.getState()
    if (config.serverUrl) store.setServerUrl(config.serverUrl)
    if (config.recentUrls?.length) {
      useConnectionStore.setState({ recentConnections: config.recentUrls.map(url => ({ url: normalizeServerUrl(url), auth: 'none' as const })) })
    }
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
