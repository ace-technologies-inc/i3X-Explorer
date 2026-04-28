import { useState, useEffect } from 'react'

const GITHUB_API_URL = 'https://api.github.com/repos/ace-technologies-inc/i3X-Explorer/releases/latest'
const GITHUB_RELEASES_URL = 'https://github.com/ace-technologies-inc/i3X-Explorer/releases'

function isNewerVersion(current: string, candidate: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [cMaj, cMin, cPatch] = parse(current)
  const [nMaj, nMin, nPatch] = parse(candidate)
  if (nMaj !== cMaj) return nMaj > cMaj
  if (nMin !== cMin) return nMin > cMin
  return nPatch > cPatch
}

export function UpdateChecker() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null)

  useEffect(() => {
    localStorage.removeItem('i3x-update-dismissed')
    fetch(GITHUB_API_URL)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const tag = data?.tag_name as string | undefined
        if (!tag) return
        if (isNewerVersion(__APP_VERSION__, tag)) setLatestVersion(tag)
      })
      .catch(() => {})
  }, [])

  if (!latestVersion) return null

  const dismiss = () => setLatestVersion(null)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-i3x-surface rounded-lg shadow-xl w-full max-w-md border border-i3x-border">
        <div className="px-4 py-3 border-b border-i3x-border flex items-center gap-2">
          <span className="text-base">🎉</span>
          <h2 className="text-sm font-semibold text-i3x-text">Update Available</h2>
        </div>
        <div className="p-4 space-y-2 text-sm text-i3x-text">
          <p>
            A new version of i3X Explorer is available:{' '}
            <span className="font-mono font-semibold text-i3x-primary">{latestVersion}</span>
          </p>
          <p className="text-i3x-text-muted">
            You are currently running{' '}
            <span className="font-mono">v{__APP_VERSION__}</span>.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-i3x-border flex justify-end gap-2">
          <button
            onClick={dismiss}
            className="px-3 py-1.5 text-sm text-i3x-text-muted hover:text-i3x-text transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => { window.open(GITHUB_RELEASES_URL); dismiss() }}
            className="px-4 py-1.5 text-sm bg-i3x-primary text-white rounded hover:bg-i3x-primary/80 transition-colors"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
