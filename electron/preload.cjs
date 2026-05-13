const { contextBridge, ipcRenderer } = require('electron')

console.log('PRELOAD SCRIPT LOADING')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  // Credential encryption via OS keychain
  encryptString: (plaintext) => ipcRenderer.invoke('safe-storage-encrypt', plaintext),
  decryptString: (encrypted) => ipcRenderer.invoke('safe-storage-decrypt', encrypted),
  // Open DevTools in detached window
  openDevTools: () => {
    return ipcRenderer.invoke('open-devtools')
  },
  onAppBeforeQuit: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app-before-quit', listener)
    return () => ipcRenderer.removeListener('app-before-quit', listener)
  },
  notifyCleanupDone: () => ipcRenderer.send('app-cleanup-done')
})
