import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { useConnectionStore } from './stores/connection'
import { applyServerFromQuery } from './services/serverFromQuery'
import { loadRuntimeConfig } from './config/runtimeConfig'

async function init() {
  // Runtime config lets operators override defaults without rebuilding. The server
  // URL and recent list apply only on a first visit (a returning user's choice wins);
  // OAuth defaults are read on every launch and never persisted.
  const config = await loadRuntimeConfig()
  const hasExistingState = !!localStorage.getItem('i3x-connection')
  if (!hasExistingState) {
    const store = useConnectionStore.getState()
    if (config.serverUrl) store.setServerUrl(config.serverUrl)
    if (config.recentUrls?.length) {
      useConnectionStore.setState({ recentUrls: config.recentUrls })
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
