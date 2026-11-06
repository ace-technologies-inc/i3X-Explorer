import { app, BrowserWindow, shell, ipcMain, safeStorage, nativeTheme, Menu, MenuItem } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { mergeRuntimeConfig, readRuntimeConfigFile } from './runtimeConfig'
import { signInWithLoopback } from './oauthLoopback'
import {
  configurationFor,
  endSessionUrl,
  refreshTokens,
  revokeTokens,
  type OAuthSettings,
  type TokenSet,
} from '../src/auth/oauthProtocol'

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Disable GPU on Linux to avoid VA-API/EGL failures on VMs and systems without
// working GPU drivers. The window-show fallback below handles ready-to-show not
// firing when the GPU process is absent.
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
}

// Set the app name for macOS menu bar (overrides package.json "name")
app.setName('i3X Explorer')

// IPC handlers for credential encryption via OS keychain.
// The async safeStorage API: the sync one is deprecated in Electron 45 and removed in 46.
// Both use the same per-platform key store, so credentials saved by builds that used
// encryptString() still decrypt here.
ipcMain.handle('safe-storage-encrypt', async (_event, plaintext: string) => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return null
  return (await safeStorage.encryptStringAsync(plaintext)).toString('base64')
})

ipcMain.handle('safe-storage-decrypt', async (_event, encrypted: string) => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return null
  // shouldReEncrypt is not acted on: the renderer re-encrypts on every save.
  const { result } = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
  return result
})

// IPC handler to toggle DevTools (open if closed, close if open)
ipcMain.handle('open-devtools', (event) => {
  const webContents = event.sender
  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools()
  } else {
    webContents.openDevTools({ mode: 'detach' })
  }
})

ipcMain.on('open-new-window', () => createWindow())

let ignoreCertErrors = false

// Read once at launch: an administrator's file beside the executable, then the user's, with the environment over either.
let runtimeConfig: Record<string, unknown> | null = null
ipcMain.handle('get-runtime-config', () => {
  runtimeConfig ??= mergeRuntimeConfig(
    readRuntimeConfigFile([path.dirname(app.getPath('exe')), app.getPath('userData')]),
    process.env
  )
  return runtimeConfig
})

const openSignInPage = (url: string) => {
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(url)) {
    throw new Error('Refusing to open a sign-in page that is not https')
  }
  return shell.openExternal(url)
}

const logged = (operation: string) => (err: unknown) => {
  console.error(`[oauth] ${operation} failed:`, err instanceof Error ? err.message : err)
  throw err
}

// Discovery and every token request run here, not in the renderer: an issuer may refuse a desktop client's request that carries a browser Origin.
let signInInProgress: AbortController | null = null

ipcMain.handle('oauth-sign-in', async (_event, settings: OAuthSettings) => {
  signInInProgress?.abort()
  const controller = new AbortController()
  signInInProgress = controller
  try {
    const config = await configurationFor(settings)
    return await signInWithLoopback(config, settings, { openBrowser: openSignInPage, signal: controller.signal })
  } catch (err) {
    return logged('sign-in')(err)
  } finally {
    if (signInInProgress === controller) signInInProgress = null
  }
})

ipcMain.handle('oauth-cancel', () => signInInProgress?.abort())

ipcMain.handle('oauth-refresh', async (_event, settings: OAuthSettings, tokens: TokenSet) =>
  refreshTokens(await configurationFor(settings), settings, tokens).catch(logged('token refresh'))
)

ipcMain.handle('oauth-sign-out', async (_event, settings: OAuthSettings, tokens: TokenSet | undefined, endSession: boolean) => {
  const config = await configurationFor(settings).catch(logged('sign-out'))
  const revoked = tokens ? await revokeTokens(config, tokens).catch(() => false) : false
  const page = endSession ? endSessionUrl(config, tokens) : undefined
  if (page) await openSignInPage(page.href)
  return { revoked, endedSession: !!page }
})

// Allow renderer to toggle certificate error bypass at runtime.
// Needed for dev servers using self-signed certs.
ipcMain.on('set-ignore-cert-errors', (_event, flag: boolean) => {
  ignoreCertErrors = flag
})

app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  if (ignoreCertErrors) {
    event.preventDefault()
    callback(true)
  } else {
    callback(false)
  }
})

const windows = new Set<BrowserWindow>()

// Coordinates renderer cleanup (closing SSE streams, deleting server-side
// subscriptions) before the app exits. Without this the process is killed
// while subscriptions are still registered server-side.
let cleanupRan = false
let pendingCleanup = new Set<number>()
let cleanupAck: (() => void) | null = null

ipcMain.on('app-cleanup-done', (event) => {
  pendingCleanup.delete(event.sender.id)
  if (pendingCleanup.size === 0) {
    cleanupAck?.()
    cleanupAck = null
  }
})

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  // In dev mode, load preload directly from source (CJS format)
  // In production, load from dist-electron
  const preloadPath = VITE_DEV_SERVER_URL
    ? path.join(__dirname, '../electron/preload.cjs')
    : path.join(__dirname, 'preload.cjs')

  const win = new BrowserWindow({
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
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 15, y: 15 },
    } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f5',
    show: false
  })
  windows.add(win)

  // Show window when ready to avoid flash.
  // On Linux with hardware acceleration disabled, ready-to-show depends on the
  // GPU compositor for first-paint and may never fire. did-finish-load fires after
  // page navigation completes regardless of GPU state and serves as the fallback.
  win.once('ready-to-show', () => win.show())
  if (process.platform === 'linux') {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed() && !win.isVisible()) win.show()
    })
  }

  // Open external links in browser
  // Ctrl+N opens another window where there is no application menu to carry the shortcut
  if (process.platform !== 'darwin') {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && !input.alt && !input.shift && input.key.toLowerCase() === 'n') {
        event.preventDefault()
        createWindow()
      }
    })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    // Only the first window; later ones would each pop their own inspector
    if (windows.size === 1) win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  win.on('closed', () => {
    windows.delete(win)
  })
}

// Adds File > New Window (Cmd+N) to the default macOS menu.
function addNewWindowMenuItem() {
  const menu = Menu.getApplicationMenu()
  const fileMenu = menu?.items.find((item) => item.role === 'fileMenu' || item.label === 'File')
  if (!menu || !fileMenu?.submenu) return
  fileMenu.submenu.insert(0, new MenuItem({
    label: 'New Window',
    accelerator: 'CmdOrCtrl+N',
    click: () => createWindow()
  }))
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(() => {
  // Hide the native menu bar on Windows/Linux, the app toolbar covers all user actions.
  // On macOS the system menu bar is kept (provides About, Edit shortcuts, etc.)
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  } else {
    addNewWindowMenuItem()
  }

  createWindow()
})

app.on('before-quit', async (event) => {
  if (cleanupRan) return
  const live = Array.from(windows).filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed())
  if (live.length === 0) {
    cleanupRan = true
    return
  }

  event.preventDefault()

  // Every window owns its own subscriptions, so each one cleans up before exit.
  pendingCleanup = new Set(live.map((w) => w.webContents.id))
  live.forEach((w) => w.webContents.send('app-before-quit'))

  await new Promise<void>((resolve) => {
    cleanupAck = resolve
    setTimeout(resolve, 3000)
  })

  cleanupRan = true
  app.quit()
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
