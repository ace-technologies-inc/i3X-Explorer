interface Window {
  electronAPI?: {
    platform: string
    versions: {
      node: string
      chrome: string
      electron: string
    }
    fetch: (url: string, options: RequestInit) => Promise<{
      ok: boolean
      status: number
      statusText: string
      body: string
    }>
  }
}
