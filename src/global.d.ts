interface Window {
  electronAPI?: {
    platform: string
    versions: {
      node: string
      chrome: string
      electron: string
    }
    encryptString: (plaintext: string) => Promise<string | null>
    decryptString: (encrypted: string) => Promise<string | null>
    openDevTools: () => Promise<void>
    setIgnoreCertErrors: (flag: boolean) => void
    onAppBeforeQuit: (callback: () => void) => () => void
    notifyCleanupDone: () => void
    /** Settings from the desktop app's environment and config file, validated by the renderer. */
    getRuntimeConfig?: () => Promise<unknown>
    oauthSignIn?: (settings: import('./auth/oauthProtocol').OAuthSettings) => Promise<import('./auth/oauthProtocol').TokenSet>
    oauthRefresh?: (
      settings: import('./auth/oauthProtocol').OAuthSettings,
      tokens: import('./auth/oauthProtocol').TokenSet
    ) => Promise<import('./auth/oauthProtocol').TokenSet>
    oauthSignOut?: (
      settings: import('./auth/oauthProtocol').OAuthSettings,
      tokens: import('./auth/oauthProtocol').TokenSet | undefined,
      endSession: boolean
    ) => Promise<import('./auth/oauthSession').SignOutResult>
    oauthCancel?: () => Promise<void>
    openNewWindow: () => void
  }
}
