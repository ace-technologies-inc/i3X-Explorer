import { app, BrowserWindow, shell, ipcMain, safeStorage, nativeTheme } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Set the app name for macOS menu bar (overrides package.json "name")
app.setName('i3X Explorer')

// IPC handlers for credential encryption via OS keychain
ipcMain.handle('safe-storage-encrypt', (_event, plaintext: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(plaintext).toString('base64')
})

ipcMain.handle('safe-storage-decrypt', (_event, encrypted: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
})

// IPC handler to open DevTools
ipcMain.handle('open-devtools', (event) => {
  const webContents = event.sender
  webContents.openDevTools({ mode: 'detach' })
})

let mainWindow: BrowserWindow | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  // In dev mode, load preload directly from source (CJS format)
  // In production, load from dist-electron
  const preloadPath = VITE_DEV_SERVER_URL
    ? path.join(__dirname, '../electron/preload.cjs')
    : path.join(__dirname, 'preload.cjs')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Disable CORS enforcement so the renderer can fetch any I3X server directly.
      // Safe here because we load only our own trusted app code, not arbitrary web content.
      webSecurity: false
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f5',
    show: false
  })

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
