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
  }
}
