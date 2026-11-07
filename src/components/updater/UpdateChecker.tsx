import { useState, useEffect } from 'react'
import { SparklesIcon } from '../common/icons'

// Keep in sync with package.json "repository". If this repo has no releases
// yet, the /releases/latest probe 404s and the check silently no-ops.
const GITHUB_REPO = 'ace-technologies-inc/i3X-Explorer'
// The list, not /releases/latest: a build only accepts tags of its own shape
// (see isNewerVersion), so the newest release overall may not be one it can
// take, and the newest one it can take may sit further down the list.
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

interface ParsedVersion {
  parts: [number, number, number]
  // The "-N" build number, or null for a plain #.#.# version.
  build: number | null
}

function parseVersion(v: string): ParsedVersion {
  const [core, ...rest] = v.trim().replace(/^v/i, '').split('-')
  const nums = core.split('.').map(part => {
    const n = parseInt(part, 10)
    return Number.isNaN(n) ? 0 : n
  })
  const suffix = rest.join('-')
  const digits = parseInt(suffix.replace(/\D+/g, ''), 10)
  return {
    parts: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0],
    build: suffix ? (Number.isNaN(digits) ? 0 : digits) : null,
  }
}

// Numeric order over major.minor.patch, then the build number (absent = 0).
function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i]
  }
  return (a.build ?? 0) - (b.build ?? 0)
}

/**
 * Whether `candidate` (a release tag) is an update for a build at `current`.
 *
 * Two versioning schemes share this check, and each build follows its own:
 * - A **#.#.#-# build** (tracking the release spec, e.g. 1.2.3-4) takes any
 *   higher version: 1.2.3-5 and 1.2.4 are updates, 1.2.3 is not (a missing
 *   build number counts as 0).
 * - A **#.#.# build** (e.g. 1.2.3) only takes plain #.#.# tags: 1.2.4 is an
 *   update, any tag with a "-#" suffix is ignored, however high.
 *
 * Missing parts count as 0, so "v1.1" reads as 1.1.0.
 */
export function isNewerVersion(current: string, candidate: string): boolean {
  const c = parseVersion(current)
  const n = parseVersion(candidate)
  if (c.build === null && n.build !== null) return false
  return compareVersions(n, c) > 0
}

interface GitHubRelease {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
}

/** The highest published release tag that is an update for `current`, if any. */
export function pickUpdate(current: string, releases: GitHubRelease[]): string | null {
  let best: string | null = null
  for (const r of releases) {
    const tag = r.tag_name
    if (!tag || r.draft || r.prerelease || !isNewerVersion(current, tag)) continue
    if (best === null || compareVersions(parseVersion(tag), parseVersion(best)) > 0) best = tag
  }
  return best
}

export function UpdateChecker() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null)

  useEffect(() => {
    fetch(GITHUB_API_URL)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const tag = Array.isArray(data) ? pickUpdate(__APP_VERSION__, data) : null
        if (!tag) return
        // A dismissed version stays dismissed across launches; a newer
        // release than the dismissed one nags again.
        if (localStorage.getItem('i3x-update-dismissed') === tag) return
        setLatestVersion(tag)
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
