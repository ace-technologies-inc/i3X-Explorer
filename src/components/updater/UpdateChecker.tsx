import { useState, useEffect } from 'react'
import { SparklesIcon } from '../common/icons'

// Keep in sync with package.json "repository". If this repo has no releases
// yet, the /releases/latest probe 404s and the check silently no-ops.
const GITHUB_REPO = 'cesmii/I3X-Explorer'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

export function isNewerVersion(current: string, candidate: string): boolean {
  // Strip a leading "v" and any prerelease suffix; missing parts count as 0.
  // So "v1.1" reads as 1.1.0, and "v1.1.0-rc1" as 1.1.0 (an rc would nag a
  // 1.0.0 user, fine for a repo that only publishes stable releases; the old
  // Number() parse turned both cases into NaN and never offered them at all).
  const parse = (v: string) =>
    v.replace(/^v/, '').split('-')[0].split('.').map(part => {
      const n = parseInt(part, 10)
      return Number.isNaN(n) ? 0 : n
    })
  const [cMaj = 0, cMin = 0, cPatch = 0] = parse(current)
  const [nMaj = 0, nMin = 0, nPatch = 0] = parse(candidate)
  if (nMaj !== cMaj) return nMaj > cMaj
  if (nMin !== cMin) return nMin > cMin
  return nPatch > cPatch
}

export function UpdateChecker() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null)

  useEffect(() => {
    fetch(GITHUB_API_URL)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const tag = data?.tag_name as string | undefined
        if (!tag) return
        // A dismissed version stays dismissed across launches; a newer
        // release than the dismissed one nags again.
        if (localStorage.getItem('i3x-update-dismissed') === tag) return
        if (isNewerVersion(__APP_VERSION__, tag)) setLatestVersion(tag)
      })
      .catch(() => {})
  }, [])

  if (!latestVersion) return null

  const dismiss = () => {
    localStorage.setItem('i3x-update-dismissed', latestVersion)
    setLatestVersion(null)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-i3x-surface rounded-lg shadow-xl w-full max-w-md border border-i3x-border">
        <div className="px-4 py-3 border-b border-i3x-border flex items-center gap-2">
          <SparklesIcon size={17} className="text-i3x-primary" />
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
