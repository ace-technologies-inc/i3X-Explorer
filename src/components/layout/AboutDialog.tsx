import { useEffect, useId, useRef } from 'react'
import iconPng from '/icon.png'

const REPO_URL = 'https://github.com/ace-technologies-inc/i3X-Explorer'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 no-drag"
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
        className="w-[min(24rem,90vw)] bg-i3x-surface border border-i3x-border rounded-xl shadow-xl p-5 text-center"
      >
        <img src={iconPng} alt="" className="w-14 h-14 mx-auto" />
        <h2 id={titleId} className="mt-3 text-base font-semibold text-i3x-text">
          i3X Explorer
        </h2>
        <p className="text-xs text-i3x-text-muted tabular-nums">Version {__APP_VERSION__}</p>

        <p className="mt-3 text-xs text-i3x-text">
          Browse and monitor I3X (Industrial Information Interface eXchange) API servers.
        </p>

        <p className="mt-3 text-xs text-i3x-text">
          This software is <strong>MIT Licensed</strong>.
        </p>
        <p className="mt-1 text-[11.5px] text-i3x-text-muted">
          Copyright © Ace Technologies, Inc
        </p>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs text-i3x-primary hover:underline"
        >
          {REPO_URL.replace('https://', '')}
        </a>

        <div className="mt-4 flex justify-center">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded-md bg-i3x-primary text-white hover:bg-i3x-primary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
