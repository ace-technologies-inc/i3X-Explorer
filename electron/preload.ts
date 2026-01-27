import { contextBridge } from 'electron'

// Expose any needed APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
})

// Type declaration for the exposed API
declare global {
  interface Window {
    electronAPI: {
      platform: string
      versions: {
        node: string
        chrome: string
        electron: string
      }
    }
  }
}
